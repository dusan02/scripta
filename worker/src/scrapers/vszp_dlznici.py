from __future__ import annotations
import logging
from pathlib import Path

from playwright.async_api import Page, TimeoutError as PlaywrightTimeoutError, Error as PlaywrightError

from .base import BaseScraper, ScraperUnavailableError
from ..models import ScrapedSource

logger = logging.getLogger(__name__)

_VSZP_DISCLAIMER = """
    <p style="font-size: 20px; margin: 24px 0 8px 0; line-height: 1.4; text-align: justify;">
    Úhrady zrealizované po dátume, ku ktorému bolo vyhodnotené saldo konto neplatičov, nie sú v daných zoznamoch zohľadnené a zohľadnia sa až pri najbližšej aktualizácii. Dátum, ku ktorému je vyhodnotené saldo konto platiteľov, a obdobie splatnosti pohľadávok rozhodujúcich pre zoznam sú súčasťou zoznamu dlžníkov. Celková suma pohľadávky uvedená v zozname dlžníkov nezohľadňuje prípadnú pohľadávku, ktorá vznikla do 31. 12. 2004 (počas účinnosti zákona č. 273/1994 Z. z. o zdravotnom poistení, financovaní zdravotného poistenia, o zriadení Všeobecnej zdravotnej poisťovne, a. s., a o zriaďovaní rezortných, odvetvových, podnikových a občianskych zdravotných poisťovní).
    </p>
    <p style="font-size: 20px; margin: 8px 0; line-height: 1.4; text-align: justify;">
    Dlžník zverejnený v zozname dlžníkov môže podať písomnú námietku proti svojmu zaradeniu do zoznamu dlžníkov, ktorú adresuje príslušnej pobočke zdravotnej poisťovne, alebo námietku pošle e-mailom na adresu neplatici@vszp.sk. Zdravotná poisťovňa je povinná námietku preveriť a vyjadriť sa k nej do piatich pracovných dní od jej prijatia. V prípade, že sa zistí opodstatnenosť námietky, zdravotná poisťovňa v rovnakej lehote platiteľa zo zoznamu dlžníkov vyradí.
    </p>
    <p style="font-size: 20px; margin: 8px 0; line-height: 1.4; text-align: justify;">
    Zdravotná poisťovňa spracúva osobné údaje dlžníkov na základe zákona o zdravotnom poistení v súlade s článkom 6 bodom 1 písm. c) Nariadenia Európskeho parlamentu a Rady (EÚ) č. 2016/679 o ochrane fyzických osôb v súvislosti so spracúvaním osobných údajov, o voľnom pohybe týchto údajov a o zrušení smernice 95/46/ES (GDPR). Vzhľadom na to, že spracúvanie osobných údajov je v tomto prípade vyžadované zákonom, niektoré práva dotknutých osôb podľa GDPR môžu byť obmedzené, vždy však v súlade s GDPR. Podrobné informácie o spracúvaní osobných údajov.
    </p>
    <p style="font-size: 20px; margin: 8px 0; line-height: 1.4; text-align: justify;">
    Zdravotná poisťovňa nezodpovedá za údaje o svojich dlžníkoch zverejnených na internetových stránkach iných spoločností.
    </p>
"""


class VszpDlzniciScraper(BaseScraper):
    """
    Scraper pre Všeobecnú zdravotnú poisťovňu (VšZP) — Zoznam dlžníkov na zdravotnom poistení.
    Vyhľadáva podľa IČO (zadaného do poľa "Nazov").
    Stránka nemá PDF export — generuje PDF cez print-to-PDF.
    """

    source_type = "VSZP_DLZNICI"
    base_url = "https://www.vszp.sk/platitelia/platenie-poistneho/zoznam-dlznikov.html"

    async def run(self, *, ico: str, output_dir: Path, **kwargs) -> ScrapedSource:
        async def _scrape(page: Page) -> ScrapedSource:
            logger.info(f"[{self.source_type}] Začínam vyhľadávanie pre IČO: {ico}")

            logger.info(f"[{self.source_type}] Navigujem na {self.base_url}")
            try:
                await page.goto(self.base_url, timeout=30000, wait_until='networkidle')
            except (PlaywrightTimeoutError, PlaywrightError) as e:
                raise ScraperUnavailableError(f"VšZP nedostupná: {e}")

            # Kliknúť "Povoliť všetko" (cookie banner)
            try:
                btn = page.get_by_role("button", name="Povoliť všetko")
                await btn.wait_for(timeout=5000)
                await btn.click()
                logger.info(f"[{self.source_type}] Cookie banner prijatý.")
            except PlaywrightTimeoutError:
                logger.info(f"[{self.source_type}] Cookie banner sa nezobrazil.")

            # Zavrieť prípadný popup/predu banner
            try:
                predu_close = page.locator("#predu-close-button")
                await predu_close.wait_for(timeout=5000)
                await predu_close.click()
                logger.info(f"[{self.source_type}] Predu banner zatvorený.")
            except PlaywrightTimeoutError:
                pass

            # Zaškrtnúť checkbox "súhlasím" (3rd checkbox — súhlas so spracovaním)
            try:
                checkbox = page.locator("div:nth-child(3) > label > .cr > .cr-icon")
                await checkbox.wait_for(timeout=5000)
                await checkbox.click()
                logger.info(f"[{self.source_type}] Checkbox súhlasu zaškrtnutý.")
            except PlaywrightTimeoutError:
                logger.warning(f"[{self.source_type}] Checkbox súhlasu sa nenašiel — pokračujem.")

            # Vyplniť IČO do poľa "Nazov"
            try:
                nazov_input = page.get_by_role("textbox", name="Nazov")
                await nazov_input.wait_for(timeout=10000)
                await nazov_input.click()
                await nazov_input.fill(ico)
                logger.info(f"[{self.source_type}] IČO vyplnené: {ico}")
            except PlaywrightTimeoutError:
                logger.error(f"[{self.source_type}] Pole 'Nazov' sa nenašlo.")
                return self._make_result(
                    status="FAILED",
                    status_message="Nepodarilo sa nájsť pole 'Nazov' na stránke VšZP.",
                )

            # Kliknúť "Vyhľadať"
            try:
                search_btn = page.get_by_role("button", name="Vyhľadať")
                await search_btn.wait_for(timeout=10000)
                await search_btn.click()
                logger.info(f"[{self.source_type}] Tlačidlo Vyhľadať kliknuté.")
            except PlaywrightTimeoutError:
                logger.error(f"[{self.source_type}] Tlačidlo Vyhľadať sa nenašlo.")
                return self._make_result(
                    status="FAILED",
                    status_message="Nepodarilo sa nájsť tlačidlo Vyhľadať na stránke VšZP.",
                )

            # Počkať na výsledky
            await page.wait_for_timeout(2000)
            try:
                await page.wait_for_load_state("networkidle", timeout=15000)
            except PlaywrightTimeoutError:
                logger.warning(f"[{self.source_type}] networkidle timeout — pokračujem.")

            # Skontrolovať výsledky
            text_content = await page.inner_text("body")
            is_empty = "Nenašli sa žiadne záznamy" in text_content

            findings = None
            is_debtor = False
            if not is_empty:
                findings = await self._extract_table_findings(page, ico, source_name="VšZP")
                is_debtor = findings is not None and "POZOR" in (findings or "")

            if not is_debtor:
                logger.info(f"[{self.source_type}] Subjekt {ico} nie je v zozname dlžníkov VšZP.")
                findings = "Žiadny záznam — subjekt nie je v zozname dlžníkov VšZP."

            # Generovať PDF z výsledkovej stránky
            pdf_output = output_dir / f"vszp_dlznici_{ico}.pdf"
            try:
                await self._generate_clean_pdf(
                    page, pdf_output,
                    title="Zoznam dlžníkov VšZP",
                    disclaimer_html=_VSZP_DISCLAIMER,
                )
            except Exception as e:
                logger.error(f"[{self.source_type}] Zlyhalo generovanie PDF: {e}")
                return self._make_result(
                    status="FAILED",
                    status_message=f"Chyba pri generovaní PDF: {e}",
                )

            if is_debtor:
                return self._make_result(
                    status="SUCCESS",
                    file_path=str(pdf_output),
                    page_count=1,
                    status_message=f"Subjekt {ico} je v zozname dlžníkov VšZP.",
                    findings=findings,
                )
            else:
                return self._make_result(
                    status="SUCCESS",
                    file_path=str(pdf_output),
                    page_count=1,
                    status_message=f"Subjekt {ico} nie je v zozname dlžníkov VšZP.",
                    findings=findings,
                )

        return await self._run_debtor_scraper(_scrape, unavailable_msg="Register VšZP je nedostupný")
