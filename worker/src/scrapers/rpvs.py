from __future__ import annotations
import logging
from pathlib import Path
from typing import Optional

from playwright.async_api import Page, TimeoutError as PlaywrightTimeoutError

from .base import BaseScraper, ScraperUnavailableError
from ..models import ScrapedSource

logger = logging.getLogger(__name__)

class RpvsScraper(BaseScraper):
    """
    Scraper pre Register partnerov verejného sektora (RPVS).
    Hľadá firmu podľa IČO cez autocomplete box a stiahne PDF výpis.
    """

    source_type = "RPVS"
    base_url = "https://rpvs.gov.sk/rpvs"

    async def run(self, *, ico: str, output_dir: Path, **kwargs) -> ScrapedSource:
        page: Optional[Page] = None
        try:
            logger.info(f"[{self.source_type}] Začínam vyhľadávanie pre IČO: {ico}")
            page = await self._get_page()
            
            logger.info(f"[{self.source_type}] Navigujem na {self.base_url}")
            try:
                await page.goto(self.base_url, timeout=30000, wait_until="domcontentloaded")
            except PlaywrightTimeoutError:
                logger.error(f"[{self.source_type}] Timeout pri načítaní úvodnej stránky RPVS.")
                raise ScraperUnavailableError("Timeout pri načítaní stránky RPVS.")

            # Nájdenie input boxu
            search_input = page.get_by_role("textbox").first
            await search_input.wait_for(state="visible", timeout=10000)
            await search_input.fill(ico)

            logger.info(f"[{self.source_type}] Vyplnené IČO {ico}, čakám na našepkávač...")

            # RPVS vyhadzuje v dropdown liste položku, ktorá obsahuje "(IČO: 12345678)"
            # Skúsime nájsť takýto text a kliknúť naň
            dropdown_item = page.locator(f"text=(IČO: {ico})")
            
            try:
                await dropdown_item.wait_for(state="visible", timeout=8000)
                await dropdown_item.first.click()
            except PlaywrightTimeoutError:
                logger.info(f"[{self.source_type}] IČO {ico} nebolo nájdené v RPVS (nenašiel sa výsledok v našepkávači).")
                return self._make_result(
                    status="SUCCESS",
                    file_path=None,
                    status_message=f"IČO {ico} nebolo nájdené v RPVS.",
                    findings="Subjekt nie je evidovaný ako partner verejného sektora."
                )

            # Po kliknutí sa otvorí detail partnera
            logger.info(f"[{self.source_type}] Záznam nájdený, otváram detail partnera.")
            
            try:
                # Počkáme, kým sa načíta detail
                await page.wait_for_load_state("networkidle", timeout=15000)
            except PlaywrightTimeoutError:
                logger.warning(f"[{self.source_type}] Networkidle timeout pri načítavaní detailu.")

            # Vygenerovanie PDF
            file_path = output_dir / f"{self.source_type}_{ico}.pdf"
            logger.info(f"[{self.source_type}] Generujem PDF do {file_path}")
            await self._save_pdf(page, file_path)

            return self._make_result(
                status="SUCCESS",
                file_path=file_path,
                findings="Subjekt bol nájdený v Registri partnerov verejného sektora."
            )

        except ScraperUnavailableError:
            raise
        except Exception as e:
            logger.exception(f"[{self.source_type}] Nečakaná chyba pri IČO {ico}: {e}")
            return self._make_result(
                status="FAILED",
                file_path=None,
                status_message=f"Interná chyba scrapera: {str(e)}"
            )
