from __future__ import annotations
import logging
import re
import time
from pathlib import Path
from typing import Optional

from playwright.async_api import Page, TimeoutError as PlaywrightTimeoutError, Error as PlaywrightError

from .base import BaseScraper, ScraperUnavailableError
from ..models import ScrapedSource

logger = logging.getLogger(__name__)

_EMPTY_MARKERS = ("Nenašli sa žiadne", "Podmienkam nevyhovuje žiadny")
_OUTDATED_MARKER = "Výpis je neaktuálny"
_TRANSFERRED_MARKER = "Spis odstúpený na iný registrový súd"

_LEGAL_FORM_RE = re.compile(
    r'((?:spol\.\s*s\s*r\.\s*o\.|s\.?\s*r\.?\s*o\.|a\.\s*s\.|v\.\s*o\.\s*s\.|k\.\s*s\.))\.?\s.*$',
    re.IGNORECASE,
)
_QUOTE_RE = re.compile(r'^["\']+(.+?)["\']+')


class OrsrScraper(BaseScraper):
    """Scraper pre Obchodný register SR (ORSR). Hľadá firmu podľa IČO a sťahuje PDF výpis."""

    source_type = "ORSR"
    base_url = "https://www.orsr.sk/hladaj_ico.asp"

    # ── Public ───────────────────────────────────────────────────────

    async def run(self, *, ico: str, output_dir: Path, orsr_extract_type: str = "CURRENT", **kwargs) -> ScrapedSource:
        page: Optional[Page] = None
        try:
            logger.info(f"[{self.source_type}] Začínam pre IČO: {ico} (typ: {orsr_extract_type})")
            _t = time.perf_counter()
            page = await self._get_page(block_images=False)
            logger.debug(f"[{self.source_type}] ⏱ get_page: {time.perf_counter() - _t:.2f}s")

            await self._navigate_to_search(page, ico)
            logger.debug(f"[{self.source_type}] ⏱ goto: {time.perf_counter() - _t:.2f}s")
            _t = time.perf_counter()

            if await self._is_empty_results(page):
                return self._make_result(
                    status="SUCCESS",
                    file_path=None,
                    status_message=f"IČO {ico} nebolo nájdené v ORSR.",
                    findings="Žiadny záznam v Obchodnom registri SR.",
                )

            link_name = "Úplný" if orsr_extract_type == "FULL" else "Aktuálny"
            company_name = await self._click_extract_link(page, link_name)
            if company_name is None:
                # Fallback: skús extrahovať meno z vyhľadávacej tabuľky
                company_name = await self._extract_company_name_from_search(page, ico)
            if company_name is None:
                return self._make_result(
                    status="SUCCESS",
                    file_path=None,
                    status_message=f"Výpis pre IČO {ico} nebol nájdený.",
                    findings="Záznam neexistuje alebo nebol nájdený.",
                )
            logger.debug(f"[{self.source_type}] ⏱ detail_click + meno: {time.perf_counter() - _t:.2f}s")
            _t = time.perf_counter()

            pdf_output = output_dir / f"orsr_{ico}.pdf"
            try:
                await self._print_page_to_pdf(page, pdf_output)
                logger.debug(f"[{self.source_type}] ⏱ print_pdf: {time.perf_counter() - _t:.2f}s")
                logger.info(f"[{self.source_type}] PDF: {pdf_output}")
            except Exception as e:
                logger.error(f"[{self.source_type}] PDF zlyhalo: {e}")
                return self._make_result(status="FAILED", status_message=f"Chyba pri generovaní PDF z ORSR: {e}")

            findings = await self._extract_findings(page)
            return self._make_result(
                status="SUCCESS",
                file_path=str(pdf_output),
                page_count=1,
                status_message="Výpis z ORSR úspešne stiahnutý.",
                findings=findings,
                company_name=company_name,
            )
        except ScraperUnavailableError as e:
            logger.error(f"[{self.source_type}] Nedostupný: {e}")
            return self._make_result(status="UNAVAILABLE", status_message=f"Register ORSR je nedostupný: {e}")
        except PlaywrightError as e:
            logger.error(f"[{self.source_type}] Playwright chyba: {e}")
            return self._make_result(status="FAILED", status_message=f"Sieťová chyba pri spracovaní ORSR: {e}")
        except Exception as e:
            logger.error(f"[{self.source_type}] Nečakaná chyba: {e}", exc_info=True)
            return self._make_result(status="FAILED", status_message=f"{type(e).__name__}: {e}")
        finally:
            if page:
                await page.close()

    # ── Private helpers ──────────────────────────────────────────────

    async def _navigate_to_search(self, page: Page, ico: str) -> None:
        search_url = f"{self.base_url}?ICO={ico}&SID=0"
        logger.info(f"[{self.source_type}] Navigujem na {search_url}")
        try:
            await page.goto(search_url, timeout=45000, wait_until="domcontentloaded")
        except PlaywrightTimeoutError:
            raise ScraperUnavailableError("Timeout pri načítaní stránky ORSR.")

    async def _is_empty_results(self, page: Page) -> bool:
        text = await page.inner_text("body")
        return any(marker in text for marker in _EMPTY_MARKERS)

    async def _click_extract_link(self, page: Page, link_name: str) -> Optional[str]:
        """Nájde odkaz 'Aktuálny'/'Úplný', klikne naň a extrahuje company_name z detailnej stránky.
        Ak výpis obsahuje 'Výpis je neaktuálny', nasleduje odkaz na aktuálny výpis.
        Ak výpis obsahuje 'Spis odstúpený', skúsi ďalší odkaz v zozname výsledkov."""
        links = page.get_by_role("link", name=link_name)
        link_count = await links.count()
        if link_count == 0:
            logger.warning(f"[{self.source_type}] Odkaz '{link_name}' nenájdený.")
            return None

        for attempt in range(link_count):
            logger.info(f"[{self.source_type}] Klikám '{link_name}' (riadok {attempt + 1}/{link_count}).")
            detail_link = links.nth(attempt)
            await detail_link.click()
            await page.wait_for_load_state("domcontentloaded", timeout=45000)

            body_text = await page.inner_text("body")

            # Ak je výpis neaktuálny (zmena právnej formy), klikni na odkaz na aktuálny výpis
            if _OUTDATED_MARKER in body_text:
                logger.info(f"[{self.source_type}] Výpis je neaktuálny — nasledujem odkaz na aktuálny výpis.")
                current_link = page.locator("a:has-text('aktuálny výpis')")
                try:
                    await current_link.wait_for(timeout=5000)
                    await current_link.first.click()
                    await page.wait_for_load_state("domcontentloaded", timeout=45000)
                    body_text = await page.inner_text("body")
                except PlaywrightTimeoutError:
                    logger.warning(f"[{self.source_type}] Odkaz na aktuálny výpis sa nenašiel — používam tento výpis.")

            # Ak je spis odstúpený na iný súd, skús ďalší odkaz
            if _TRANSFERRED_MARKER in body_text:
                logger.info(f"[{self.source_type}] Spis odstúpený — skúšam ďalší odkaz.")
                await page.go_back()
                await page.wait_for_load_state("domcontentloaded", timeout=45000)
                continue

            # Výpis je OK — extrahuj company_name
            company_name = await self._extract_company_name_from_detail(page)
            logger.info(f"[{self.source_type}] Company name z detailu: {company_name}")
            return company_name

        logger.warning(f"[{self.source_type}] Všetky odkazy majú spis odstúpený — používam posledný.")
        await page.go_back()
        await page.wait_for_load_state("domcontentloaded", timeout=45000)
        links = page.get_by_role("link", name=link_name)
        await links.last.click()
        await page.wait_for_load_state("domcontentloaded", timeout=45000)
        company_name = await self._extract_company_name_from_detail(page)
        return company_name

    async def _extract_company_name_from_detail(self, page: Page) -> Optional[str]:
        """Extrahuje obchodné meno z detailnej stránky výpisu ORSR.
        Na detailnej stránke je aktuálny názov vždy uvedený ako hodnota v tabuľke."""
        try:
            # ORSR detail má tabuľku s riadkami typu: <td>Obchodné meno:</td><td>Názov spoločnosti</td>
            # Hľadáme riadok obsahujúci 'Obchodné meno' a berieme hodnotu z vedľajšej bunky
            rows = page.locator("table tr")
            count = await rows.count()
            for i in range(count):
                row = rows.nth(i)
                cells = row.locator("td")
                cell_count = await cells.count()
                for c in range(cell_count):
                    try:
                        val = (await cells.nth(c).inner_text(timeout=2000)).strip()
                    except PlaywrightTimeoutError:
                        continue
                    if "obchodné meno" in val.lower() and c + 1 < cell_count:
                        name_val = (await cells.nth(c + 1).inner_text(timeout=2000)).strip()
                        if name_val:
                            return self._clean_company_name(name_val)
        except Exception as e:
            logger.warning(f"[{self.source_type}] Extrakcia mena z detailu zlyhala: {e}")
        return None

    @staticmethod
    def _clean_company_name(raw: str) -> str:
        """Očistí obchodné meno — úvodzovky, trailing obec za právnou formou."""
        name = raw.strip()
        m = _QUOTE_RE.match(name)
        if m:
            return m.group(1).strip()
        return _LEGAL_FORM_RE.sub(r'\1', name).strip()

    async def _extract_findings(self, page: Page) -> Optional[str]:
        try:
            text = (await page.inner_text("body")).lower()
            if "v likvidácii" in text:
                return "POZOR: Spoločnosť je v likvidácii."
            if "vymazaná" in text:
                return "POZOR: Spoločnosť je vymazaná z ORSR."
            return "Aktívna spoločnosť v ORSR (bez zistených anomálií)."
        except Exception as e:
            logger.warning(f"[{self.source_type}] Nálezy zlyhali: {e}")
            return "Nálezy sa nepodarilo extrahovať."

    async def _extract_company_name_from_search(self, page: Page, ico: str) -> Optional[str]:
        """Fallback: extrahuje obchodné meno z vyhľadávacej tabuľky ORSR.
        Volá sa keď extrakcia z detailu zlyhá."""
        try:
            # Naviguj späť na vyhľadávanie
            search_url = f"{self.base_url}?ICO={ico}&SID=0"
            await page.goto(search_url, timeout=30000, wait_until="domcontentloaded")
            
            rows = page.locator("table tr")
            count = await rows.count()
            for i in range(count):
                row = rows.nth(i)
                cells = row.locator("td")
                cell_count = await cells.count()
                for c in range(cell_count):
                    try:
                        val = (await cells.nth(c).inner_text(timeout=2000)).strip()
                    except PlaywrightTimeoutError:
                        continue
                    if ico in val and c + 1 < cell_count:
                        name_val = (await cells.nth(c + 1).inner_text(timeout=2000)).strip()
                        if name_val:
                            return self._clean_company_name(name_val)
        except Exception as e:
            logger.warning(f"[{self.source_type}] Fallback extrakcia mena zlyhala: {e}")
        return None
