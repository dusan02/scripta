from __future__ import annotations
import logging
import re
from pathlib import Path
from typing import Optional

from playwright.async_api import Page, TimeoutError as PlaywrightTimeoutError

from .base import BaseScraper, ScraperUnavailableError
from ..models import ScrapedSource

logger = logging.getLogger(__name__)

_NO_RESULTS_TEXT = "neboli nájdené žiadne"

# (tab_id, tab_name) — URL pattern: /financialreport/show/{report_id}/{tab_id}
_TABS = [
    (0,   "Titulná strana"),
    (550, "Strana aktív"),
    (551, "Strana pasív"),
    (552, "Výkaz ziskov a strát"),
]

_REPORT_URL = "https://www.registeruz.sk/cruz-public/domain/financialreport/show/{rid}/{tid}"


class RegisterUzScraper(BaseScraper):
    """Scraper pre Register účtovných závierok (registeruz.sk)."""

    source_type = "REGISTER_UZ"
    base_url = "https://www.registeruz.sk/cruz-public/domain/accountingentity/simplesearch"
    _title = "Register účtovných závierok (registeruz.sk)"
    _no_results_msg = "Subjekt nie je evidovaný v Registri účtovných závierok."

    # ── public ──────────────────────────────────────────────────────────

    async def run(self, *, ico: str, output_dir: Path, **kwargs) -> ScrapedSource:
        page: Optional[Page] = None
        try:
            logger.info(f"[{self.source_type}] Start IČO={ico}")
            page = await self._get_page(block_images=False)

            report_id = await self._navigate_to_report(page, ico)
            if not report_id:
                if await self._has_no_results(page):
                    return self._make_result(
                        status="SUCCESS",
                        file_path=None,
                        status_message=f"IČO {ico} nebolo nájdené v {self._title}.",
                        findings=self._no_results_msg,
                    )
                
                file_path = output_dir / f"{self.source_type}_{ico}.pdf"
                await self._generate_clean_pdf(
                    page, file_path, title=self._title,
                    content_selector="main, .main, .content, table",
                    format="A4", scale=0.9,
                )
                return self._make_result(
                    status="SUCCESS", file_path=str(file_path), page_count=1,
                    status_message=f"Účtovná závierka pre IČO {ico} vygenerovaná (obmedzený obsah).",
                    findings=f"Účtovná závierka nájdená v {self._title}.",
                )

            file_path = output_dir / f"{self.source_type}_{ico}.pdf"
            tab_labels = await self._scrape_tabs(page, report_id, ico, output_dir, file_path)
            findings = await self._extract_findings(page, ico, tab_labels)

            return self._make_result(
                status="SUCCESS", file_path=str(file_path), page_count=1,
                status_message=f"Účtovná závierka pre IČO {ico} úspešne vygenerovaná ({len(tab_labels)} záložiek).",
                findings=findings or f"Účtovná závierka nájdená v {self._title}.",
            )
        except ScraperUnavailableError:
            raise
        except Exception as e:
            logger.exception(f"[{self.source_type}] Chyba pri IČO {ico}: {e}")
            return self._make_result(status="FAILED", file_path=None,
                                     status_message=f"Interná chyba scrapera: {str(e)}")
        finally:
            if page:
                await page.close()

    # ── navigation ──────────────────────────────────────────────────────

    async def _navigate_to_report(self, page: Page, ico: str) -> Optional[str]:
        """Prejde: search → result → collapse → Úč POD → vráti report_id."""
        await self._safe_goto(page, self.base_url)
        await self._accept_cookies(page)

        await self._fill_search(page, ico)
        await page.wait_for_timeout(1500)

        if await self._has_no_results(page):
            return None

        await self._click_first_result(page)
        await page.wait_for_timeout(1500)

        await self._click_collapse_arrow(page)
        await page.wait_for_timeout(800)

        await self._click_ucpod(page)
        await page.wait_for_timeout(1500)

        url = page.url
        m = re.search(r'/financialreport/show/(\d+)', url)
        if m:
            logger.info(f"[{self.source_type}] Report ID: {m.group(1)}")
            return m.group(1)

        html = await page.content()
        m = re.search(r'/financialreport/show/(\d+)', html)
        if m:
            logger.info(f"[{self.source_type}] Report ID (z HTML): {m.group(1)}")
            return m.group(1)

        logger.warning(f"[{self.source_type}] Report ID nenájdené (URL={url}).")
        return None

    async def _accept_cookies(self, page: Page) -> None:
        try:
            btn = page.get_by_role("link", name="Povoliť všetko")
            await btn.wait_for(state="visible", timeout=5000)
            await btn.click()
        except PlaywrightTimeoutError:
            pass

    async def _fill_search(self, page: Page, ico: str) -> None:
        try:
            inp = page.locator("#input_search")
            await inp.wait_for(state="visible", timeout=10000)
            await inp.fill(ico)
        except PlaywrightTimeoutError:
            raise ScraperUnavailableError(f"{self.source_type}: Nenájdené #input_search.")

        try:
            btn = page.locator("button:has-text('Vyhľadať')")
            await btn.wait_for(state="visible", timeout=10000)
            await btn.click()
        except PlaywrightTimeoutError:
            raise ScraperUnavailableError(f"{self.source_type}: Nenájdené tlačidlo Vyhľadať.")

    async def _has_no_results(self, page: Page) -> bool:
        text = (await page.inner_text("body")).lower()
        return _NO_RESULTS_TEXT in text

    async def _click_first_result(self, page: Page) -> None:
        clicked = await page.evaluate("""() => {
            let el = document.querySelector("a[href*='accountingentity/show']");
            if (el) { el.click(); return 'entity'; }
            el = document.querySelector("table a[href*='show']");
            if (el) { el.click(); return 'table'; }
            const a = Array.from(document.querySelectorAll('a'))
                .find(a => a.textContent.trim() === 'Detail');
            if (a) { a.click(); return 'detail'; }
            return null;
        }""")
        logger.info(f"[{self.source_type}] Výsledok: {clicked or 'nenájdený'}")

    async def _click_collapse_arrow(self, page: Page) -> None:
        ok = await page.evaluate("""() => {
            let el = document.querySelector("span.js-collapse.icon-collapsed")
                  || document.querySelector("span.js-collapse");
            if (el) { el.click(); return true; }
            return false;
        }""")
        if not ok:
            logger.warning(f"[{self.source_type}] Collapse šípka nenájdená.")

    async def _click_ucpod(self, page: Page) -> None:
        clicked = await page.evaluate("""() => {
            let el = document.querySelector(
                "#collapse-o-0 span.font-weight-medium.text-primary.text-decoration-underline");
            if (el && el.textContent.includes('Úč POD')) { el.click(); return 'css'; }
            const spans = Array.from(document.querySelectorAll('span'));
            const s = spans.find(s => s.textContent.includes('Úč POD:')
                && s.className.includes('text-primary'));
            if (s) { s.click(); return 'span'; }
            return null;
        }""")
        logger.info(f"[{self.source_type}] Úč POD: {clicked or 'nenájdený'}")

    # ── PDF generation ──────────────────────────────────────────────────

    async def _scrape_tabs(
        self, page: Page, report_id: str, ico: str,
        output_dir: Path, file_path: Path,
    ) -> list:
        """Pre každú záložku vygeneruje PDF a zlúči ich."""
        from PyPDF2 import PdfReader, PdfWriter

        tab_pdfs: list[Path] = []
        tab_labels: list[str] = []

        for tab_id, tab_name in _TABS:
            url = _REPORT_URL.format(rid=report_id, tid=tab_id)
            try:
                # Rýchla navigácia — domcontentloaded namiesto networkidle
                await page.goto(url, wait_until="domcontentloaded", timeout=20000)
                await page.wait_for_timeout(1500)

                tab_pdf = output_dir / f"{self.source_type}_{ico}_tab{tab_id}.pdf"
                await page.pdf(
                    path=str(tab_pdf), format="A4", print_background=True,
                    margin={"top": "20mm", "bottom": "20mm", "left": "15mm", "right": "15mm"},
                )
                tab_pdfs.append(tab_pdf)
                tab_labels.append(tab_name)
                logger.info(f"[{self.source_type}] Záložka '{tab_name}' OK")
            except Exception as e:
                logger.warning(f"[{self.source_type}] Záložka '{tab_name}' zlyhala: {e}")

        if not tab_pdfs:
            await self._generate_clean_pdf(
                page, file_path, title=self._title,
                content_selector="main, .main, .content, table",
                format="A4", scale=0.9,
            )
            return []

        # Zlúčenie
        writer = PdfWriter()
        for tp in tab_pdfs:
            for p in PdfReader(str(tp)).pages:
                writer.add_page(p)
        with open(file_path, "wb") as f:
            writer.write(f)
        for tp in tab_pdfs:
            try: tp.unlink()
            except Exception: pass
        logger.info(f"[{self.source_type}] Zlúčené {len(tab_labels)} záložiek.")
        return tab_labels

    # ── findings ────────────────────────────────────────────────────────

    async def _extract_findings(self, page: Page, ico: str, tab_labels: list) -> Optional[str]:
        try:
            parts = [f"Účtovná závierka nájdená pre IČO {ico} v Registri účtovných závierok."]
            if tab_labels:
                parts.append(f"Záchytné záložky: {', '.join(tab_labels)}")
            text = await page.inner_text("body")
            m = re.search(r'(\d{2}/\d{4}\s*[-–]\s*\d{2}/\d{4})', text)
            if m:
                parts.append(f"Obdobie: {m.group(1)}")
            if "Individuá" in text:
                parts.append("Typ: Individuálna účtovná závierka")
            elif "Konsolidovaná" in text:
                parts.append("Typ: Konsolidovaná účtovná závierka")
            return "\n".join(parts)
        except Exception as e:
            logger.warning(f"[{self.source_type}] Extrakcia nálezov zlyhala: {e}")
            return None
