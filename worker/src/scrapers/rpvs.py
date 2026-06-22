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
    Používa Rozšírené vyhľadávanie -> zadá IČO -> Hľadať -> klikne na názov firmy v tabuľke.
    """

    source_type = "RPVS"
    base_url = "https://rpvs.gov.sk/rpvs"

    async def run(self, *, ico: str, output_dir: Path, **kwargs) -> ScrapedSource:
        page: Optional[Page] = None
        try:
            logger.info(f"[{self.source_type}] Začínam vyhľadávanie pre IČO: {ico}")
            page = await self._get_page()

            # 1. Načítaj úvodnú stránku
            logger.info(f"[{self.source_type}] Navigujem na {self.base_url}")
            try:
                await page.goto(self.base_url, timeout=30000, wait_until="domcontentloaded")
            except PlaywrightTimeoutError:
                logger.error(f"[{self.source_type}] Timeout pri načítaní úvodnej stránky RPVS.")
                raise ScraperUnavailableError("Timeout pri načítaní stránky RPVS.")

            # 2. Klikni na "Rozšírené vyhľadávanie"
            advanced_link = page.get_by_role("link", name="Rozšírené vyhľadávanie")
            try:
                await advanced_link.wait_for(state="visible", timeout=10000)
                await advanced_link.click()
                await page.wait_for_url("**/VyhladavaniePartnera*", timeout=15000)
            except Exception as e:
                logger.warning(f"[{self.source_type}] Zlyhal klik na 'Rozšírené vyhľadávanie' ({e}), navigujem priamo.")
                await page.goto(
                    "https://rpvs.gov.sk/rpvs/Partner/Partner/VyhladavaniePartnera?zachovatFiltre=false",
                    timeout=20000,
                    wait_until="domcontentloaded",
                )

            # 3. Zadaj IČO do políčka "IČO"
            ico_input = page.get_by_role("textbox", name="IČO")
            try:
                await ico_input.wait_for(state="visible", timeout=10000)
                await ico_input.fill(ico)
            except PlaywrightTimeoutError:
                logger.error(f"[{self.source_type}] Nenájdené pole IČO.")
                raise ScraperUnavailableError("RPVS: Nenájdené pole IČO.")

            # 4. Klikni "Hľadať"
            search_btn = page.get_by_role("button", name="Hľadať")
            try:
                await search_btn.wait_for(state="visible", timeout=10000)
                await search_btn.click()
            except PlaywrightTimeoutError:
                logger.warning(f"[{self.source_type}] 'Hľadať' tlačidlo nenájdené cez get_by_role, skúšam CSS.")
                search_btn_css = page.locator("button:has-text('Hľadať'), input[value*='Hľadať'], .btn-primary:has-text('Hľadať')").first
                await search_btn_css.click()

            # Počkáme, kým sa zmení obsah tabuľky na hľadané IČO alebo text, že sa nič nenašlo
            try:
                await page.wait_for_function(
                    """(ico) => {
                        const text = document.body.innerText;
                        const tdElements = Array.from(document.querySelectorAll('tbody tr td:nth-child(3)'));
                        const cleanTarget = ico.replace(/\\D/g, '');
                        const hasIco = tdElements.some(td => td.innerText.replace(/\\D/g, '').includes(cleanTarget));
                        const hasNoResults = text.includes('Nenašli sa žiadne') || text.includes('0 celkom 0') || text.includes('0 až 0');
                        return hasIco || hasNoResults;
                    }""",
                    arg=ico,
                    timeout=20000
                )
                logger.info(f"[{self.source_type}] Výsledky vyhľadávania načítané.")
            except Exception as e:
                logger.warning(f"[{self.source_type}] Čakanie na výsledky vyhľadávania vypršalo ({e}), pokračujem...")

            # 5. Počkaj na výsledky a klikni na názov partnera
            # Kliká sa na Meno partnera verejného sektora, ktoré je v 2. stĺpci prvého riadku (td:nth-child(2))
            company_link = page.locator("tbody tr td:nth-child(2) a").first
            company_name = None
            try:
                await company_link.wait_for(state="visible", timeout=15000)
                company_name = await company_link.inner_text()
                if company_name:
                    company_name = company_name.strip()
                logger.info(f"[{self.source_type}] Klikám na názov partnera v tabuľke: {company_name}")
                await company_link.click()
            except PlaywrightTimeoutError:
                # Kontrola, či neboli nájdené žiadne výsledky
                text = await page.inner_text("body")
                if "Nenašli sa žiadne" in text or "0 až 0" in text or "0 celkom 0" in text:
                    logger.info(f"[{self.source_type}] IČO {ico} nebolo nájdené v RPVS.")
                    return self._make_result(
                        status="SUCCESS",
                        file_path=None,
                        status_message=f"IČO {ico} nebolo nájdené v RPVS.",
                        findings="Subjekt nie je evidovaný ako partner verejného sektora.",
                    )
                else:
                    logger.error(f"[{self.source_type}] Nepodarilo sa nájsť odkaz na detail firmy.")
                    raise ScraperUnavailableError("RPVS: Nepodarilo sa nájsť odkaz na detail firmy.")

            # 6. Overenie, že sa správne načítala stránka detailu partnera
            try:
                heading_partner = page.get_by_role("heading", name="Partner verejného sektora")
                heading_data = page.get_by_role("heading", name="Aktuálne údaje")
                await heading_partner.wait_for(state="visible", timeout=15000)
                await heading_data.wait_for(state="visible", timeout=15000)
                logger.info(f"[{self.source_type}] Stránka detailu úspešne overená.")
            except PlaywrightTimeoutError:
                logger.error(f"[{self.source_type}] Načítanie detailu zlyhalo alebo chýbajú očakávané nadpisy.")
                raise ScraperUnavailableError("RPVS: Detail partnera neobsahuje očakávané nadpisy.")

            # 7. Stiahnutie oficiálneho PDF výpisu
            file_path = output_dir / f"{self.source_type}_{ico}.pdf"
            logger.info(f"[{self.source_type}] Sťahujem oficiálny PDF výpis pre IČO {ico}")
            
            try:
                # Skúsime kliknúť na viditeľné tlačidlo/odkaz obsahujúci text "Stiahnuť výpis"
                download_selector = "a:has-text('Stiahnuť výpis'):visible"
                await page.locator(download_selector).first.wait_for(state="visible", timeout=10000)
                await self._download_pdf(page, download_selector, file_path)
                logger.info(f"[{self.source_type}] Oficiálny PDF výpis úspešne stiahnutý do {file_path}")
            except Exception as e:
                logger.warning(f"[{self.source_type}] Stiahnutie oficiálneho PDF zlyhalo ({e}). Robím fallback na tlač stránky.")
                await page.emulate_media(media="screen")
                # Vynútime tmavý text a biele pozadie, aby sme predišli bielym textom na bielom pozadí
                try:
                    await page.add_style_tag(content="body, body * { color: #000000 !important; background-color: #ffffff !important; background-image: none !important; }")
                except Exception as style_err:
                    logger.warning(f"[{self.source_type}] Nepodarilo sa injektovať štýly pre tlač: {style_err}")
                await self._print_page_to_pdf(page, file_path)

            findings = await self._extract_findings(page)

            return self._make_result(
                status="SUCCESS",
                file_path=str(file_path),
                page_count=1,
                status_message="Výpis z RPVS úspešne vygenerovaný.",
                findings=findings,
                company_name=company_name,
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
