import logging
from pathlib import Path
from typing import Optional

from playwright.async_api import Page, TimeoutError as PlaywrightTimeoutError, Error as PlaywrightError

from .base import BaseScraper, ScraperUnavailableError
from ..models import ScrapedSource

logger = logging.getLogger(__name__)

class OrsrScraper(BaseScraper):
    """
    Scraper pre Obchodný register SR (ORSR).
    Hľadá firmu podľa IČO a sťahuje PDF výpis.
    """

    source_type = "ORSR"
    base_url = "https://www.orsr.sk/hladaj_ico.asp"

    async def run(self, *, ico: str, output_dir: Path, **kwargs) -> ScrapedSource:
        page: Optional[Page] = None
        try:
            logger.info(f"[{self.source_type}] Začínam vyhľadávanie pre IČO: {ico}")
            page = await self._get_page()
            
            search_url = f"{self.base_url}?ICO={ico}&SID=0"
            logger.info(f"[{self.source_type}] Navigujem na {search_url}")
            
            try:
                # orsr.sk can be slow, using domcontentloaded and longer timeout
                await page.goto(search_url, timeout=45000, wait_until="domcontentloaded")
            except PlaywrightTimeoutError:
                logger.error(f"[{self.source_type}] Timeout pri načítaní stránky ORSR.")
                raise ScraperUnavailableError("Timeout pri načítaní stránky ORSR.")

            logger.info(f"[{self.source_type}] Stránka načítaná. Kontrolujem prázdne výsledky.")
            
            # Check for error message or empty results
            text_content = await page.inner_text("body")
            if "Nenašli sa žiadne" in text_content or "Podmienkam nevyhovuje žiadny" in text_content:
                logger.info(f"[{self.source_type}] IČO {ico} nebolo nájdené v ORSR.")
                return self._make_result(
                    status="SUCCESS",
                    file_path=None,
                    status_message=f"IČO {ico} nebolo nájdené v ORSR.",
                    findings="Žiadny záznam v Obchodnom registri SR."
                )

            logger.info(f"[{self.source_type}] Pokúšam sa nájsť odkaz na detail firmy pre IČO {ico}.")
            
            detail_link = page.locator("a[href*='vypis.asp']").first
            
            try:
                await detail_link.wait_for(timeout=10000)
                logger.info(f"[{self.source_type}] Klikám na odkaz detailu.")
                await detail_link.click()
                await page.wait_for_load_state("domcontentloaded", timeout=45000)
            except PlaywrightTimeoutError:
                logger.warning(f"[{self.source_type}] Odkaz na detail nenájdený alebo timeout po kliknutí.")
                return self._make_result(
                    status="SUCCESS",
                    file_path=None,
                    status_message=f"Výpis pre IČO {ico} nebol nájdený.",
                    findings="Záznam neexistuje alebo nebol nájdený."
                )

            logger.info(f"[{self.source_type}] Generujem PDF výpis.")
            pdf_output = output_dir / f"orsr_{ico}.pdf"
            
            try:
                # Wait a bit to ensure rendering
                await page.wait_for_timeout(1500)
                await self._print_page_to_pdf(page, pdf_output)
                logger.info(f"[{self.source_type}] PDF úspešne vygenerované na {pdf_output}")
            except Exception as e:
                logger.error(f"[{self.source_type}] Zlyhalo generovanie PDF: {e}")
                return self._make_result(
                    status="FAILED",
                    status_message=f"Chyba pri generovaní PDF z ORSR: {e}",
                )

            findings = await self._extract_findings(page)

            return self._make_result(
                status="SUCCESS",
                file_path=str(pdf_output),
                page_count=1,
                status_message="Výpis z ORSR úspešne stiahnutý.",
                findings=findings,
            )
        except ScraperUnavailableError as e:
            logger.error(f"[{self.source_type}] ORSR je nedostupný: {e}")
            return self._make_result(
                status="UNAVAILABLE",
                status_message=f"Register ORSR je nedostupný: {e}",
            )
        except PlaywrightError as e:
            logger.error(f"[{self.source_type}] Playwright sieťová chyba: {e}")
            return self._make_result(
                status="FAILED",
                status_message=f"Sieťová chyba pri spracovaní ORSR: {e}",
            )
        except Exception as e:
            logger.error(f"[{self.source_type}] Nečakaná chyba: {e}")
            return self._make_result(
                status="FAILED",
                status_message=f"Neznáma chyba pri spracovaní ORSR: {type(e).__name__}: {e}",
            )
        finally:
            if page:
                await page.close()

    async def _extract_findings(self, page: Page) -> Optional[str]:
        try:
            text_content = await page.inner_text("body")
            if "v likvidácii" in text_content.lower():
                return "POZOR: Spoločnosť je v likvidácii."
            if "vymazaná" in text_content.lower():
                return "POZOR: Spoločnosť je vymazaná z ORSR."
            return "Aktívna spoločnosť v ORSR (bez zistených anomálií)."
        except Exception as e:
            logger.warning(f"[{self.source_type}] Nepodarilo sa extrahovať nálezy: {e}")
            return "Nálezy sa nepodarilo extrahovať."
