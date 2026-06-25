from __future__ import annotations
import logging
import time
from pathlib import Path
from typing import Optional

from playwright.async_api import Page, TimeoutError as PlaywrightTimeoutError

from .base import BaseScraper, ScraperUnavailableError
from ..models import ScrapedSource

logger = logging.getLogger(__name__)


class NcrzpScraper(BaseScraper):
    """
    Scraper pre Notársky centrálny register záložných práv (NCRZP).
    URL: https://www.notar.sk/zalozne-prava/
    Vyhľadávanie podľa IČO záložcu.
    """

    source_type = "NCRZP"
    base_url = "https://www.notar.sk/zalozne-prava/"

    async def run(self, *, ico: str, output_dir: Path, **kwargs) -> ScrapedSource:
        page: Optional[Page] = None
        try:
            logger.info(f"[{self.source_type}] Začínam vyhľadávanie pre IČO: {ico}")
            _t = time.perf_counter()
            page = await self._get_page(block_images=False)
            logger.debug(f"[{self.source_type}] ⏱ get_page: {time.perf_counter() - _t:.2f}s")

            # 1. Načítaj úvodnú stránku
            await self._safe_goto(page, self.base_url)
            logger.info(f"[{self.source_type}] Stránka načítaná: {self.base_url}")

            # 2. Zadaj IČO do políčka "IČO záložcu"
            ico_input = page.get_by_role("textbox", name="IČO záložcu")
            try:
                await ico_input.wait_for(state="visible", timeout=10000)
                await ico_input.fill(ico)
            except PlaywrightTimeoutError:
                logger.error(f"[{self.source_type}] Nenájdené pole 'IČO záložcu'.")
                raise ScraperUnavailableError("NCRZP: Nenájdené pole 'IČO záložcu'.")

            # 3. Klikni "Hľadať"
            search_btn = page.get_by_role("button", name="Hľadať")
            try:
                await search_btn.wait_for(state="visible", timeout=10000)
                await search_btn.click()
            except PlaywrightTimeoutError:
                logger.warning(f"[{self.source_type}] 'Hľadať' tlačidlo nenájdené cez get_by_role, skúšam CSS.")
                search_btn_css = page.locator("button:has-text('Hľadať'), input[value*='Hľadať']").first
                await search_btn_css.click()

            # 4. Počkaj na výsledky — buď tabuľka s výsledkami alebo "Zadaným kritériám nezodpovedajú žiadne výsledky."
            try:
                await page.wait_for_function(
                    """() => {
                        const text = document.body.innerText;
                        const hasResults = document.querySelector('table tbody tr') !== null;
                        const hasNoResults = text.includes('Zadaným kritériám nezodpovedajú žiadne výsledky');
                        return hasResults || hasNoResults;
                    }""",
                    timeout=20000,
                )
                logger.info(f"[{self.source_type}] Výsledky vyhľadávania načítané.")
            except PlaywrightTimeoutError:
                logger.warning(f"[{self.source_type}] Čakanie na výsledky vypršalo, pokračujem...")

            logger.debug(f"[{self.source_type}] ⏱ fill + hľadať + výsledky: {time.perf_counter() - _t:.2f}s")

            # 5. Skontroluj, či sú výsledky
            text = await page.inner_text("body")
            if "Zadaným kritériám nezodpovedajú žiadne výsledky" in text:
                logger.info(f"[{self.source_type}] IČO {ico} — žiadne výsledky v NCRZP.")
                return self._make_result(
                    status="SUCCESS",
                    file_path=None,
                    status_message=f"IČO {ico} nebolo nájdené v NCRZP.",
                    findings="Subjekt nie je evidovaný v Notárskom centrálnom registri záložných práv.",
                )

            # 6. Výsledky existujú — vygeneruj PDF z stránky
            file_path = output_dir / f"{self.source_type}_{ico}.pdf"
            logger.info(f"[{self.source_type}] Generujem PDF z výsledkov pre IČO {ico}")

            await self._generate_clean_pdf(
                page,
                file_path,
                title="Notársky centrálny register záložných práv (NCRZP)",
                content_selector="table",
                format="A4",
                scale=0.9,
            )

            # 7. Extrahuj nálezy z tabuľky
            findings = await self._extract_table_findings(page, ico, source_name="NCRZP")

            return self._make_result(
                status="SUCCESS",
                file_path=str(file_path),
                page_count=1,
                status_message="Výpis z NCRZP úspešne vygenerovaný.",
                findings=findings or "Subjekt bol nájdený v Notárskom centrálnom registri záložných práv.",
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
