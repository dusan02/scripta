from __future__ import annotations

import logging
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

from playwright.async_api import Page, TimeoutError as PlaywrightTimeoutError

from .base import BaseScraper, ScraperUnavailableError
from ..models import ScrapedSource

logger = logging.getLogger(__name__)

# ── Konfigurácia ──────────────────────────────────────────────────────────────

_NO_RESULTS_MARKERS = [
    "nebolo nájdené žiadne poverenie",
    "neexistuje žiadne poverenie",
    "nenašli sa žiadne",
    "žiadne záznamy",
]

# UI/navigation text ktorý sa nemá dostať do findings
_SKIP_KEYWORDS = {
    "podľa ičo", "názov povinného", "vyplní ičo",
    "hľadať poverenie", "podľa ecli", "podľa mena",
    "ohodnoťte", "spätná väzba", "našli ste na stránke",
    "support links", "pomocník", "cookies", "vyhlásenie",
    "vytvorené v súlade", "prevádzkovateľ", "verzia",
    "na stranu", "ďalšie záznamy", "pdf výpise",
    "chybu", "hore",
}

_LABELS = {"názov", "sídlo", "ičo"}
_SECTION_LABELS = {"poverenie ecli", "aktuálny", "oprávnený", "povinný"}

_CLEANUP_JS = """() => {
    const footer = document.querySelector('footer');
    if (footer) footer.style.display = 'none';
    document.querySelectorAll('a[href*="pomocnik"], a[href*="cookies"], a[href*="vyhlasenie"]').forEach(el => {
        const parent = el.closest('footer, .footer, [class*="footer"]');
        if (parent) parent.style.display = 'none';
    });
    const header = document.querySelector('header');
    if (header) header.style.display = 'none';
    document.querySelectorAll('main, .main-content, .content, #app').forEach(el => {
        el.style.paddingTop = '0';
        el.style.marginTop = '0';
    });
    document.querySelectorAll('*').forEach(el => {
        const style = getComputedStyle(el);
        if (parseInt(style.marginTop) > 50) el.style.marginTop = '0';
    });
}"""


# ── Dátové modely ─────────────────────────────────────────────────────────────

@dataclass
class PoverenieParty:
    """Účasník konania (oprávnený alebo povinný)."""
    role: str = ""
    name: str = ""
    address: str = ""
    ico: str = ""


@dataclass
class PoverenieRecord:
    """Jeden záznam poverenia na exekúciu."""
    ecli: str = ""
    status: str = ""
    parties: list[PoverenieParty] = field(default_factory=list)

    def to_findings(self) -> list[str]:
        """Konvertuje záznam na riadky pre findings text."""
        lines = []
        if self.ecli:
            lines.append(f"Poverenie ECLI: {self.ecli}")
        if self.status:
            lines.append(self.status.upper())
        for party in self.parties:
            if not party.role:
                continue
            lines.append("")
            lines.append(party.role.capitalize())
            if party.name:
                lines.append(f"Názov: {party.name}")
            if party.address:
                lines.append(f"Sídlo: {party.address}")
            if party.ico:
                lines.append(f"IČO: {party.ico}")
        return lines


# ── Scraper ───────────────────────────────────────────────────────────────────

class PovereniaScraper(BaseScraper):
    """Scraper pre Register poverení na exekúcie (obcan.justice.sk/pilot/poverenia)."""

    source_type = "POVERENIA"
    base_url = "https://obcan.justice.sk/pilot/poverenia/"

    async def _get_sk_page(self) -> Page:
        context = await self.browser.new_context(
            locale="sk-SK",
            viewport={"width": 1920, "height": 1080},
        )
        page = await context.new_page()
        self._contexts.append(context)
        await page.route("**/*.{png,jpg,jpeg,gif,svg,ico,woff,woff2,ttf,eot}", lambda route: route.abort())
        return page

    async def run(self, *, ico: str, output_dir: Path, **kwargs) -> ScrapedSource:
        page: Optional[Page] = None
        try:
            logger.info(f"[{self.source_type}] Začínam vyhľadávanie pre IČO: {ico}")
            _t = time.perf_counter()
            page = await self._get_sk_page()

            await page.goto(self.base_url, timeout=30000, wait_until="domcontentloaded")
            await self._accept_cookies(page)
            await self._search(page, ico)
            await self._wait_for_results(page)

            await page.evaluate("() => window.scrollTo(0, document.body.scrollHeight)")
            await page.wait_for_timeout(1000)

            body_text = await page.inner_text("body")
            lowered = body_text.lower()
            has_poverenie = "poverenie ecli" in lowered
            no_results = any(m in lowered for m in _NO_RESULTS_MARKERS)

            pdf_output = output_dir / f"poverenia_{ico}.pdf"

            if has_poverenie:
                logger.info(f"[{self.source_type}] Pozitívny záznam pre IČO {ico}.")
                result = await self._make_positive_result(page, pdf_output, ico)
            elif no_results:
                logger.info(f"[{self.source_type}] Žiadne poverenie pre IČO {ico}.")
                result = await self._make_negative_result(page, pdf_output, ico)
            else:
                logger.info(f"[{self.source_type}] Nejasný výsledok pre IČO {ico}, generujem PDF.")
                result = await self._make_fallback_result(page, pdf_output, ico)

            logger.info(f"[{self.source_type}] Hotovo za {time.perf_counter() - _t:.1f}s")
            return result

        except ScraperUnavailableError:
            raise
        except Exception as e:
            logger.exception(f"[{self.source_type}] Nečakaná chyba pri IČO {ico}: {e}")
            return self._make_result(status="FAILED", file_path=None, status_message=f"Interná chyba scrapera: {str(e)}")
        finally:
            if page:
                try:
                    await page.close()
                except Exception:
                    pass

    # ── Result builders ─────────────────────────────────────────────

    async def _make_positive_result(self, page: Page, pdf_output: Path, ico: str) -> ScrapedSource:
        await self._generate_pdf(page, pdf_output)
        findings = await self._extract_findings(page, ico)
        return self._make_result(
            status="SUCCESS",
            file_path=str(pdf_output),
            page_count=1,
            status_message=f"POZOR: Pre IČO {ico} bolo nájdené poverenie na vykonanie exekúcie!",
            findings=findings,
        )

    async def _make_negative_result(self, page: Page, pdf_output: Path, ico: str) -> ScrapedSource:
        await self._generate_pdf(page, pdf_output)
        return self._make_result(
            status="SUCCESS",
            file_path=str(pdf_output),
            page_count=1,
            status_message=f"IČO {ico} – žiadne poverenie na exekúciu.",
            findings=f"Na uvedené IČO: {ico} nebolo nájdené žiadne poverenie na vykonanie exekúcie. "
            f"Aktuálne neexistuje žiadne poverenie evidované pod vyhľadávanými kritériami.",
        )

    async def _make_fallback_result(self, page: Page, pdf_output: Path, ico: str) -> ScrapedSource:
        await self._generate_pdf(page, pdf_output)
        findings = await self._extract_findings(page, ico)
        return self._make_result(
            status="SUCCESS",
            file_path=str(pdf_output),
            page_count=1,
            status_message="Výpis z registra poverení úspešne vygenerovaný.",
            findings=findings,
        )

    # ── Step methods ────────────────────────────────────────────────

    async def _accept_cookies(self, page: Page) -> None:
        try:
            btn = page.get_by_role("button", name="Prijať analytické cookies")
            await btn.wait_for(timeout=5000)
            await btn.click()
            await page.wait_for_timeout(1000)
            logger.info(f"[{self.source_type}] Cookie banner prijatý.")
        except PlaywrightTimeoutError:
            logger.info(f"[{self.source_type}] Cookie banner sa nezobrazil.")

    async def _search(self, page: Page, ico: str) -> None:
        try:
            radio = page.get_by_role("radio", name="podľa IČO, resp. názvu povinn")
            await radio.wait_for(timeout=10000)
            await radio.check()
            await page.wait_for_timeout(500)

            ico_input = page.get_by_role("textbox", name="IČO")
            await ico_input.wait_for(timeout=10000)
            await ico_input.click()
            await ico_input.fill(ico)
            await page.wait_for_timeout(300)

            search_btn = page.get_by_role("button", name="Hľadať poverenie")
            await search_btn.wait_for(timeout=10000)
            await search_btn.click()
            logger.info(f"[{self.source_type}] Vyhľadávanie odoslané pre IČO: {ico}")
        except PlaywrightTimeoutError as e:
            logger.error(f"[{self.source_type}] _search zlyhal: {e}")
            raise ScraperUnavailableError("Nepodarilo sa vyplniť vyhľadávanie v registri poverení.")

    async def _wait_for_results(self, page: Page) -> None:
        try:
            await page.wait_for_url("**/vysledky-vyhladavania*", timeout=20000)
            logger.info(f"[{self.source_type}] URL výsledkov: {page.url}")
        except PlaywrightTimeoutError:
            logger.warning(f"[{self.source_type}] URL sa nezmenila. Aktuálna: {page.url}")
        try:
            await page.wait_for_load_state("networkidle", timeout=10000)
        except PlaywrightTimeoutError:
            pass

    async def _generate_pdf(self, page: Page, output_path: Path) -> None:
        await page.evaluate(_CLEANUP_JS)
        await page.pdf(
            path=str(output_path),
            format="A4",
            print_background=True,
            scale=0.6,
            margin={"top": "0", "bottom": "0", "left": "0.5cm", "right": "0.5cm"},
        )
        logger.info(f"[{self.source_type}] PDF vygenerované: {output_path}")

    # ── Findings extraction ─────────────────────────────────────────

    async def _extract_findings(self, page: Page, ico: str) -> str:
        try:
            body_text = await page.inner_text("body")
            lowered = body_text.lower()
            if "poverenie ecli" not in lowered:
                return f"Pre IČO {ico} sa našli záznamy v registri poverení na exekúcie (detaily v PDF)."

            records = self._parse_records(body_text)
            if not records:
                return f"Pre IČO {ico} sa našli záznamy v registri poverení na exekúcie (detaily v PDF)."

            header = f"⚠ POZOR: Pre IČO {ico} bolo nájdené poverenie na vykonanie exekúcie!\n\n"
            parts = [header]
            for record in records:
                parts.extend(record.to_findings())
                parts.append("")

            return "\n".join(parts).strip()
        except Exception as e:
            logger.warning(f"[{self.source_type}] Extrakcia nálezov zlyhala: {e}")
            return f"Výpis z registra poverení pre IČO {ico} vygenerovaný (detaily v PDF)."

    @staticmethod
    def _filter_lines(text: str) -> list[str]:
        """Vyfiltruje relevantné riadky z textu stránky."""
        lines = []
        for raw in text.split("\n"):
            l = raw.strip()
            if not l:
                continue
            ll = l.lower()
            if any(kw in ll for kw in _SKIP_KEYWORDS):
                continue
            if l.isdigit() and len(l) <= 3:
                continue
            if len(l) <= 2 and not l.isalpha():
                continue
            lines.append(l)
        return lines

    def _parse_records(self, body_text: str) -> list[PoverenieRecord]:
        """Parsovanie štruktúrovaných záznamov poverení z textu stránky."""
        lowered = body_text.lower()
        idx = lowered.find("poverenie ecli")
        if idx == -1:
            return []

        relevant = body_text[idx:]
        raw_lines = self._filter_lines(relevant)

        records: list[PoverenieRecord] = []
        current = PoverenieRecord()
        current_party: Optional[PoverenieParty] = None
        expecting_value_for: Optional[str] = None

        for line in raw_lines:
            ll = line.lower()

            if ll == "poverenie ecli":
                if current.ecli or current.parties:
                    records.append(current)
                current = PoverenieRecord()
                current_party = None
                expecting_value_for = "ecli"
                continue

            if ll in _SECTION_LABELS and ll != "poverenie ecli":
                if ll == "aktuálny":
                    expecting_value_for = "status"
                    continue
                if ll in ("oprávnený", "povinný"):
                    current_party = PoverenieParty(role=ll)
                    current.parties.append(current_party)
                    expecting_value_for = None
                    continue

            if ll in _LABELS and current_party is not None:
                expecting_value_for = ll
                continue

            if expecting_value_for == "ecli":
                current.ecli = line
                expecting_value_for = None
            elif expecting_value_for == "status":
                current.status = line
                expecting_value_for = None
            elif expecting_value_for == "názov" and current_party is not None:
                current_party.name = line
                expecting_value_for = None
            elif expecting_value_for == "sídlo" and current_party is not None:
                current_party.address = line
                expecting_value_for = None
            elif expecting_value_for == "ičo" and current_party is not None:
                current_party.ico = line
                expecting_value_for = None

        if current.ecli or current.parties:
            records.append(current)

        return records
