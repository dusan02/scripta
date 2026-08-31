from __future__ import annotations
import asyncio
import logging
import re
import time
from datetime import datetime
from pathlib import Path
from typing import Optional

import httpx
from bs4 import BeautifulSoup

from .base import BaseScraper, ScraperUnavailableError, TransientHTTPError, retry_async_call
from ..models import ScrapedSource, PersonInfo, ACADEMIC_TITLES, ZIP_RE

logger = logging.getLogger(__name__)

# IČO format validation — must be exactly 8 digits (defense-in-depth)
_ICO_PATTERN = re.compile(r"^\d{8}$")

_EMPTY_MARKERS = ("Nenašli sa žiadne", "Podmienkam nevyhovuje žiadny", "Záznamy: 0 - 0 / 0", "Kritériám vyhľadávania nezodpovedá žiadny záznam")
_OUTDATED_MARKER = "Výpis je neaktuálny"
_TRANSFERRED_MARKER = "Spis odstúpený na iný registrový súd"

_LEGAL_FORM_RE = re.compile(
    r'((?:spol\.\s*s\s*r\.\s*o\.|s\.?\s*r\.?\s*o\.|a\.\s*s\.|v\.\s*o\.\s*s\.|k\.\s*s\.|družstvo|š\.?\s*p\.))\.?\s.*$',
    re.IGNORECASE,
)
_QUOTE_RE = re.compile(r'^["\']+(.+?)["\']+')

# ORSR uses windows-1250 encoding
_ORSR_ENCODING = "cp1250"
_SEARCH_URL = "https://www.orsr.sk/hladaj_ico.asp"
_DETAIL_URL = "https://www.orsr.sk/vypis.asp"
# Browser-like headers — ORSR blocks requests without User-Agent
_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "sk-SK,sk;q=0.9,en;q=0.8",
    "Accept-Encoding": "gzip, deflate, utf-8",
}
_HTTP_RETRIES = 2
_HTTP_RETRY_DELAY = 2.0


class OrsrScraper(BaseScraper):
    """Scraper pre Obchodný register SR (ORSR) — httpx + BeautifulSoup (bez Playwright).

    ORSR je statický HTML (windows-1250), nepotrebuje JavaScript.
    Rýchlosť: ~0.5-1s vs 17-34s s Playwright.

    F5 anti-bot ochrana: ORSR niekedy vráti JavaScript challenge (TSPD/bobcmn)
    namiesto search results. V takom prípade fallback na Playwright (vie spustiť JS).
    """

    source_type = "ORSR"
    base_url = _SEARCH_URL

    # Shared HTTP client for bulk mode — avoids per-company TCP/TLS handshake.
    # Initialized lazily by the first run() call when shared_client=True.
    _shared_client: httpx.AsyncClient | None = None
    _shared_client_lock = asyncio.Lock()

    # F5 anti-bot markers
    _F5_MARKERS = ("TSPD", "bobcmn")

    # ── Public ───────────────────────────────────────────────────────

    async def run(self, *, ico: str, output_dir: Path, orsr_extract_type: str = "CURRENT", skip_pdf: bool = False, skip_full_extract: bool = False, shared_client: bool = False, **kwargs) -> ScrapedSource:
        try:
            # Validate IČO format before scraping (defense-in-depth)
            if not ico or not _ICO_PATTERN.match(ico):
                return self._make_result(
                    status="FAILED",
                    file_path=None,
                    status_message=f"Neplatné IČO formát: {ico}. IČO musí obsahovať presne 8 číslic.",
                    findings="Neplatný vstup — IČO nezodpovedá formátu 8 číslic.",
                )

            logger.info(f"[{self.source_type}] Začínam pre IČO: {ico} (typ: {orsr_extract_type})")
            _t = time.perf_counter()

            # Use shared client (bulk mode) or create per-call client (single mode)
            if shared_client:
                client = await self._get_shared_client()
                owns_client = False
            else:
                client = httpx.AsyncClient(timeout=30, headers=_HEADERS, follow_redirects=True)
                owns_client = True

            try:
                # 1. Search by IČO
                search_html = await self._fetch_search_page(client, ico)
                logger.debug(f"[{self.source_type}] ⏱ search fetch: {time.perf_counter() - _t:.2f}s")
                _t = time.perf_counter()

                # 2. Check empty results
                if self._is_empty_results(search_html):
                    logger.warning(f"[{self.source_type}] IČO {ico} neexistuje v ORSR — zastavujem report.")
                    return self._make_result(
                        status="FAILED",
                        file_path=None,
                        status_message=f"IČO {ico} neexistuje v Obchodnom registri SR (ORSR). Report bol zastavený.",
                        findings="Kritériám vyhľadávania nezodpovedá žiadny záznam — IČO neexistuje v ORSR.",
                    )

                # 3. Find extract links (Aktuálny / Úplný)
                extract_links = self._find_extract_links(search_html, ico)
                if not extract_links:
                    # If we got here, the search page loaded but had no vypis.asp links.
                    # Step 2 already checked for empty results markers ("Nenašli sa žiadne"),
                    # so if we're here, the page is NOT an empty results page.
                    # This means either: F5 anti-bot challenge, layout change, or parsing issue.
                    # Return UNAVAILABLE (not SUCCESS) so bulk seed doesn't mark as synced.
                    logger.warning(f"[{self.source_type}] Žiadne odkazy na výpis pre IČO {ico} — pravdepodobne F5 anti-bot alebo zmena layoutu.")
                    return self._make_result(
                        status="UNAVAILABLE",
                        file_path=None,
                        status_message=f"ORSR nedostupný — nepodarilo sa nájsť výpis pre IČO {ico} (možný anti-bot blok).",
                        findings="Register dočasne nedostupný — nepodarilo sa načítať výpis.",
                    )

                # 4. Fetch detail page — try links, handle outdated/transferred
                detail_html, company_name = await self._fetch_detail_with_fallback(
                    client, extract_links, ico, orsr_extract_type
                )
                if detail_html is None:
                    return self._make_result(
                        status="SUCCESS",
                        file_path=None,
                        status_message=f"Výpis pre IČO {ico} nebol nájdený.",
                        findings="Záznam neexistuje alebo nebol nájdený.",
                    )

                logger.debug(f"[{self.source_type}] ⏱ detail fetch + meno: {time.perf_counter() - _t:.2f}s")
                _t = time.perf_counter()

                # 5. For CURRENT extract: also fetch FULL extract for analysis
                #    Skip when skip_full_extract=True (bulk mode) — saves 1 HTTP request per company
                full_extract_text = None
                if skip_full_extract:
                    logger.debug(f"[{self.source_type}] Skipping full extract fetch (bulk mode)")
                elif orsr_extract_type == "CURRENT":
                    full_links = self._find_extract_links(search_html, ico, link_name="Úplný")
                    if full_links:
                        full_html, _ = await self._fetch_detail_with_fallback(
                            client, full_links, ico, "FULL"
                        )
                        if full_html:
                            full_extract_text = self._html_to_text(full_html)
                elif orsr_extract_type == "FULL":
                    full_extract_text = self._html_to_text(detail_html)

                # 6. Generate PDF from HTML (skip for bulk mode)
                pdf_output = output_dir / f"orsr_{ico}.pdf"
                if skip_pdf:
                    logger.debug(f"[{self.source_type}] Skipping PDF generation (bulk mode)")
                else:
                    try:
                        pdf_ok = await self._html_to_pdf(detail_html, pdf_output, ico)
                        if pdf_ok == 0:
                            logger.error(f"[{self.source_type}] PDF validácia zlyhala — prázdne PDF.")
                            return self._make_result(status="FAILED", status_message="ORSR PDF je prázdne alebo neúplné — stránka sa nepodarila načítať.")
                        logger.debug(f"[{self.source_type}] ⏱ pdf gen: {time.perf_counter() - _t:.2f}s")
                        logger.info(f"[{self.source_type}] PDF: {pdf_output}")
                    except Exception as e:
                        logger.error(f"[{self.source_type}] PDF zlyhalo: {e}")
                        return self._make_result(status="FAILED", status_message=f"Chyba pri generovaní PDF z ORSR: {e}")

                # 7. Extract findings + persons + structured fields
                body_text = self._html_to_text(detail_html)
                findings = self._extract_findings(body_text)
                persons = self._extract_persons(body_text, html=detail_html)
                structured = self._extract_structured_fields(detail_html)
                self._extract_capital_contributions(detail_html, persons)

                logger.info(f"[{self.source_type}] ORSR hotový za {time.perf_counter() - _t:.1f}s")
                return self._make_result(
                    status="SUCCESS",
                    file_path=None if skip_pdf else str(pdf_output),
                    page_count=0 if skip_pdf else 1,
                    status_message="Výpis z ORSR úspešne stiahnutý.",
                    findings=findings,
                    company_name=company_name,
                    persons=persons,
                    full_extract_text=full_extract_text,
                    share_capital=structured["share_capital"],
                    signing_authority=structured["signing_authority"],
                    business_activity=structured["business_activity"],
                )
            finally:
                if owns_client:
                    await client.aclose()

        except httpx.TimeoutException:
            logger.error(f"[{self.source_type}] Timeout pri načítaní ORSR.")
            return self._make_result(status="UNAVAILABLE", status_message="Register ORSR je nedostupný — timeout.")
        except httpx.HTTPError as e:
            logger.error(f"[{self.source_type}] Sieťová chyba: {e}")
            return self._make_result(status="FAILED", status_message=f"Sieťová chyba pri spracovaní ORSR: {e}")
        except Exception as e:
            logger.error(f"[{self.source_type}] Nečakaná chyba: {e}", exc_info=True)
            return self._make_result(status="FAILED", status_message=f"{type(e).__name__}: {e}")

    @classmethod
    async def _get_shared_client(cls) -> httpx.AsyncClient:
        """Get or create the shared HTTP client for bulk mode.

        The client uses connection pooling (httpx default) with keep-alive,
        so subsequent requests to orsr.sk reuse the same TCP/TLS connection.
        """
        async with cls._shared_client_lock:
            if cls._shared_client is None or cls._shared_client.is_closed:
                cls._shared_client = httpx.AsyncClient(
                    timeout=30,
                    headers=_HEADERS,
                    follow_redirects=True,
                    limits=httpx.Limits(max_connections=20, max_keepalive_connections=10),
                )
            return cls._shared_client

    @classmethod
    async def close_shared_client(cls) -> None:
        """Close the shared HTTP client. Call after bulk processing is done."""
        async with cls._shared_client_lock:
            if cls._shared_client is not None and not cls._shared_client.is_closed:
                await cls._shared_client.aclose()
            cls._shared_client = None

    # ── HTTP helpers ─────────────────────────────────────────────────

    async def _fetch_with_retry(self, client: httpx.AsyncClient, url: str) -> str:
        """Fetch URL with unified retry on transient errors (timeout, 5xx, 429).
        Používa retry_async_call z unified retry helpera."""
        async def _do_fetch() -> str:
            resp = await client.get(url)
            if resp.status_code == 200:
                return resp.content.decode(_ORSR_ENCODING, errors="replace")
            if resp.status_code >= 500 or resp.status_code == 429:
                raise TransientHTTPError(
                    f"HTTP {resp.status_code}",
                    status_code=resp.status_code,
                    rate_limited=(resp.status_code == 429),
                )
            resp.raise_for_status()
            return resp.content.decode(_ORSR_ENCODING, errors="replace")

        return await retry_async_call(
            _do_fetch,
            source_type=self.source_type,
            max_attempts=_HTTP_RETRIES + 1,
            base_delay=_HTTP_RETRY_DELAY,
        )

    def _is_f5_challenge(self, html: str) -> bool:
        """Detect F5 anti-bot JavaScript challenge page."""
        return any(marker in html for marker in self._F5_MARKERS)

    async def _fetch_with_playwright(self, url: str, wait_for: str = None) -> str:
        """Fetch a URL using Playwright (can execute F5 JavaScript challenge).

        Returns page HTML as string. Uses the shared browser context from BaseScraper.
        """
        page = None
        try:
            page = await self._get_page(block_images=True, locale="sk-SK")
            await page.goto(url, wait_until="networkidle", timeout=30000)
            # Wait for actual content to appear (F5 challenge redirects/reloads)
            if wait_for:
                try:
                    await page.wait_for_selector(wait_for, timeout=15000)
                except Exception:
                    pass  # selector might not be present, continue anyway
            else:
                # Wait for body to have real content (not F5 challenge)
                await page.wait_for_function(
                    "() => document.body && document.body.innerHTML.length > 200 && !document.body.innerHTML.includes('bobcmn')",
                    timeout=15000,
                )
            html = await page.content()
            logger.info(f"[{self.source_type}] Playwright fetch OK (url={url[:80]})")
            return html
        except Exception as e:
            logger.warning(f"[{self.source_type}] Playwright fetch zlyhal: {e}")
            raise
        finally:
            if page:
                try:
                    await page.close()
                except Exception:
                    pass

    async def _fetch_search_page(self, client: httpx.AsyncClient, ico: str) -> str:
        """Fetch the search results page for given IČO.

        Skúša httpx prvej; ak detekuje F5 anti-bot challenge, fallback na Playwright.
        """
        url = f"{_SEARCH_URL}?ICO={ico}&SID=0"
        logger.info(f"[{self.source_type}] Navigujem na {url}")
        html = await self._fetch_with_retry(client, url)

        # F5 anti-bot detection → Playwright fallback
        if self._is_f5_challenge(html):
            logger.warning(f"[{self.source_type}] F5 anti-bot challenge detekovaný — prepnem na Playwright.")
            html = await self._fetch_with_playwright(url, wait_for="a[href*='vypis.asp']")

        return html

    async def _fetch_detail_page(self, client: httpx.AsyncClient, detail_url: str) -> str:
        """Fetch a detail (vypis) page.

        Skúša httpx prvej; ak detekuje F5 anti-bot challenge, fallback na Playwright.
        """
        html = await self._fetch_with_retry(client, detail_url)

        if self._is_f5_challenge(html):
            logger.warning(f"[{self.source_type}] F5 anti-bot challenge na detail page — prepnem na Playwright.")
            html = await self._fetch_with_playwright(detail_url, wait_for="table")

        return html

    # ── Parsing helpers ──────────────────────────────────────────────

    def _is_empty_results(self, html: str) -> bool:
        """Check if search returned no results."""
        return any(marker in html for marker in _EMPTY_MARKERS)

    def _find_extract_links(self, html: str, ico: str, link_name: str = None) -> list[str]:
        """Find detail page URLs from search results.

        Returns list of absolute URLs like:
        https://www.orsr.sk/vypis.asp?ID=23042&SID=2&P=0  (Aktuálny)
        https://www.orsr.sk/vypis.asp?ID=23042&SID=2&P=1  (Úplný)

        If link_name is specified ('Aktuálny' or 'Úplný'), filters to that type.
        P=0 = Aktuálny, P=1 = Úplný
        """
        soup = BeautifulSoup(html, "lxml")
        links = []
        for a in soup.find_all("a", href=True):
            href = a["href"]
            if "vypis.asp" not in href:
                continue
            # Build absolute URL
            if href.startswith("http"):
                full_url = href
            elif href.startswith("/"):
                full_url = f"https://www.orsr.sk{href}"
            else:
                full_url = f"https://www.orsr.sk/{href}"

            # Normalize &amp; in href
            full_url = full_url.replace("&amp;", "&")

            # Filter by link type if requested
            if link_name:
                link_text = a.get_text(strip=True)
                if link_name == "Aktuálny" and "P=1" in full_url:
                    continue  # P=1 is Úplný, skip for Aktuálny
                if link_name == "Úplný" and "P=0" in full_url:
                    continue  # P=0 is Aktuálny, skip for Úplný
                # Also match by text content
                if link_text and link_name not in link_text:
                    continue

            links.append(full_url)

        # If link_name filtering produced nothing, fall back to all vypis.asp links
        if not links and link_name:
            return self._find_extract_links(html, ico, link_name=None)

        # Deduplicate while preserving order
        seen = set()
        unique = []
        for url in links:
            if url not in seen:
                seen.add(url)
                unique.append(url)
        return unique

    async def _fetch_detail_with_fallback(
        self, client: httpx.AsyncClient, links: list[str], ico: str, extract_type: str
    ) -> tuple[Optional[str], Optional[str]]:
        """Try each detail link, handling outdated/transferred markers.

        Returns (detail_html, company_name) or (None, None).
        """
        for url in links:
            try:
                detail_html = await self._fetch_detail_page(client, url)
            except Exception as e:
                logger.warning(f"[{self.source_type}] Chyba pri fetch {url}: {e}")
                continue

            # Check for outdated/transfer markers
            if _OUTDATED_MARKER in detail_html:
                logger.info(f"[{self.source_type}] Výpis je neaktuálny — hľadám odkaz na aktuálny.")
                # Look for "aktuálny výpis" link in the HTML
                soup = BeautifulSoup(detail_html, "lxml")
                current_link = None
                for a in soup.find_all("a", href=True):
                    if "aktuálny výpis" in a.get_text(strip=True).lower():
                        href = a["href"]
                        current_link = href if href.startswith("http") else f"https://www.orsr.sk/{href.lstrip('/')}"
                        break
                if current_link:
                    try:
                        detail_html = await self._fetch_detail_page(client, current_link)
                        if _OUTDATED_MARKER not in detail_html and _TRANSFERRED_MARKER not in detail_html:
                            logger.info(f"[{self.source_type}] Nájdený platný výpis po skoku.")
                        elif _TRANSFERRED_MARKER in detail_html:
                            logger.info(f"[{self.source_type}] Nasledovaný výpis je odstúpený — skúšam ďalší.")
                            continue
                    except Exception:
                        logger.warning(f"[{self.source_type}] Skok na aktuálny výpis zlyhal — skúšam ďalší.")
                        continue
                else:
                    logger.warning(f"[{self.source_type}] Odkaz na aktuálny výpis sa nenašiel — skúšam ďalší.")
                    continue

            if _TRANSFERRED_MARKER in detail_html:
                logger.info(f"[{self.source_type}] Spis odstúpený — skúšam ďalší odkaz.")
                continue

            # Extract company name
            company_name = self._extract_company_name_from_detail(detail_html)
            logger.info(f"[{self.source_type}] Company name z detailu: {company_name}")
            return detail_html, company_name

        # Last resort: try the last link even if transferred
        if links:
            try:
                detail_html = await self._fetch_detail_page(client, links[-1])
                company_name = self._extract_company_name_from_detail(detail_html)
                return detail_html, company_name
            except Exception:
                pass
        return None, None

    def _extract_company_name_from_detail(self, html: str) -> Optional[str]:
        """Extract company name from detail page HTML.

        Looks for 'Obchodné meno:' label in table rows.
        In Úplný výpis, cell after label contains all historical names concatenated.
        We take only the first name (before first '(od:' marker).
        """
        soup = BeautifulSoup(html, "lxml")
        for table in soup.find_all("table"):
            for row in table.find_all("tr"):
                cells = row.find_all("td")
                for i, cell in enumerate(cells):
                    text = cell.get_text(strip=True).lower()
                    if "obchodné meno" in text and i + 1 < len(cells):
                        name_val = cells[i + 1].get_text(strip=True)
                        if name_val:
                            # Take only the first name before (od: ...) marker
                            # Úplný výpis has: "CurrentName(od: date)OldName(od: date2 do: date3)"
                            first_name = re.split(r'\s*\(od:', name_val, maxsplit=1)[0].strip()
                            return self._clean_company_name(first_name)
        return None

    def _extract_company_name_from_search(self, html: str, ico: str) -> Optional[str]:
        """Fallback: extract company name from search results table."""
        soup = BeautifulSoup(html, "lxml")
        # Find links to vypis.asp that are company names (not Aktuálny/Úplny)
        for a in soup.find_all("a", href=True):
            if "vypis.asp" not in a["href"]:
                continue
            text = a.get_text(strip=True)
            if text and text not in ("Aktuálny", "Úplný"):
                return self._clean_company_name(text)
        # Fallback: find <b> in rows containing IČO
        for row in soup.find_all("tr"):
            row_text = row.get_text()
            if ico in row_text:
                b = row.find("b")
                if b:
                    return self._clean_company_name(b.get_text(strip=True))
        return None

    @staticmethod
    def _clean_company_name(raw: str) -> str:
        """Očistí obchodné meno — úvodzovky, trailing obec za právnou formou, (od: ...) suffix."""
        name = raw.strip()
        # Remove "(od: DD.MM.YYYY)" suffix that ORSR appends to company names
        name = re.sub(r'\s*\(od:\s*\d{2}\.\d{2}\.\d{4}\)\s*$', '', name)
        m = _QUOTE_RE.match(name)
        if m:
            return m.group(1).strip()
        return _LEGAL_FORM_RE.sub(r'\1', name).strip()

    def _html_to_text(self, html: str) -> str:
        """Convert HTML to plain text (similar to page.inner_text('body'))."""
        soup = BeautifulSoup(html, "lxml")
        # Remove script/style tags
        for tag in soup(["script", "style"]):
            tag.decompose()
        body = soup.find("body") or soup
        # Get text with line breaks preserved
        text = body.get_text(separator="\n", strip=True)
        # Collapse multiple blank lines
        lines = [l.strip() for l in text.split("\n")]
        return "\n".join(l for l in lines if l)

    # ── Findings & Persons (unchanged logic, text-based) ─────────────

    def _extract_findings(self, text: str) -> str:
        text_lower = text.lower()
        if "v likvidácii" in text_lower:
            return "POZOR: Spoločnosť je v likvidácii."
        if "vymazaná z obchodného registra" in text_lower:
            return "POZOR: Spoločnosť je vymazaná z ORSR."
        return "Aktívna spoločnosť v ORSR (bez zistených anomálií)."

    # ── Structured field extraction (HTML-based, for bulk seeding) ─────

    def _extract_structured_fields(self, html: str) -> dict:
        """Extrahuje shareCapital, signingAuthority, businessActivity z HTML výpisu.
        Vráti dict s kľúčmi: share_capital, signing_authority, business_activity.
        """
        soup = BeautifulSoup(html, "lxml")
        return {
            "share_capital": self._extract_share_capital(soup),
            "signing_authority": self._extract_signing_authority(soup),
            "business_activity": self._extract_business_activity(soup),
        }

    @staticmethod
    def _extract_share_capital(soup: BeautifulSoup) -> Optional[float]:
        """Extrahuje základné imanie z HTML výpisu.
        Pre a.s.: label 'Výška základného imania:' → '4 069 176,126944 EUR Rozsah splatenia: ...'
        Pre s.r.o.: imanie = súčet vkladov spoločníkov (nie je explicitné v ORSR).
        """
        for table in soup.find_all("table"):
            for row in table.find_all("tr"):
                cells = row.find_all("td")
                for i, cell in enumerate(cells):
                    text = cell.get_text(strip=True).lower()
                    if "základného imania" in text and i + 1 < len(cells):
                        val_text = cells[i + 1].get_text(" ", strip=True)
                        # Pattern: "4 069 176,126944 EUR" or "5 000 EUR"
                        m = re.search(r'([\d\s,.]+)\s*EUR', val_text)
                        if m:
                            amount_str = m.group(1).replace("\xa0", "").replace(" ", "").replace(",", ".")
                            try:
                                return float(amount_str)
                            except ValueError:
                                pass
        return None

    @staticmethod
    def _extract_signing_authority(soup: BeautifulSoup) -> Optional[str]:
        """Extrahuje 'Konanie menom spoločnosti' z HTML výpisu."""
        for table in soup.find_all("table"):
            for row in table.find_all("tr"):
                cells = row.find_all("td")
                for i, cell in enumerate(cells):
                    text = cell.get_text(strip=True).lower()
                    if "konanie menom spoločnosti" in text and i + 1 < len(cells):
                        val_text = cells[i + 1].get_text(" ", strip=True)
                        # Remove "(od: DD.MM.YYYY)" suffixes
                        cleaned = re.sub(r'\s*\(od:\s*\d{2}\.\d{2}\.\d{4}\)\s*', ' ', val_text).strip()
                        if cleaned:
                            return cleaned
        return None

    @staticmethod
    def _extract_business_activity(soup: BeautifulSoup) -> Optional[str]:
        """Extrahuje 'Predmet podnikania (činnosti)' z HTML výpisu."""
        for table in soup.find_all("table"):
            for row in table.find_all("tr"):
                cells = row.find_all("td")
                for i, cell in enumerate(cells):
                    text = cell.get_text(strip=True).lower()
                    if "predmet podnikania" in text and i + 1 < len(cells):
                        val_text = cells[i + 1].get_text(" ", strip=True)
                        # Remove "(od: DD.MM.YYYY)" suffixes
                        cleaned = re.sub(r'\s*\(od:\s*\d{2}\.\d{2}\.\d{4}\)\s*', ' ', val_text).strip()
                        if cleaned:
                            return cleaned
        return None

    def _extract_capital_contributions(self, html: str, persons: list[PersonInfo]) -> None:
        """Extrahuje vklady spoločníkov z 'Výška vkladu každého spoločníka:' sekcie.
        HTML-based parser — správne spojuje mená rozbité na <span> elementy.
        Updatuje existujúce PersonInfo objekty (spoločníci) s capital_contribution a capital_paid.
        """
        soup = BeautifulSoup(html, "lxml")

        # Nájdime sekciu "Výška vkladu každého spoločníka"
        contributions: list[tuple[str, float, float]] = []  # (name, vklad, splatene)

        for table in soup.find_all("table"):
            for row in table.find_all("tr"):
                cells = row.find_all("td")
                for i, cell in enumerate(cells):
                    text = cell.get_text(strip=True).lower()
                    if "výška vkladu každého spoločníka" in text and i + 1 < len(cells):
                        # Obsah je v ďalšej bunke — vnorené tabuľky s entries
                        content_cell = cells[i + 1]
                        for sub_table in content_cell.find_all("table"):
                            sub_rows = sub_table.find_all("tr")
                            for sr in sub_rows:
                                sr_cells = sr.find_all("td")
                                if not sr_cells:
                                    continue
                                # Prvý stĺpec = meno + vklad, druhý = dátum
                                left = sr_cells[0]
                                left_text = left.get_text(" ", strip=True)
                                # Pattern: "Peter Krcho Vklad: 3 000 EUR Splatené: 3 000 EUR"
                                m = re.search(r'Vklad:\s*([\d\s,.]+)\s*EUR\s*Splatené:\s*([\d\s,.]+)\s*EUR', left_text, re.IGNORECASE)
                                if m:
                                    vklad_str = m.group(1).replace("\xa0", "").replace(" ", "").replace(",", ".")
                                    splatene_str = m.group(2).replace("\xa0", "").replace(" ", "").replace(",", ".")
                                    try:
                                        vklad = float(vklad_str)
                                        splatene = float(splatene_str)
                                    except ValueError:
                                        continue
                                    # Meno = všetko pred "Vklad:"
                                    name_part = left_text[:m.start()].strip()
                                    name_part = re.sub(r'\s*\(od:\s*\d{2}\.\d{2}\.\d{4}\)\s*$', '', name_part).strip()
                                    if name_part:
                                        contributions.append((name_part, vklad, splatene))

        # Match contributions to existing spolocnik persons
        for name, vklad, splatene in contributions:
            for person in persons:
                if person.role != "spolocnik":
                    continue
                # Try clean_name match
                if person.clean_name and person.clean_name in name:
                    person.capital_contribution = vklad
                    person.capital_paid = splatene
                    break
                # Try raw_name match
                if person.raw_name and person.raw_name in name:
                    person.capital_contribution = vklad
                    person.capital_paid = splatene
                    break

    def _extract_persons(self, text: str, html: str = None) -> list[PersonInfo]:
        """Extrahuje osoby z sekcií 'Štatutárny orgán', 'Dozorná rada', 'Spoločníci'.
        Primárne HTML-based parser (správne spojuje <span> mená), fallback na text-based.
        """
        persons: list[PersonInfo] = []
        if html:
            persons.extend(self._parse_persons_from_html(html, "Spoločníci", "spolocnik"))
            persons.extend(self._parse_persons_from_html(html, "Štatutárny orgán", "statutar"))
            persons.extend(self._parse_persons_from_html(html, "Dozorná rada", "dozorna_rada"))
        if not persons:
            persons.extend(self._parse_persons_from_section(text, "Štatutárny orgán", "statutar"))
            persons.extend(self._parse_persons_from_section(text, "Dozorná rada", "dozorna_rada"))
            persons.extend(self._parse_persons_from_section(text, "Spoločníci", "spolocnik"))
        if persons:
            logger.info(f"[{self.source_type}] Extrahovaných {len(persons)} osôb z ORSR výpisu.")
        return persons

    @staticmethod
    def _parse_persons_from_html(html: str, label_text: str, role: str) -> list[PersonInfo]:
        """HTML-based parser pre osoby z ORSR výpisu.
        Správne spojuje mená rozbité na <span class='ra'> elementy.
        """
        soup = BeautifulSoup(html, "lxml")
        persons: list[PersonInfo] = []
        for span in soup.find_all("span", class_="tl"):
            lt = span.get_text(strip=True)
            if label_text not in lt:
                continue
            td = span.find_parent("td")
            if not td:
                continue
            tr = td.find_parent("tr")
            if not tr:
                continue
            tds = tr.find_all("td")
            if len(tds) < 2:
                continue
            content = tds[1]
            for sub in content.find_all("table", recursive=False):
                for sr in sub.find_all("tr"):
                    cells = sr.find_all("td")
                    if not cells:
                        continue
                    left = cells[0]
                    full = left.get_text(" ", strip=True)
                    # Name from <a> or first <span class=ra> without digits
                    a = left.find("a")
                    if a and a.get_text(strip=True):
                        raw_name = a.get_text(" ", strip=True)
                    else:
                        raw_name = ""
                        for s in left.find_all("span", class_="ra"):
                            t = s.get_text(strip=True)
                            if t and not any(c.isdigit() for c in t):
                                raw_name = t
                                break
                    if not raw_name or len(raw_name) < 3:
                        continue
                    # Skip role labels like "konatelia", "predstavenstvo"
                    _ROLE_LABELS = {"konatelia", "predstavenstvo", "konateľ", "predseda predstavenstva",
                                    "podpredseda predstavenstva", "člen predstavenstva"}
                    if raw_name.lower().strip() in _ROLE_LABELS:
                        continue
                    # Clean name
                    words = raw_name.split()
                    name_words = [w for w in words if w.lower().rstrip(".,") not in ACADEMIC_TITLES]
                    name_words = [w for w in name_words if w.rstrip(".,;") and any(c.isalpha() for c in w)]
                    clean_name = " ".join(name_words) if len(name_words) >= 2 else raw_name
                    # ZIP
                    zm = ZIP_RE.search(full)
                    zip_code = zm.group(1).replace(" ", "") if zm else None
                    # City
                    city = None
                    if zm:
                        after = full[full.find(raw_name) + len(raw_name):]
                        cm = re.search(
                            r'([A-ZÁ-Ž][a-zá-ž]+(?:\s+[A-Za-zá-ž]+)*)\s+' + re.escape(zm.group(1)),
                            after,
                        )
                        if cm:
                            city = cm.group(1)
                    # Extract function dates: (od: DD.MM.YYYY do: DD.MM.YYYY) or (od: DD.MM.YYYY)
                    function_start = None
                    function_end = None
                    od_match = re.search(r'\(od:\s*(\d{2}\.\d{2}\.\d{4})', full)
                    if od_match:
                        d, m, y = od_match.group(1).split(".")
                        function_start = datetime(int(y), int(m), int(d))
                    do_match = re.search(r'do:\s*(\d{2}\.\d{2}\.\d{4})\)', full)
                    if do_match:
                        d, m, y = do_match.group(1).split(".")
                        function_end = datetime(int(y), int(m), int(d))
                    is_active = function_end is None
                    persons.append(PersonInfo(
                        raw_name=raw_name, clean_name=clean_name,
                        city=city, zip_code=zip_code, role=role,
                        function_start=function_start, function_end=function_end,
                        is_active=is_active,
                    ))
        return persons

    @staticmethod
    def _parse_persons_from_section(text: str, section_label: str, role: str) -> list[PersonInfo]:
        """Parsovanie osôb z konkrétnej sekcie ORSR výpisu.
        ORSR výpis má formát:
          Štatutárny orgán:    konatelia
            (od: 11.03.2025)
            Peter Kurucz
            Kožušnícka 2661/23
            Trenčín 911 05
        """
        persons: list[PersonInfo] = []
        # Nájdeme sekciu — label je na začiatku riadku, nasleduje obsah
        section_start = text.find(section_label + ":")
        if section_start == -1:
            return persons

        # Získame text sekcie — od labelu do ďalšieho labelu (riadok začínajúci slovom a končiaci ':')
        after_section = text[section_start + len(section_label) + 1:]
        lines = after_section.split("\n")

        # Nájdeme koniec sekcie — ďalší riadok ktorý vyzerá ako label (slovo + ':')
        section_lines: list[str] = []
        _LABEL_RE = re.compile(r'^[A-ZÁ-Ž][a-zá-ž]+\s*[a-zá-ž]*:')
        # Sub-labely ktoré sa objavujú vnútri sekcií a nesmú ukončiť parsovanie
        _SUBLABELS = {"vznik funkcie", "konanie menom", "spôsob konania", "dátum aktualizácie"}
        for line in lines[1:]:  # preskočíme prvý riadok (label)
            stripped = line.strip()
            if not stripped:
                if section_lines:
                    # prázdny riadok môže byť medzi záznamami, ale ak už máme osoby, sekcia môže pokračovať
                    continue
                continue
            if _LABEL_RE.match(stripped) and len(stripped) < 60:
                # Skontroluj či to nie je sub-label (napr. "Vznik funkcie:")
                if stripped.lower().split(":")[0].strip() in _SUBLABELS:
                    section_lines.append(stripped)
                    continue
                break  # ďalší section label — koniec sekcie
            section_lines.append(stripped)

        # Parsovanie osôb z section_lines
        # Osoba = meno (obsahuje písmená, môže mať tituly), nasleduje adresa (ulica, mesto PSČ)

        # Blacklist fráz zo štruktúry ORSR výpisu, ktoré nie sú mená osôb
        _BLACKLIST_PHRASES = {
            "konanie", "konanie menom", "za spoločnosť", "za spolocnost",
            "výška", "vyska", "vklad", "imanie", "splatené", "splatene",
            "základné", "zakladne", "podpisovanie", "podpis",
            "spôsob", "spôsob konania", " obchodné", "obchodne meno",
            "pripojí", "pripoji", "vykonáva", "vykonava",
            "samostatne", "spoločne", "spolocne",
            "záložné", "zalozne", "záložné právo", "zalozne pravo",
            "prevod", "prevod podielu", "zmena",
        }

        # Názvy štátov a právnických osôb, ktoré sa môžu objaviť ako spoločníci
        # v ORSR výpise — nie sú to fyzické osoby a nesmú sa kontrolovať v registri diskvalifikácií
        _NON_PERSON_KEYWORDS = {
            "republika", "spolková", "veľkovojvodstvo", "vojvodstvo",
            "kráľovstvo", "kralovstvo", "federácia", "federacia",
            "štáty", "staty", "štát", "stat",
            "spoločnosť", "spolocnost", "corporation", "corp", "inc",
            "gmbh", "ag", "sarl", "ltd", "limited", "llc", "sa", "nv", "bv",
            "holding", "holdings", "group", "partners", "capital",
            "trust", "foundation", "stiftung", "gesmbH",
        }

        def _is_human_name(line: str) -> bool:
            """Validuje či riadok vyzerá ako reálne meno fyzickej osoby (nie štát, firma ani štrukturálny text ORSR)."""
            # Odstrániť role sufixy po " - " (napr. "Ivan Kollárik - Predseda predstavenstva")
            if " - " in line:
                line = line.split(" - ")[0].strip()
            lowered = line.lower().strip()
            # Nesmie obsahovať dvojbodku (štrukturálne labely)
            if ":" in lowered:
                return False
            # Nesmie obsahovať čísla (ulice, výšky, dátumy)
            if any(c.isdigit() for c in line):
                return False
            # Nesmie byť príliš dlhé (vety z ORSR štruktúry)
            if len(line) > 60:
                return False
            # Blacklist fráz
            for phrase in _BLACKLIST_PHRASES:
                if phrase in lowered:
                    return False
            # Nesmie obsahovať kľúčové slová štátov/právnických osôb
            for keyword in _NON_PERSON_KEYWORDS:
                if keyword in lowered:
                    return False
            # Musí obsahovať aspoň 2 slová po odstránení titulov a interpunkcie
            words = line.split()
            name_words = [w for w in words if w.lower().rstrip(".,") not in ACADEMIC_TITLES]
            # Odstrániť čisté interpunkčné tokeny (",", ".", "PhD.,", "LL.M.")
            name_words = [w for w in name_words if w.rstrip(".,;") and any(c.isalpha() for c in w)]
            if len(name_words) < 2:
                return False
            # Všetky slová musia byť alfabetické (po odstránení titulov a interpunkcie)
            for w in name_words:
                if not w.isalpha():
                    return False
            return True

        i = 0
        while i < len(section_lines):
            line = section_lines[i]
            # Preskočiť funkcie (konatelia, predstavenstvo, etc.) a dátumy (od: ...)
            if line.lower().startswith("od:") or line.startswith("("):
                i += 1
                continue
            # Skontrolovať či to vyzerá ako meno (obsahuje písmená, nie číslo na začiatku)
            if line[0].isdigit():
                i += 1
                continue
            # Validovať či je to reálne meno osoby
            if not _is_human_name(line):
                i += 1
                continue
            # Odstrániť role sufixy pre čisté meno (napr. "Ivan Kollárik - Predseda predstavenstva")
            name_part = line.split(" - ")[0].strip() if " - " in line else line
            # Rozdeliť na slová
            words = name_part.split()
            # Odstrániť tituly a interpunkčné tokeny
            name_words = [w for w in words if w.lower().rstrip(".,") not in ACADEMIC_TITLES]
            name_words = [w for w in name_words if w.rstrip(".,;") and any(c.isalpha() for c in w)]
            if len(name_words) < 2:
                i += 1
                continue
            raw_name = line
            clean_name = " ".join(name_words)

            # Hľadať adresu v nasledujúcich riadkoch
            city = None
            zip_code = None
            function_start = None
            function_end = None
            for j in range(i + 1, min(i + 4, len(section_lines))):
                addr_line = section_lines[j]
                # Check for "od:" / "do:" date line
                od_match = re.search(r'\(od:\s*(\d{2}\.\d{2}\.\d{4})', addr_line)
                if od_match:
                    d, m, y = od_match.group(1).split(".")
                    function_start = datetime(int(y), int(m), int(d))
                do_match = re.search(r'do:\s*(\d{2}\.\d{2}\.\d{4})\)', addr_line)
                if do_match:
                    d, m, y = do_match.group(1).split(".")
                    function_end = datetime(int(y), int(m), int(d))
                # Ak ďalší riadok vyzerá ako ďalšie meno (nie adresa), skonči
                if addr_line[0].isalpha() and not ZIP_RE.search(addr_line) and "," not in addr_line and " " in addr_line:
                    # Skontroluj či to nie je len mestský názov bez PSČ
                    if not any(c.isdigit() for c in addr_line):
                        # Mohlo by to byť mesto — skontroluj ďalší riadok
                        continue
                    break
                zip_match = ZIP_RE.search(addr_line)
                if zip_match:
                    zip_code = zip_match.group(1).replace(" ", "")
                    # Mesto = zvyšok riadku bez PSČ
                    city_part = ZIP_RE.sub("", addr_line).strip(" ,")
                    if city_part:
                        city = city_part
                    break
                # Ak riadok obsahuje len písmená a je to posledný pred PSČ
                if addr_line[0].isalpha() and not any(c.isdigit() for c in addr_line):
                    city = addr_line.strip()

            is_active = function_end is None
            persons.append(PersonInfo(
                raw_name=raw_name,
                clean_name=clean_name,
                city=city,
                zip_code=zip_code,
                role=role,
                function_start=function_start,
                function_end=function_end,
                is_active=is_active,
            ))
            i += 1

        return persons

    # ── PDF generation ───────────────────────────────────────────────

    async def _html_to_pdf(self, html: str, output_path: Path, ico: str) -> int:
        """Generate PDF from ORSR HTML using Playwright set_content (no navigation).

        Uses the existing browser context directly — no stealth JS, proxy, or UA rotation
        overhead from _get_page(). Just set_content + print to PDF.
        """
        import os
        page = None
        context = None
        try:
            # Use browser directly — skip _get_page() overhead (stealth, proxy, UA rotation)
            if self.browser is None:
                # Fallback: if no browser injected, use _get_page
                page = await self._get_page(block_images=False)
            else:
                context = await self.browser.new_context()
                page = await context.new_page()

            # Strip <img> tags to prevent network requests during PDF rendering
            # ORSR HTML contains status icons that trigger network fetches
            from bs4 import BeautifulSoup as _BS
            body_soup = _BS(html, "lxml")
            for img in body_soup.find_all("img"):
                img.decompose()
            body_html = body_soup.find("body") or body_soup
            body_inner = body_html.decode_contents()

            # Inject CSS for proper print formatting
            styled_html = f"""<html><head><meta charset="utf-8">
<style>
body {{ font-family: 'Arial', sans-serif; font-size: 11px; }}
table {{ width: 100%; border-collapse: collapse; }}
td {{ padding: 2px 4px; vertical-align: top; }}
.tl {{ font-weight: bold; white-space: nowrap; }}
.ra {{ }}
a {{ color: black; text-decoration: none; }}
</style></head><body>{body_inner}</body></html>"""

            # "commit" = don't wait for network — we already stripped all external resources
            await page.set_content(styled_html, wait_until="commit")
            await page.pdf(
                path=str(output_path),
                format="A4",
                print_background=True,
                margin={"top": "10mm", "bottom": "10mm", "left": "10mm", "right": "10mm"},
            )
            file_size = os.path.getsize(output_path)
            if file_size < 1000:
                logger.warning(f"[{self.source_type}] PDF je podozrivo malé ({file_size}B).")
                return 0
            return 1
        except Exception as e:
            logger.error(f"[{self.source_type}] PDF generovanie zlyhalo: {e}")
            return 0
        finally:
            if page:
                try:
                    await page.close()
                except Exception:
                    pass
            if context:
                try:
                    await context.close()
                except Exception:
                    pass
