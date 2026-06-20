import logging
from pathlib import Path
from typing import Optional

from playwright.async_api import Page, TimeoutError as PlaywrightTimeoutError, Error as PlaywrightError

from .base import BaseScraper, ScraperUnavailableError
from ..models import ScrapedSource

logger = logging.getLogger(__name__)

class InsolvencyScraper(BaseScraper):
    """
    Scraper pre Register úpadcov SR (ru.justice.sk / obchodnyvestnik.justice.gov.sk).
    Hľadá firmu podľa IČO alebo osobu podľa mena a priezviska.
    
    Dôležité: Výsledok "Žiadny záznam" je POZITÍVNY výsledok pre klienta.
    """

    source_type = "INSOLVENCY"
    # Použijeme URL obchodného vestníka pre vyhľadávanie úpadcov, alebo ru.justice.sk.
    # Urobíme to defenzívne: Pôjdeme na základný portál
    base_url = "https://obchodnyvestnik.justice.gov.sk/ObchodnyVestnik/Formular/FormularPrehlad.aspx"

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

            logger.info(f"[{self.source_type}] Navigujem na {self.base_url}")
            try:
                await page.goto(self.base_url, timeout=45000, wait_until="domcontentloaded")
            except PlaywrightTimeoutError:
                raise ScraperUnavailableError("Timeout pri načítaní stránky Registra úpadcov.")

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
            logger.error(f"[{self.source_type}] Register úpadcov je nedostupný: {e}")
            return self._make_result(
                status="UNAVAILABLE",
                status_message=f"Register úpadcov je nedostupný: {e}",
            )
        except PlaywrightError as e:
            logger.error(f"[{self.source_type}] Playwright sieťová chyba: {e}")
            return self._make_result(
                status="FAILED",
                status_message=f"Sieťová chyba pri spracovaní registra úpadcov: {e}",
            )
        except Exception as e:
            logger.error(f"[{self.source_type}] Nečakaná chyba: {e}")
            return self._make_result(
                status="FAILED",
                status_message=f"Chyba pri spracovaní registra úpadcov: {type(e).__name__}: {e}",
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
                status_message="IČO je povinné pre vyhľadávanie firmy v registri úpadcov.",
            )

        try:
            logger.info(f"[{self.source_type}] Vypĺňam IČO: {ico}")
            # Try filling common ICO fields on justice portals
            ico_input = page.locator("input[name*='ico'], input[id*='Ico'], input[id*='ico']").first
            
            if await ico_input.count() > 0:
                await ico_input.fill(ico, timeout=10000)
            else:
                logger.warning(f"[{self.source_type}] Input pre IČO sa nenašiel na stránke.")
            
            logger.info(f"[{self.source_type}] Odosielam formulár.")
            submit_btn = page.locator("input[type='submit'], button[type='submit'], input[value*='Hľadať'], a:has-text('Hľadať')").first
            
            if await submit_btn.count() > 0:
                await submit_btn.click(timeout=10000)
                await page.wait_for_load_state("domcontentloaded", timeout=45000)
            else:
                logger.warning(f"[{self.source_type}] Submit tlačidlo sa nenašlo.")
                
        except PlaywrightTimeoutError:
            raise ScraperUnavailableError("Timeout pri vyhľadávaní v Registri úpadcov.")
        except Exception as e:
            logger.warning(f"[{self.source_type}] Zlyhalo vyhľadávanie. Pokračujem na spracovanie výsledkov. Chyba: {e}")

        return await self._process_results(page, f"ico_{ico}", output_dir)

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
                status_message="Meno a priezvisko sú povinné pre vyhľadávanie osoby v registri úpadcov.",
            )

        try:
            logger.info(f"[{self.source_type}] Vypĺňam Meno: {name}, Priezvisko: {surname}")
            surname_input = page.locator("input[name*='priezvisko'], input[id*='Priezvisko'], input[id*='priezvisko']").first
            if await surname_input.count() > 0:
                await surname_input.fill(surname, timeout=5000)
            
            name_input = page.locator("input[name*='meno'], input[id*='Meno'], input[id*='meno']").first
            if await name_input.count() > 0:
                await name_input.fill(name, timeout=5000)

            logger.info(f"[{self.source_type}] Odosielam formulár.")
            submit_btn = page.locator("input[type='submit'], button[type='submit'], input[value*='Hľadať'], a:has-text('Hľadať')").first
            if await submit_btn.count() > 0:
                await submit_btn.click(timeout=10000)
                await page.wait_for_load_state("domcontentloaded", timeout=45000)
            else:
                logger.warning(f"[{self.source_type}] Submit tlačidlo sa nenašlo.")

        except PlaywrightTimeoutError:
            raise ScraperUnavailableError("Timeout pri vyhľadávaní osoby v Registri úpadcov.")
        except Exception as e:
            logger.warning(f"[{self.source_type}] Chyba vyplnenia formulára: {e}")

        safe_label = f"{surname.lower()}_{name.lower()}".replace(" ", "_")
        return await self._process_results(page, safe_label, output_dir)

    async def _process_results(
        self,
        page: Page,
        label: str,
        output_dir: Path,
    ) -> ScrapedSource:
        logger.info(f"[{self.source_type}] Spracovávam výsledky vyhľadávania.")
        has_results, findings = await self._extract_findings(page)

        if not has_results:
            logger.info(f"[{self.source_type}] Neboli nájdené žiadne záznamy.")
            return self._make_result(
                status="SUCCESS",
                file_path=None,
                status_message="Subjekt nemá negatívne záznamy v registri úpadcov.",
                findings=findings,
            )

        logger.info(f"[{self.source_type}] Nájdené záznamy. Generujem PDF varovanie.")
        pdf_output = output_dir / f"insolvency_{label}.pdf"
        
        try:
            await page.wait_for_timeout(1500)
            await self._print_page_to_pdf(page, pdf_output)
            logger.info(f"[{self.source_type}] PDF úspešne vygenerované na {pdf_output}")
        except Exception as e:
            logger.error(f"[{self.source_type}] Zlyhalo generovanie PDF: {e}")
            return self._make_result(
                status="FAILED",
                status_message=f"Chyba pri generovaní PDF z Registra úpadcov: {e}",
            )

        return self._make_result(
            status="SUCCESS",
            file_path=str(pdf_output),
            page_count=1,
            status_message="Boli nájdené záznamy v registri úpadcov (POZOR).",
            findings=findings,
        )

    async def _extract_findings(self, page: Page) -> tuple[bool, str]:
        try:
            text_content = await page.inner_text("body")
            
            no_result_indicators = [
                "Žiadne záznamy",
                "Nenašli sa žiadne záznamy",
                "Neboli nájdené",
                "0 záznamov",
                "Záznam nebol nájdený",
                "Počet nájdených záznamov: 0"
            ]
            
            # Prvok neistoty: Ak sme na chybovej stránke alebo sme nevyplnili správne formulár
            for indicator in no_result_indicators:
                if indicator.lower() in text_content.lower():
                    return False, "Subjekt nemá negatívne záznamy v registri úpadcov."

            # Kontrola tabuľky
            result_rows = await page.locator("table tbody tr").count()
            if result_rows > 0:
                # Občas tabuľky majú prázdny prvý riadok alebo "žiadne dáta" v tabuľke
                first_row = await page.locator("table tbody tr").first.inner_text()
                if "Žiadne záznamy" in first_row or "Nenájdené" in first_row:
                    return False, "Subjekt nemá negatívne záznamy v registri úpadcov."
                    
                return True, f"Nájdený záznam v registri úpadcov — POZOR! Subjekt môže byť v konkurze/reštrukturalizácii."

            # Defaultný fallback
            return False, "Subjekt nemá negatívne záznamy v registri úpadcov."

        except Exception as e:
            logger.warning(f"[{self.source_type}] Zlyhala extrakcia nálezov: {e}")
            return False, "Žiadny záznam v registri úpadcov (stav neurčený)."
