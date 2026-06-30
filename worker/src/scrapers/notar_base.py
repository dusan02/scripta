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


class NotarBaseScraper(BaseScraper):
    """
    Base scraper pre Notárske centrálné registre (notar.sk).
    Zdieľa: vyhľadávanie podľa IČO, pagination, PDF generovanie, findings extrakciu.

    Subclassy musia definovať:
      - source_type, base_url, _title, _field_label, _no_results_msg
    """

    base_url: str = ""
    _title: str = ""
    _field_label: str = ""
    _no_results_msg: str = ""

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
                await ico_input.wait_for(state="visible", timeout=5000)
                await ico_input.fill(ico)
            except PlaywrightTimeoutError:
                raise ScraperUnavailableError(f"{self.source_type}: Nenájdené pole '{self._field_label}'.")

            search_btn = page.get_by_role("button", name="Hľadať")
            try:
                await search_btn.wait_for(state="visible", timeout=5000)
                await search_btn.click()
            except PlaywrightTimeoutError:
                logger.warning(f"[{self.source_type}] 'Hľadať' tlačidlo nenájdené cez get_by_role, skúšam CSS.")
                await page.locator("button:has-text('Hľadať'), input[value*='Hľadať']").first.click()

            try:
                await page.wait_for_load_state("domcontentloaded", timeout=5000)
            except PlaywrightTimeoutError:
                logger.warning(f"[{self.source_type}] domcontentloaded timeout, pokračujem...")

            no_results_locator = page.locator(f"text={_NO_RESULTS_TEXT}")
            table_row_locator = page.locator("table tbody tr")
            try:
                await no_results_locator.or_(table_row_locator).first.wait_for(timeout=8000)
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
            all_rows_html, pages_collected = await self._collect_all_rows(page)

            # Spojíme všetky riadky do jednej tabuľky
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
                status_message=f"Výpis z {self.source_type} úspešne vygenerovaný ({pages_collected} strán, {len(all_rows_html)} záznamov).",
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

    async def _collect_all_rows(self, page: Page) -> tuple[list[str], int]:
        """Zbiera všetky riadky tabuľky cez pagination stránky. Vráti (rows_html, page_count)."""
        all_rows_html: list[str] = []
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

            rows_before = "\n".join(rows_html) if rows_html else ""
            
            next_link = await self._find_next_page_link(page, page_num)
            if not next_link:
                break

            page_num += 1
            logger.info(f"[{self.source_type}] Prechádzam na stranu {page_num}")
            await next_link.click()
            
            # Počkáme, kým sa DOM tabuľky reálne zmení po kliknutí (ošetrenie partial SPA reloadu)
            try:
                await page.wait_for_function(
                    """(prev) => {
                        const tbody = document.querySelector('table tbody');
                        if (!tbody) return false;
                        const current = Array.from(tbody.querySelectorAll('tr')).map(tr => tr.outerHTML).join('\\n');
                        return current !== prev;
                    }""",
                    arg=rows_before,
                    timeout=5000
                )
            except PlaywrightTimeoutError:
                logger.warning(f"[{self.source_type}] Tabuľka sa po kliknutí na stranu {page_num} nezmenila včas.")

        return all_rows_html, page_num

    async def _find_next_page_link(self, page: Page, current_page: int):
        """Nájde pagination odkaz na nasledujúcu stranu."""
        try:
            target_str = str(current_page + 1)
            links = page.locator(f"a:has-text('{target_str}')")
            count = await links.count()
            for i in range(count):
                link = links.nth(i)
                if (await link.inner_text()).strip() == target_str:
                    return link
        except Exception:
            pass
        return None
