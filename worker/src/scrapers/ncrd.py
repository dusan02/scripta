from __future__ import annotations
import logging
import time
from pathlib import Path
from typing import Optional

from playwright.async_api import Page, TimeoutError as PlaywrightTimeoutError

from .base import BaseScraper, ScraperUnavailableError
from ..models import ScrapedSource

logger = logging.getLogger(__name__)

_NO_RESULTS_TEXT = "Zadaným kritériám nezodpovedajú žiadne výsledky"


class NcrdScraper(BaseScraper):
    """
    Scraper pre Notársky centrálny register dražieb (NCRD).
    URL: https://www.notar.sk/drazby/
    Vyhľadávanie podľa IČO dražobníka.
    """

    source_type = "NCRD"
    base_url = "https://www.notar.sk/drazby/"
    _title = "Notársky centrálny register dražieb (NCRD)"
    _field_label = "IČO dražobníka"
    _no_results_msg = "Subjekt nie je evidovaný v Notárskom centrálnom registri dražieb."

    async def run(self, *, ico: str, output_dir: Path, **kwargs) -> ScrapedSource:
        page: Optional[Page] = None
        try:
            logger.info(f"[{self.source_type}] Začínam vyhľadávanie pre IČO: {ico}")
            _t = time.perf_counter()
            page = await self._get_page(block_images=False)
            logger.debug(f"[{self.source_type}] ⏱ get_page: {time.perf_counter() - _t:.2f}s")

            await self._safe_goto(page, self.base_url)
            logger.info(f"[{self.source_type}] Stránka načítaná: {self.base_url}")

            ico_input = page.get_by_role("textbox", name=self._field_label)
            try:
                await ico_input.wait_for(state="visible", timeout=10000)
                await ico_input.fill(ico)
            except PlaywrightTimeoutError:
                raise ScraperUnavailableError(f"{self.source_type}: Nenájdené pole '{self._field_label}'.")

            search_btn = page.get_by_role("button", name="Hľadať")
            try:
                await search_btn.wait_for(state="visible", timeout=10000)
                await search_btn.click()
            except PlaywrightTimeoutError:
                logger.warning(f"[{self.source_type}] 'Hľadať' tlačidlo nenájdené cez get_by_role, skúšam CSS.")
                await page.locator("button:has-text('Hľadať'), input[value*='Hľadať']").first.click()

            try:
                await page.wait_for_load_state("networkidle", timeout=15000)
            except PlaywrightTimeoutError:
                logger.warning(f"[{self.source_type}] networkidle timeout, pokračujem...")

            no_results_locator = page.locator(f"text={_NO_RESULTS_TEXT}")
            table_row_locator = page.locator("table tbody tr")
            try:
                await no_results_locator.or_(table_row_locator).first.wait_for(timeout=20000)
                logger.info(f"[{self.source_type}] Výsledky vyhľadávania načítané.")
            except PlaywrightTimeoutError:
                logger.warning(f"[{self.source_type}] Čakanie na výsledky vypršalo, pokračujem...")

            logger.debug(f"[{self.source_type}] ⏱ fill + hľadať + výsledky: {time.perf_counter() - _t:.2f}s")

            text = await page.inner_text("body")
            file_path = output_dir / f"{self.source_type}_{ico}.pdf"

            if _NO_RESULTS_TEXT in text:
                logger.info(f"[{self.source_type}] IČO {ico} — žiadne výsledky. Generujem PDF s negatívnym výsledkom.")
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

            logger.info(f"[{self.source_type}] Generujem PDF z výsledkov pre IČO {ico}")

            # Zbierame všetky riadky z pagination stránok
            all_rows_html = []
            page_num = 1

            while True:
                rows_html = await page.evaluate("""() => {
                    const tbody = document.querySelector('table tbody');
                    if (!tbody) return [];
                    return Array.from(tbody.querySelectorAll('tr')).map(tr => tr.outerHTML);
                }""")
                if rows_html:
                    all_rows_html.extend(rows_html)
                    logger.info(f"[{self.source_type}] Strana {page_num}: {len(rows_html)} riadkov (celkom {len(all_rows_html)})")

                # Hľadáme pagination — čísla odkazov (2, 3, ...)
                next_link = None
                try:
                    pagination_links = page.locator("a:has-text('2'), a:has-text('3'), a:has-text('4'), a:has-text('5'), a:has-text('6'), a:has-text('7'), a:has-text('8'), a:has-text('9'), a:has-text('10')")
                    count = await pagination_links.count()
                    for i in range(count):
                        link = pagination_links.nth(i)
                        link_text = (await link.inner_text()).strip()
                        if link_text == str(page_num + 1):
                            next_link = link
                            break
                except Exception:
                    pass

                if not next_link:
                    break

                page_num += 1
                logger.info(f"[{self.source_type}] Prechádzam na stranu {page_num}")
                await next_link.click()
                try:
                    await page.wait_for_load_state("networkidle", timeout=10000)
                except PlaywrightTimeoutError:
                    pass
                await page.wait_for_timeout(500)

            # Spojíme všetky riadky do jednej tabuľky a vygenerujeme PDF
            if all_rows_html:
                await page.evaluate("""(rowsHtml) => {
                    const tbody = document.querySelector('table tbody');
                    if (tbody) {
                        tbody.innerHTML = rowsHtml.join('');
                    }
                }""", all_rows_html)

            await self._generate_clean_pdf(
                page,
                file_path,
                title=self._title,
                content_selector="table",
                format="A4",
                scale=0.9,
            )

            findings = await self._extract_table_findings_formatted(page, ico, source_name=self.source_type)

            return self._make_result(
                status="SUCCESS",
                file_path=str(file_path),
                page_count=1,
                status_message=f"Výpis z {self.source_type} úspešne vygenerovaný ({page_num} strán, {len(all_rows_html)} záznamov).",
                findings=findings or f"Subjekt bol nájdený v {self._title}.",
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
