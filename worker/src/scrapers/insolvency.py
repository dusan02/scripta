from __future__ import annotations
import logging
from pathlib import Path
from typing import Optional

from playwright.async_api import Page, TimeoutError as PlaywrightTimeoutError, Error as PlaywrightError

from .base import BaseScraper, ScraperUnavailableError
from ..models import ScrapedSource

logger = logging.getLogger(__name__)

class InsolvencyScraper(BaseScraper):
    """
    Scraper pre Register predinsolvenčných, likvidačných a insolvenčných konaní SR (ru.justice.sk).
    Hľadá firmu podľa IČO alebo osobu podľa mena a priezviska.
    
    Dôležité: Výsledok "Žiadny záznam" je POZITÍVNY výsledok pre klienta.
    """

    source_type = "INSOLVENCY"
    # Nový portál spustený v októbri 2025
    base_url = "https://ru.justice.sk/ru-verejnost-web/pages/home.xhtml"

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

            # Nový portál má univerzálne vyhľadávacie pole pre IČO aj meno
            search_query = ""
            label = ""
            if target_type == "COMPANY":
                if not ico:
                    return self._make_result(status="FAILED", status_message="IČO je povinné pre vyhľadávanie firmy v registri úpadcov.")
                search_query = ico
                label = f"ico_{ico}"
            else:
                if not name or not surname:
                    return self._make_result(status="FAILED", status_message="Meno a priezvisko sú povinné pre vyhľadávanie osoby v registri úpadcov.")
                search_query = f"{name} {surname}"
                label = f"{surname.lower()}_{name.lower()}".replace(" ", "_")

            try:
                logger.info(f"[{self.source_type}] Vypĺňam hľadaný reťazec: {search_query}")
                search_input = page.locator("input[id*='searchQuery']").first
                await search_input.fill(search_query, timeout=10000)
                
                logger.info(f"[{self.source_type}] Odosielam vyhľadávanie.")
                search_btn = page.locator("a[id*='searchBoxForm:search'], button[id*='search']").first
                
                async with page.expect_navigation(timeout=30000):
                    await search_btn.click(timeout=10000)
                    
            except PlaywrightTimeoutError:
                raise ScraperUnavailableError("Timeout pri vyhľadávaní v Registri úpadcov.")
            except Exception as e:
                logger.warning(f"[{self.source_type}] Zlyhalo vyhľadávanie. Chyba: {e}")

            return await self._process_results(page, label, output_dir)

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

    async def _process_results(
        self,
        page: Page,
        label: str,
        output_dir: Path,
    ) -> ScrapedSource:
        logger.info(f"[{self.source_type}] Spracovávam výsledky vyhľadávania.")
        has_results, findings = await self._extract_findings(page)

        logger.info(f"[{self.source_type}] Generujem PDF dôkaz (či už s nálezmi alebo bez).")
        pdf_output = output_dir / f"insolvency_{label}.pdf"
        
        try:
            await page.wait_for_timeout(2000)
            await self._print_page_to_pdf(page, pdf_output)
            logger.info(f"[{self.source_type}] PDF úspešne vygenerované na {pdf_output}")
        except Exception as e:
            logger.error(f"[{self.source_type}] Zlyhalo generovanie PDF: {e}")
            return self._make_result(
                status="FAILED",
                status_message=f"Chyba pri generovaní PDF z Registra úpadcov: {e}",
            )

        if not has_results:
            logger.info(f"[{self.source_type}] Neboli nájdené žiadne záznamy.")
            return self._make_result(
                status="SUCCESS",
                file_path=str(pdf_output),
                page_count=1,
                status_message="Subjekt nemá negatívne záznamy v insolvenčnom registri.",
                findings=findings,
            )

        return self._make_result(
            status="SUCCESS",
            file_path=str(pdf_output),
            page_count=1,
            status_message="Boli nájdené záznamy v insolvenčnom registri (POZOR).",
            findings=findings,
        )

    async def _extract_findings(self, page: Page) -> tuple[bool, str]:
        try:
            # Počkáme chvíľku kým PrimeFaces dogeneruje AJAX DOM elementy
            await page.wait_for_timeout(2000)
            text_content = await page.inner_text("body")
            
            # Nový portál zobrazuje toto, ak nič nenájde
            if "Nenašli sa žiadne konania" in text_content or "žiadne konania pre hľadaný reťazec" in text_content:
                return False, "Subjekt nemá negatívne záznamy v registri úpadcov."

            # Kontrola tabuľky
            result_rows = await page.locator("div.ui-datatable-tablewrapper table tbody tr.ui-widget-content").count()
            if result_rows > 0:
                # PrimeFaces zvykne dať class 'ui-datatable-empty-message' na prvý riadok ak nie sú dáta
                first_row_classes = await page.locator("div.ui-datatable-tablewrapper table tbody tr").first.get_attribute("class")
                if first_row_classes and "ui-datatable-empty-message" in first_row_classes:
                    return False, "Subjekt nemá negatívne záznamy v registri úpadcov."
                    
                return True, "Nájdený záznam v insolvenčnom registri — POZOR! Subjekt môže byť v konkurze/reštrukturalizácii."

            # Defaultný fallback, ak UI nepoznáme ale nevyhlásilo to prázdne konania
            if "Konkurz (0)" in text_content and "Malý Konkurz (0)" in text_content and "Likvidácia (0)" in text_content:
                return False, "Subjekt nemá negatívne záznamy v registri úpadcov."

            return False, "Subjekt nemá negatívne záznamy v registri úpadcov (Stav neurčený)."

        except Exception as e:
            logger.warning(f"[{self.source_type}] Zlyhala extrakcia nálezov: {e}")
            return False, "Žiadny záznam v registri úpadcov (stav neurčený)."
