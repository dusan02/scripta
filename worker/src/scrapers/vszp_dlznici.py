from __future__ import annotations
import logging
import re
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
                await page.goto(self.base_url, timeout=10000, wait_until='commit')
                await page.wait_for_load_state('domcontentloaded', timeout=5000)
            except (PlaywrightTimeoutError, PlaywrightError) as e:
                raise ScraperUnavailableError(f"VšZP nedostupná: {e}")

            # Kliknúť "Povoliť všetko" (cookie banner)
            try:
                btn = page.get_by_role("button", name="Povoliť všetko")
                await btn.wait_for(timeout=3000)
                await btn.click()
                logger.info(f"[{self.source_type}] Cookie banner prijatý.")
            except PlaywrightTimeoutError:
                logger.info(f"[{self.source_type}] Cookie banner sa nezobrazil.")

            # Zavrieť prípadný popup/predu banner
            try:
                predu_close = page.locator("#predu-close-button")
                await predu_close.wait_for(timeout=3000)
                await predu_close.click()
                logger.info(f"[{self.source_type}] Predu banner zatvorený.")
            except PlaywrightTimeoutError:
                pass

            # Zaškrtnuť checkbox "súhlasím" (súhlas so spracovaním)
            # Skúšame viacero selektorov — stránka sa môže zmeniť.
            checkbox_clicked = False
            for selector in [
                "div:nth-child(3) > label > .cr > .cr-icon",
                "label:has-text('súhlas') .cr-icon",
                "label:has-text('súhlas') input[type='checkbox']",
                "input[type='checkbox']:nth-of-type(3)",
                ".checkbox-wrap:nth-child(3) label",
            ]:
                try:
                    cb = page.locator(selector).first
                    await cb.wait_for(timeout=2000)
                    await cb.click()
                    logger.info(f"[{self.source_type}] Checkbox súhlasu zaškrtnutý (selector: {selector}).")
                    checkbox_clicked = True
                    break
                except PlaywrightTimeoutError:
                    continue
            if not checkbox_clicked:
                logger.warning(f"[{self.source_type}] Checkbox súhlasu sa nenašiel — pokračujem bez neho.")

            # Vyplniť IČO do poľa "Nazov" — skúšame viacero selektorov
            nazov_filled = False
            for selector in [
                "input[name='Nazov']",
                "input[placeholder*='Názov']",
                "input[placeholder*='Nazov']",
                "input[type='text']",
            ]:
                try:
                    nazov_input = page.locator(selector).first
                    await nazov_input.wait_for(timeout=3000)
                    await nazov_input.click()
                    await nazov_input.fill(ico)
                    logger.info(f"[{self.source_type}] IČO vyplnené: {ico} (selector: {selector}).")
                    nazov_filled = True
                    break
                except (PlaywrightTimeoutError, PlaywrightError):
                    continue

            if not nazov_filled:
                # Fallback: skús get_by_role
                try:
                    nazov_input = page.get_by_role("textbox", name="Nazov")
                    await nazov_input.wait_for(timeout=3000)
                    await nazov_input.click()
                    await nazov_input.fill(ico)
                    nazov_filled = True
                    logger.info(f"[{self.source_type}] IČO vyplnené cez get_by_role.")
                except (PlaywrightTimeoutError, PlaywrightError):
                    pass

            if not nazov_filled:
                logger.error(f"[{self.source_type}] Pole pre IČO sa nenašlo — generujem PDF z aktuálneho stavu.")
                pdf_output = output_dir / f"vszp_dlznici_{ico}.pdf"
                try:
                    await self._generate_debtor_no_results_pdf(
                        page, pdf_output, ico,
                        source_name="VšZP",
                        has_ico=False,
                        has_no_results_text=False,
                    )
                except Exception as e:
                    logger.error(f"[{self.source_type}] Zlyhalo aj fallback PDF: {e}")
                    return self._make_result(status="FAILED", status_message=f"Nepodarilo sa nájsť pole na stránke VšZP: {e}")
                return self._make_result(
                    status="SUCCESS",
                    file_path=str(pdf_output),
                    page_count=1,
                    status_message="VšZP: nepodarilo sa vykonať vyhľadávanie (zmena stránky).",
                    findings="VšZP: vyhľadávanie zlyhalo — stránka sa pravdepodobne zmenila.",
                )

            # Kliknúť "Vyhľadať" — skúšame viacero selektorov
            search_clicked = False
            for selector in [
                "button:has-text('Vyhľadať')",
                "input[value='Vyhľadať']",
                "button[type='submit']",
                ".search-button",
            ]:
                try:
                    btn = page.locator(selector).first
                    await btn.wait_for(timeout=3000)
                    await btn.click()
                    logger.info(f"[{self.source_type}] Tlačidlo Vyhľadať kliknuté (selector: {selector}).")
                    search_clicked = True
                    break
                except (PlaywrightTimeoutError, PlaywrightError):
                    continue

            if not search_clicked:
                try:
                    search_btn = page.get_by_role("button", name="Vyhľadať")
                    await search_btn.wait_for(timeout=3000)
                    await search_btn.click()
                    search_clicked = True
                    logger.info(f"[{self.source_type}] Tlačidlo Vyhľadať kliknuté cez get_by_role.")
                except (PlaywrightTimeoutError, PlaywrightError):
                    pass

            if not search_clicked:
                logger.error(f"[{self.source_type}] Tlačidlo Vyhľadať sa nenašlo — generujem PDF z aktuálneho stavu.")
                pdf_output = output_dir / f"vszp_dlznici_{ico}.pdf"
                try:
                    await self._generate_debtor_no_results_pdf(
                        page, pdf_output, ico,
                        source_name="VšZP",
                        has_ico=True,
                        has_no_results_text=False,
                    )
                except Exception as e:
                    logger.error(f"[{self.source_type}] Zlyhalo aj fallback PDF: {e}")
                    return self._make_result(status="FAILED", status_message=f"Nepodarilo sa nájsť tlačidlo Vyhľadať: {e}")
                return self._make_result(
                    status="SUCCESS",
                    file_path=str(pdf_output),
                    page_count=1,
                    status_message="VšZP: nepodarilo sa spustiť vyhľadávanie (zmena stránky).",
                    findings="VšZP: vyhľadávanie zlyhalo — tlačidlo sa nenašlo.",
                )

            # Počkať na výsledky — čakáme na tabuľku alebo text "Nenašli sa žiadne záznamy"
            empty_locator = page.locator("text=Nenašli sa žiadne záznamy")
            table_locator = page.locator("table tbody tr, .table tbody tr, .result-table tr")
            try:
                await empty_locator.or_(table_locator).first.wait_for(timeout=8000)
            except PlaywrightTimeoutError:
                logger.warning(f"[{self.source_type}] Čakanie na výsledky vypršalo, pokračujem.")

            # Skontrolovať výsledky — vyžadujeme OBE podmienky pre negatívny výsledok:
            # (1) IČO musí byť na stránke (dôkaz že sa hľadalo to správne IČO)
            # (2) text "Nenašli sa žiadne záznamy." (dôkaz že nič nenašlo)
            text_content = await page.inner_text("body")
            has_no_results_text = "Nenašli sa žiadne záznamy" in text_content
            has_ico_on_page = ico in re.findall(r"\d+", text_content)

            findings = None
            is_debtor = False
            if not has_no_results_text:
                findings = await self._extract_table_findings(page, ico, source_name="VšZP")
                is_debtor = findings is not None and "POZOR" in (findings or "")
                # Dodatočná kontrola: IČO by malo byť v extrahovaných nálezoch
                if is_debtor and findings and ico not in findings:
                    logger.warning(f"[{self.source_type}] Tabuľka nájdená, ale IČO {ico} nie je v náleze — pravdepodobne false positive.")
                    is_debtor = False
                    findings = None

            # Generovať PDF
            pdf_output = output_dir / f"vszp_dlznici_{ico}.pdf"
            
            if not is_debtor:
                logger.info(
                    f"[{self.source_type}] Subjekt {ico} nie je v zozname dlžníkov VšZP "
                    f"(IČO na stránke: {has_ico_on_page}, text 'Nenašli sa žiadne záznamy': {has_no_results_text})."
                )
                findings = "Žiadny záznam — subjekt nie je v zozname dlžníkov VšZP."
                try:
                    await self._generate_debtor_no_results_pdf(
                        page, pdf_output, ico,
                        source_name="VšZP",
                        has_ico=has_ico_on_page,
                        has_no_results_text=has_no_results_text,
                    )
                except Exception as e:
                    logger.error(f"[{self.source_type}] Zlyhalo generovanie no-results PDF: {e}")
                    return self._make_result(status="FAILED", status_message=f"Chyba pri PDF: {e}")

                return self._make_result(
                    status="SUCCESS",
                    file_path=str(pdf_output),
                    page_count=1,
                    status_message=f"Subjekt {ico} nie je v zozname dlžníkov VšZP.",
                    findings=findings,
                )

            # Inak sme našli subjekt v tabuľke (is_debtor = True).
            # Pred tlačením PDF schováme riadky, ktoré neobsahujú naše IČO
            # Používame regex s word boundary, aby sme nezhodli IČO ako podreťazec iného čísla.
            try:
                await page.evaluate("""(ico) => {
                    const rows = document.querySelectorAll('table tbody tr, .table tbody tr, .result-table tr');
                    const re = new RegExp('\\\\b' + ico + '\\\\b');
                    for (const row of rows) {
                        if (!re.test(row.innerText)) {
                            row.style.display = 'none';
                        }
                    }
                }""", ico)
            except Exception as e:
                logger.warning(f"[{self.source_type}] DOM filter riadkov zlyhal: {e}")

            try:
                await self._generate_clean_pdf(
                    page, pdf_output,
                    title="Zoznam dlžníkov VšZP",
                    content_selector="table, .table, .result-table",
                    disclaimer_html=_VSZP_DISCLAIMER,
                )
            except Exception as e:
                logger.error(f"[{self.source_type}] Zlyhalo generovanie PDF: {e}")
                return self._make_result(
                    status="FAILED",
                    status_message=f"Chyba pri generovaní PDF: {e}",
                )

            return self._make_result(
                status="SUCCESS",
                file_path=str(pdf_output),
                page_count=1,
                status_message=f"Subjekt {ico} je v zozname dlžníkov VšZP.",
                findings=findings,
            )

        return await self._run_debtor_scraper(_scrape, unavailable_msg="Register VšZP je nedostupný")
