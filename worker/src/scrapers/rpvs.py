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

    @staticmethod
    def _format_ico(ico: str) -> str:
        """Naformátuje IČO na podobu s medzerami po trojiciach sprava (35757442 -> '35 757 442')."""
        digits = "".join(ch for ch in ico if ch.isdigit())
        parts: list[str] = []
        while len(digits) > 3:
            parts.insert(0, digits[-3:])
            digits = digits[:-3]
        if digits:
            parts.insert(0, digits)
        return " ".join(parts)

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

            # Vyhľadávacie pole — accessible name pochádza z placeholderu
            # "Vyhľadať podľa priezviska, obchodného mena alebo IČO".
            search_input = page.locator(
                "input[placeholder*='Vyhľadať'], input[placeholder*='IČO'], #partner_hladat_text"
            ).first
            await search_input.wait_for(state="visible", timeout=15000)
            await search_input.click()
            await search_input.fill(ico)

            logger.info(f"[{self.source_type}] Vyplnené IČO {ico}, čakám na autocomplete...")

            # RPVS používa autocomplete dropdown — po napísaní IČO sa zobrazí návrh
            # s textom "... (IČO: 35 757 442)". Klikneme naň.
            formatted_ico = self._format_ico(ico)
            suggestion = page.get_by_text(f"IČO: {formatted_ico}", exact=False).first

            try:
                await suggestion.wait_for(state="visible", timeout=10000)
            except PlaywrightTimeoutError:
                logger.info(f"[{self.source_type}] Žiadny návrh pre IČO {ico}.")
                return self._make_result(
                    status="SUCCESS",
                    file_path=None,
                    status_message=f"IČO {ico} nebolo nájdené v RPVS.",
                    findings="Subjekt nie je evidovaný ako partner verejného sektora.",
                )

            logger.info(f"[{self.source_type}] Návrh nájdený, otváram detail partnera.")
            await suggestion.click()

            # Počkáme na načítanie detailu ("Aktuálne údaje" / "Partner verejného sektora").
            try:
                await page.wait_for_load_state("networkidle", timeout=20000)
            except PlaywrightTimeoutError:
                logger.warning(f"[{self.source_type}] Networkidle timeout pri načítavaní detailu.")

            try:
                await page.get_by_text("Partner verejného sektora", exact=False).first.wait_for(
                    state="visible", timeout=10000
                )
            except PlaywrightTimeoutError:
                logger.warning(f"[{self.source_type}] Detail partnera sa nenačítal v očakávanom čase.")

            # Vygenerovanie PDF z detailu partnera.
            file_path = output_dir / f"{self.source_type}_{ico}.pdf"
            logger.info(f"[{self.source_type}] Generujem PDF do {file_path}")
            # Print-to-pdf vyžaduje media 'screen' pre korektné renderovanie tejto stránky.
            await page.emulate_media(media="screen")
            await self._print_page_to_pdf(page, file_path)

            findings = await self._extract_findings(page)

            return self._make_result(
                status="SUCCESS",
                file_path=str(file_path),
                page_count=1,
                status_message="Výpis z RPVS úspešne vygenerovaný.",
                findings=findings,
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

    async def _extract_findings(self, page: Page) -> Optional[str]:
        try:
            text_content = (await page.inner_text("body")).lower()
            if "dátum výmazu" in text_content and "nie je" not in text_content:
                return "POZOR: Partner má evidovaný dátum výmazu z RPVS."
            return "Subjekt je evidovaný ako partner verejného sektora (Koneční užívatelia výhod uvedení vo výpise)."
        except Exception as e:
            logger.warning(f"[{self.source_type}] Nepodarilo sa extrahovať nálezy: {e}")
            return "Subjekt bol nájdený v Registri partnerov verejného sektora."
