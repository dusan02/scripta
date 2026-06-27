from __future__ import annotations

import logging
import time
from pathlib import Path
from typing import Optional

from playwright.async_api import Page, TimeoutError as PlaywrightTimeoutError

from .base import BaseScraper, ScraperUnavailableError
from ..models import ScrapedSource

logger = logging.getLogger(__name__)

_NO_RESULTS_MARKERS = [
    "nebolo nájdené žiadne poverenie",
    "neexistuje žiadne poverenie",
    "nenašli sa žiadne",
    "žiadne záznamy",
]

_SKIP_KEYWORDS = [
    "podľa ičo", "názov povinného (nepovinný", "vyplní ičo",
    "hľadať poverenie", "podľa ecli", "podľa mena",
    "ohodnoťte", "spätná väzba", "nášli ste na stránke",
    "support links", "pomocník", "cookies", "vyhlásenie",
    "vytvorené v súlade", "prevádzkovateľ", "verzia",
    "na stranu", "ďalšie záznamy", "pdf výpise",
]

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
            has_poverenie = "poverenie ecli" in lowered and ico in body_text
            no_results = any(m in lowered for m in _NO_RESULTS_MARKERS)

            pdf_output = output_dir / f"poverenia_{ico}.pdf"

            if has_poverenie:
                logger.info(f"[{self.source_type}] Pozitívny záznam pre IČO {ico} (potvrdené IČO v texte).")
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

    async def _extract_findings(self, page: Page, ico: str) -> str:
        try:
            body_text = await page.inner_text("body")
            lowered = body_text.lower()
            if "poverenie ecli" not in lowered:
                return f"Pre IČO {ico} sa našli záznamy v registri poverení na exekúcie (detaily v PDF)."

            idx = lowered.find("poverenie ecli")
            relevant_text = body_text[idx:]

            raw_lines = []
            for l in relevant_text.split("\n"):
                l = l.strip()
                if not l:
                    continue
                ll = l.lower()
                if any(s in ll for s in _SKIP_KEYWORDS):
                    continue
                # Preskočiť samostatné čísla (paginator strán)
                if l.isdigit():
                    continue
                # Preskočiť "…" a podobné samostatné znaky
                if len(l) <= 2 and not l.isalpha():
                    continue
                raw_lines.append(l)

            grouped = []
            i = 0
            while i < len(raw_lines):
                line = raw_lines[i]
                ll = line.lower()

                if ll in _LABELS and i + 1 < len(raw_lines):
                    next_line = raw_lines[i + 1]
                    if next_line.lower() not in _LABELS and next_line.lower() not in _SECTION_LABELS:
                        grouped.append(f"{line}: {next_line}")
                        i += 2
                        continue

                if ll in _SECTION_LABELS:
                    if grouped:
                        grouped.append("")
                    grouped.append(line)
                    i += 1
                    continue

                grouped.append(line)
                i += 1

            header = f"⚠ POZOR: Pre IČO {ico} bolo nájdené poverenie na vykonanie exekúcie!\n\n"
            return header + "\n".join(grouped[:50])
        except Exception as e:
            logger.warning(f"[{self.source_type}] Extrakcia nálezov zlyhala: {e}")
            return f"Výpis z registra poverení pre IČO {ico} vygenerovaný (detaily v PDF)."
