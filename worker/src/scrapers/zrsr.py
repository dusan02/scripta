import logging
from pathlib import Path
from typing import Optional

from playwright.async_api import Page, TimeoutError as PlaywrightTimeoutError, Error as PlaywrightError

from .base import BaseScraper, ScraperUnavailableError
from ..models import ScrapedSource

logger = logging.getLogger(__name__)

class ZrsrScraper(BaseScraper):
    """
    Scraper pre Živnostenský register SR (ZRSR).
    Hľadá firmu podľa IČO alebo osobu a sťahuje PDF výpis.
    """

    source_type = "ZRSR"
    _base_url_company = "https://www.zrsr.sk/zr_ico.aspx"
    _base_url_person = "https://www.zrsr.sk/zr_fyz.aspx"

    async def run(
        self,
        *,
        output_dir: Path,
        target_type: str,
        ico: Optional[str] = None,
        name: Optional[str] = None,
        surname: Optional[str] = None,
        birth_date: Optional[str] = None,
        **kwargs,
    ) -> ScrapedSource:
        page: Optional[Page] = None
        try:
            logger.info(f"[{self.source_type}] Začínam vyhľadávanie. Typ: {target_type}")
            page = await self._get_page()

            if target_type == "COMPANY":
                result = await self._search_company(page, ico=ico, output_dir=output_dir)
            else:
                result = await self._search_person(
                    page,
                    name=name,
                    surname=surname,
                    birth_date=birth_date,
                    output_dir=output_dir,
                )
            return result

        except ScraperUnavailableError as e:
            logger.error(f"[{self.source_type}] ZRSR je nedostupný: {e}")
            return self._make_result(
                status="UNAVAILABLE",
                status_message=f"Register ZRSR je nedostupný: {e}",
            )
        except PlaywrightError as e:
            logger.error(f"[{self.source_type}] Playwright sieťová chyba: {e}")
            return self._make_result(
                status="FAILED",
                status_message=f"Sieťová chyba pri spracovaní ZRSR: {e}",
            )
        except Exception as e:
            logger.error(f"[{self.source_type}] Nečakaná chyba: {e}")
            return self._make_result(
                status="FAILED",
                status_message=f"Chyba pri spracovaní ZRSR: {type(e).__name__}: {e}",
            )
        finally:
            if page:
                await page.close()

    async def _search_company(
        self,
        page: Page,
        *,
        ico: Optional[str],
        output_dir: Path,
    ) -> ScrapedSource:
        if not ico:
            return self._make_result(
                status="FAILED",
                status_message="IČO je povinné pre vyhľadávanie firmy v ZRSR.",
            )

        logger.info(f"[{self.source_type}] Navigujem na {self._base_url_company}")
        try:
            await page.goto(self._base_url_company, timeout=45000, wait_until="domcontentloaded")
        except PlaywrightTimeoutError:
            raise ScraperUnavailableError("Timeout pri načítaní stránky ZRSR.")

        try:
            logger.info(f"[{self.source_type}] Vypĺňam formulár IČO: {ico}")
            await page.fill("input[name*='ICO']", ico, timeout=10000)
            logger.info(f"[{self.source_type}] Odosielam formulár.")
            await page.click("input[type='submit']", timeout=10000)
            await page.wait_for_load_state("domcontentloaded", timeout=45000)
        except PlaywrightTimeoutError:
            raise ScraperUnavailableError("Timeout pri odosielaní formulára ZRSR.")
        except Exception as e:
            logger.error(f"[{self.source_type}] Chyba odoslania formulára: {e}")
            return self._make_result(
                status="FAILED",
                status_message=f"Chyba pri odoslaní formulára ZRSR (firma): {e}",
            )

        return await self._process_zrsr_results(page, f"ico_{ico}", output_dir)

    async def _search_person(
        self,
        page: Page,
        *,
        name: Optional[str],
        surname: Optional[str],
        birth_date: Optional[str],
        output_dir: Path,
    ) -> ScrapedSource:
        if not name or not surname:
            return self._make_result(
                status="FAILED",
                status_message="Meno a priezvisko sú povinné pre vyhľadávanie osoby v ZRSR.",
            )

        logger.info(f"[{self.source_type}] Navigujem na {self._base_url_person}")
        try:
            await page.goto(self._base_url_person, timeout=45000, wait_until="domcontentloaded")
        except PlaywrightTimeoutError:
            raise ScraperUnavailableError("Timeout pri načítaní stránky ZRSR.")

        try:
            logger.info(f"[{self.source_type}] Vypĺňam Meno: {name}, Priezvisko: {surname}")
            await page.fill("input[name*='MENO']", name, timeout=10000)
            await page.fill("input[name*='PRIEZVISKO']", surname, timeout=10000)
            
            logger.info(f"[{self.source_type}] Odosielam formulár.")
            await page.click("input[type='submit']", timeout=10000)
            await page.wait_for_load_state("domcontentloaded", timeout=45000)
        except PlaywrightTimeoutError:
            raise ScraperUnavailableError("Timeout pri odosielaní formulára ZRSR.")
        except Exception as e:
            logger.error(f"[{self.source_type}] Chyba odoslania formulára: {e}")
            return self._make_result(
                status="FAILED",
                status_message=f"Chyba pri odoslaní formulára ZRSR (osoba): {e}",
            )

        safe_label = f"{surname.lower()}_{name.lower()}".replace(" ", "_")
        return await self._process_zrsr_results(page, safe_label, output_dir)

    async def _process_zrsr_results(self, page: Page, label: str, output_dir: Path) -> ScrapedSource:
        logger.info(f"[{self.source_type}] Spracovávam výsledky vyhľadávania.")
        
        text_content = await page.inner_text("body")
        if "Neboli nájdené žiadne záznamy" in text_content or "Nenašiel sa žiadny" in text_content:
            logger.info(f"[{self.source_type}] Záznam nenájdený.")
            return self._make_result(
                status="SUCCESS",
                file_path=None,
                status_message="Záznam sa nenachádza v ZRSR.",
                findings="Žiadny záznam v Živnostenskom registri SR.",
            )

        # Pokus o klik na detail
        try:
            detail_link = page.locator("a[href*='detail']").first
            if await detail_link.count() > 0:
                logger.info(f"[{self.source_type}] Klikám na detail.")
                await detail_link.click(timeout=10000)
                await page.wait_for_load_state("domcontentloaded", timeout=30000)
            else:
                logger.info(f"[{self.source_type}] Detail link nenájdený, generujem PDF z aktuálneho pohľadu.")
        except Exception as e:
            logger.warning(f"[{self.source_type}] Chyba pri klikaní na detail, pokračujem s aktuálnou stránkou: {e}")

        logger.info(f"[{self.source_type}] Generujem PDF.")
        pdf_output = output_dir / f"zrsr_{label}.pdf"
        
        try:
            await page.wait_for_timeout(1500)
            await self._print_page_to_pdf(page, pdf_output)
            logger.info(f"[{self.source_type}] PDF úspešne vygenerované na {pdf_output}")
        except Exception as e:
            logger.error(f"[{self.source_type}] Zlyhalo generovanie PDF: {e}")
            return self._make_result(
                status="FAILED",
                status_message=f"Chyba pri generovaní PDF z ZRSR: {e}",
            )

        findings = await self._extract_findings(page)

        return self._make_result(
            status="SUCCESS",
            file_path=str(pdf_output),
            page_count=1,
            status_message="Výpis z ZRSR stiahnutý.",
            findings=findings,
        )

    async def _extract_findings(self, page: Page) -> Optional[str]:
        try:
            text_content = await page.inner_text("body")
            if "pozastaven" in text_content.lower():
                return "POZOR: Živnosť je pozastavená."
            if "zaniknut" in text_content.lower() or "zánik" in text_content.lower():
                return "POZOR: Živnosť je zaniknutá."
            
            return "Aktívny záznam v ZRSR."
        except Exception as e:
            logger.warning(f"[{self.source_type}] Nepodarilo sa extrahovať nálezy: {e}")
            return "Záznam v ZRSR nájdený."
