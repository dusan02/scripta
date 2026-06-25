from __future__ import annotations
import logging
import re
import time
from pathlib import Path
from typing import Optional

from playwright.async_api import Page, TimeoutError as PlaywrightTimeoutError

from .base import BaseScraper, ScraperUnavailableError
from ..models import ScrapedSource

logger = logging.getLogger(__name__)

_NO_RESULTS_TEXT = "neboli nájdené žiadne"

# Záložky účtovnej závierky, ktoré scrapujeme
# URL pattern: /financialreport/show/{report_id}/{tab_id}
_TAB_IDS = [
    (0,   "Titulná strana"),
    (550, "Strana aktív"),
    (551, "Strana pasív"),
    (552, "Výkaz ziskov a strát"),
]


class RegisterUzScraper(BaseScraper):
    """
    Scraper pre Register účtovných závierok (registeruz.sk).
    Vyhľadávanie podľa IČO, naviguje cez záložky a generuje PDF z HTML obsahu.
    """

    source_type = "REGISTER_UZ"
    base_url = "https://www.registeruz.sk/cruz-public/domain/accountingentity/simplesearch"
    _title = "Register účtovných závierok (registeruz.sk)"
    _no_results_msg = "Subjekt nie je evidovaný v Registri účtovných závierok."

    async def run(self, *, ico: str, output_dir: Path, **kwargs) -> ScrapedSource:
        page: Optional[Page] = None
        try:
            logger.info(f"[{self.source_type}] Začínam vyhľadávanie pre IČO: {ico}")
            page = await self._get_page(block_images=False)

            await self._safe_goto(page, self.base_url)
            logger.info(f"[{self.source_type}] Stránka načítaná: {self.base_url}")

            # Cookie consent — "Povoliť všetko"
            try:
                cookie_btn = page.get_by_role("link", name="Povoliť všetko")
                await cookie_btn.wait_for(state="visible", timeout=5000)
                await cookie_btn.click()
                logger.info(f"[{self.source_type}] Cookie consent prijatý.")
            except PlaywrightTimeoutError:
                logger.debug(f"[{self.source_type}] Cookie banner sa nezobrazil.")

            # Vyplnenie IČO — selector: #input_search
            try:
                search_input = page.locator("#input_search")
                await search_input.wait_for(state="visible", timeout=10000)
                await search_input.fill(ico)
            except PlaywrightTimeoutError:
                raise ScraperUnavailableError(f"{self.source_type}: Nenájdené vyhľadávacie pole #input_search.")

            # Kliknúť na "Vyhľadať" — selector: button:has-text('Vyhľadať')
            try:
                search_btn = page.locator("button:has-text('Vyhľadať')")
                await search_btn.wait_for(state="visible", timeout=10000)
                await search_btn.click()
            except PlaywrightTimeoutError:
                raise ScraperUnavailableError(f"{self.source_type}: Nenájdené tlačidlo Vyhľadať.")

            # Počkáme na načítanie výsledkov
            await page.wait_for_timeout(3000)

            # Skontrolujeme no results
            body_text = await page.inner_text("body")
            if _NO_RESULTS_TEXT in body_text.lower():
                logger.info(f"[{self.source_type}] IČO {ico} — žiadne výsledky.")
                file_path = output_dir / f"{self.source_type}_{ico}.pdf"
                await self._generate_no_results_pdf(
                    page, file_path, ico,
                    title=self._title,
                    message=f"Pre IČO {ico} sa v {self._title} nenašiel žiadny záznam.",
                )
                return self._make_result(
                    status="SUCCESS",
                    file_path=str(file_path),
                    page_count=1,
                    status_message=f"IČO {ico} nebolo nájdené v {self.source_type}.",
                    findings=self._no_results_msg,
                )

            # Krok 1: Kliknúť na prvý výsledok — použijeme JS pre spoľahlivé kliknutie
            # Skúsime "Detail" link, potom a[href*='accountingentity/show']
            clicked = await page.evaluate("""() => {
                // Skúsime Detail link
                let el = document.querySelector("a[href*='accountingentity/show']");
                if (el) { el.click(); return 'accountingentity/show'; }
                // Fallback: akýkoľvek link v tabuľke s show
                el = document.querySelector("table a[href*='show']");
                if (el) { el.click(); return 'table show'; }
                // Fallback: Detail text
                const links = Array.from(document.querySelectorAll('a'));
                const detail = links.find(a => a.textContent.trim() === 'Detail');
                if (detail) { detail.click(); return 'Detail'; }
                return null;
            }""")
            if clicked:
                logger.info(f"[{self.source_type}] Kliknuté na výsledok ({clicked}).")
            else:
                logger.warning(f"[{self.source_type}] Nepodarilo sa kliknúť na výsledok.")

            await page.wait_for_timeout(3000)

            # Krok 2: Rozkliknúť prvú "šípku" — span.js-collapse.icon-collapsed
            clicked = await page.evaluate("""() => {
                let el = document.querySelector("span.js-collapse.icon-collapsed");
                if (!el) el = document.querySelector("span.js-collapse");
                if (el) { el.click(); return true; }
                return false;
            }""")
            if clicked:
                logger.info(f"[{self.source_type}] Kliknuté na šípku (collapse).")
            else:
                logger.warning(f"[{self.source_type}] Šípka collapse nenájdená.")

            await page.wait_for_timeout(1500)

            # Krok 3: Kliknúť na "Úč POD:" — span s textom v #collapse-o-0
            clicked = await page.evaluate("""() => {
                // Skúsime selektor z user hintu
                let el = document.querySelector("#collapse-o-0 span.font-weight-medium.text-primary.text-decoration-underline");
                if (el && el.textContent.includes('Úč POD')) { el.click(); return 'css'; }
                // Fallback: akýkoľvek span s textom Úč POD:
                const spans = Array.from(document.querySelectorAll('span'));
                const ucpod = spans.find(s => s.textContent.includes('Úč POD:') && s.className.includes('text-primary'));
                if (ucpod) { ucpod.click(); return 'text'; }
                // Fallback: akýkoľvek element s textom Úč POD:
                const all = Array.from(document.querySelectorAll('a, span, div'));
                const ucpod2 = all.find(e => e.textContent.trim().startsWith('Úč POD:') && e.children.length === 0);
                if (ucpod2) { ucpod2.click(); return 'any'; }
                return null;
            }""")
            if clicked:
                logger.info(f"[{self.source_type}] Kliknuté na Úč POD: ({clicked}).")
            else:
                logger.warning(f"[{self.source_type}] Úč POD: link nenájdený.")

            await page.wait_for_timeout(3000)

            # Krok 4: Extrahujeme report ID z URL
            # URL: https://www.registeruz.sk/cruz-public/domain/financialreport/show/{report_id}
            current_url = page.url
            logger.info(f"[{self.source_type}] Aktuálna URL: {current_url}")

            report_id_match = re.search(r'/financialreport/show/(\d+)', current_url)
            if not report_id_match:
                # Skúsime v HTML
                html = await page.content()
                report_id_match = re.search(r'/financialreport/show/(\d+)', html)

            if not report_id_match:
                logger.error(f"[{self.source_type}] Nepodarilo sa nájsť report ID.")
                file_path = output_dir / f"{self.source_type}_{ico}.pdf"
                await self._generate_clean_pdf(
                    page, file_path,
                    title=self._title,
                    content_selector="main, .main, .content, table",
                    format="A4", scale=0.9,
                )
                return self._make_result(
                    status="SUCCESS",
                    file_path=str(file_path),
                    page_count=1,
                    status_message=f"Účtovná závierka pre IČO {ico} vygenerovaná (obmedzený obsah).",
                    findings=f"Účtovná závierka nájdená v {self._title}.",
                )

            report_id = report_id_match.group(1)
            logger.info(f"[{self.source_type}] Report ID: {report_id}")

            # Krok 5: Prejdeme všetky záložky a generujeme PDF pre každú
            tab_pdfs = []
            tab_labels = []
            base_tab_url = f"https://www.registeruz.sk/cruz-public/domain/financialreport/show/{report_id}"

            for tab_id, tab_name in _TAB_IDS:
                tab_url = f"{base_tab_url}/{tab_id}"
                try:
                    await self._safe_goto(page, tab_url)
                    await page.wait_for_timeout(3000)

                    # Generujeme PDF priamo z aktuálnej stránky
                    tab_pdf_path = output_dir / f"{self.source_type}_{ico}_tab{tab_id}.pdf"
                    await page.pdf(
                        path=str(tab_pdf_path),
                        format="A4",
                        print_background=True,
                        margin={"top": "20mm", "bottom": "20mm", "left": "15mm", "right": "15mm"},
                    )
                    tab_pdfs.append(tab_pdf_path)
                    tab_labels.append(tab_name)
                    logger.info(f"[{self.source_type}] Záložka '{tab_name}': PDF vygenerované")

                except Exception as e:
                    logger.warning(f"[{self.source_type}] Chyba pri záložke '{tab_name}': {e}")

            file_path = output_dir / f"{self.source_type}_{ico}.pdf"

            if tab_pdfs:
                # Zlúčime všetky PDF do jedného
                from PyPDF2 import PdfReader, PdfWriter
                writer = PdfWriter()
                for tab_pdf in tab_pdfs:
                    reader = PdfReader(str(tab_pdf))
                    for page_obj in reader.pages:
                        writer.add_page(page_obj)
                with open(file_path, "wb") as f:
                    writer.write(f)
                # Zmažeme dočasné PDF
                for tab_pdf in tab_pdfs:
                    try:
                        tab_pdf.unlink()
                    except Exception:
                        pass
                logger.info(f"[{self.source_type}] PDF zlúčené z {len(tab_labels)} záložiek.")
            else:
                logger.warning(f"[{self.source_type}] Žiadne záložky sa nepodarilo zachytiť, generujem PDF z aktuálnej stránky.")
                await self._generate_clean_pdf(
                    page, file_path,
                    title=self._title,
                    content_selector="main, .main, .content, table",
                    format="A4", scale=0.9,
                )

            # Extrahuj findings
            findings = await self._extract_findings(page, ico, tab_labels)

            return self._make_result(
                status="SUCCESS",
                file_path=str(file_path),
                page_count=1,
                status_message=f"Účtovná závierka pre IČO {ico} úspešne vygenerovaná ({len(tab_labels)} záložiek).",
                findings=findings or f"Účtovná závierka nájdená v {self._title}.",
            )

        except ScraperUnavailableError:
            raise
        except Exception as e:
            logger.exception(f"[{self.source_type}] Nečakaná chyba pri IČO {ico}: {e}")
            return self._make_result(
                status="FAILED",
                file_path=None,
                status_message=f"Interná chyba scrapera: {str(e)}",
            )
        finally:
            if page:
                await page.close()

    async def _extract_findings(self, page: Page, ico: str, tab_labels: list) -> Optional[str]:
        """Extrahuje základné informácie zo stránky."""
        try:
            parts = [f"Účtovná závierka nájdená pre IČO {ico} v Registri účtovných závierok."]

            if tab_labels:
                parts.append(f"Záchytné záložky: {', '.join(tab_labels)}")

            text = await page.inner_text("body")
            period_match = re.search(r'(\d{2}/\d{4}\s*[-–]\s*\d{2}/\d{4})', text)
            if period_match:
                parts.append(f"Obdobie: {period_match.group(1)}")

            if "Individuálna" in text or "Individuá" in text:
                parts.append("Typ: Individuálna účtovná závierka")
            elif "Konsolidovaná" in text:
                parts.append("Typ: Konsolidovaná účtovná závierka")

            return "\n".join(parts)
        except Exception as e:
            logger.warning(f"[{self.source_type}] Extrakcia nálezov zlyhala: {e}")
            return None
