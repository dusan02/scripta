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
    Vyhľadáva priamym GET dotazom podľa IČO (`typ=1` = Zamestnávatelia a SZČO).
    Stránka nemá PDF export — generuje PDF cez print-to-PDF.
    """

    source_type = "VSZP_DLZNICI"
    base_url = "https://www.vszp.sk/platitelia/platenie-poistneho/zoznam-dlznikov.html"

    async def run(self, *, ico: str, output_dir: Path, **kwargs) -> ScrapedSource:
        async def _scrape(page: Page) -> ScrapedSource:
            logger.info(f"[{self.source_type}] Začínam vyhľadávanie pre IČO: {ico}")

            # Priamy GET dotaz (typ=1 = Zamestnávatelia a SZČO; bez typ=1 vyhľadáva len medzi samoplatiteľmi).
            # Vyhýba sa klikaniu cez Cookiebot / chatbot widget / modály, ktoré spôsobovali 35s timeouty.
            search_url = f"{self.base_url}?typ=1&nazov={ico}&proceed=true#vyhl"
            logger.info(f"[{self.source_type}] Navigujem na {search_url}")
            from .mixins import SKIP_PDF_VAR
            nav_timeout = 20000 if SKIP_PDF_VAR.get() else 30000
            try:
                resp = await page.goto(search_url, timeout=nav_timeout, wait_until="commit")
                await page.wait_for_load_state("domcontentloaded", timeout=nav_timeout)
            except (PlaywrightTimeoutError, PlaywrightError) as e:
                raise ScraperUnavailableError(f"VšZP nedostupná: {e}")

            if resp is not None and resp.status >= 400:
                raise ScraperUnavailableError(f"VšZP vrátila HTTP {resp.status}")

            # Počkať na SSR výsledky — tabuľku alebo text "Nenašli sa žiadne záznamy"
            empty_locator = page.locator("text=Nenašli sa žiadne záznamy")
            table_locator = page.locator("table.tabulkaStandard tbody tr, table tbody tr, .table tbody tr")
            try:
                await empty_locator.or_(table_locator).first.wait_for(timeout=5000)
            except PlaywrightTimeoutError:
                logger.warning(f"[{self.source_type}] Čakanie na výsledky vypršalo, kontrolujem obsah stránky.")

            # Pre PDF odstránime prípadné prekrývajúce bannery/modály cez JS bez zbytočných timeoutov
            if not SKIP_PDF_VAR.get():
                try:
                    await page.evaluate("""() => {
                        for (const sel of [
                            '#CybotCookiebotDialog',
                            '#CybotCookiebotDialogBodyUnderlay',
                            '.predu-msg-img',
                            '#predu-widget',
                            '.md-modal-overlay',
                        ]) {
                            document.querySelectorAll(sel).forEach(el => el.remove());
                        }
                    }""")
                except Exception:
                    pass

            text_content = await page.inner_text("body")
            has_no_results_text = "Nenašli sa žiadne záznamy" in text_content
            has_ico_input = await page.locator(f"#nazov[value='{ico}'], input[name='nazov'][value='{ico}']").count() > 0
            has_ico_on_page = (ico in re.findall(r"\d+", text_content)) or has_ico_input

            findings = None
            is_debtor = False
            if not has_no_results_text:
                findings = await self._extract_table_findings(page, ico, source_name="VšZP")
                is_debtor = findings is not None and "POZOR" in findings
                # Dodatočná kontrola: IČO by malo byť v extrahovaných nálezoch
                if is_debtor and findings and not self._ico_in_findings(ico, findings):
                    logger.warning(f"[{self.source_type}] Tabuľka nájdená, ale IČO {ico} nie je v náleze — pravdepodobne false positive.")
                    is_debtor = False
                    findings = None

            pdf_output = output_dir / f"vszp_dlznici_{ico}.pdf"

            # Guard: ak stránka nevrátila ani dlžníka, ani správu o prázdnom výsledku, neoznačuj ako CLEAN
            if not is_debtor and not has_no_results_text:
                logger.warning(f"[{self.source_type}] Nejednoznačná odpoveď VšZP pre IČO {ico}.")
                try:
                    await self._generate_debtor_no_results_pdf(
                        page, pdf_output, ico,
                        source_name="VšZP",
                        has_ico=has_ico_on_page,
                        has_no_results_text=False,
                    )
                except Exception as e:
                    logger.error(f"[{self.source_type}] Zlyhalo generovanie fallback PDF: {e}")
                return self._make_result(
                    status="UNAVAILABLE",
                    file_path=str(pdf_output) if pdf_output.exists() else None,
                    page_count=1 if pdf_output.exists() else None,
                    status_message="VšZP: nepodarilo sa potvrdiť výsledok vyhľadávania.",
                    findings="Dáta dočasne nedostupné — skúste vygenerovať report znovu.",
                )

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
                    has_finding=False,
                )

            # Inak sme našli subjekt v tabuľke (is_debtor = True).
            # Pred tlačením PDF schováme riadky, ktoré neobsahujú naše IČO.
            try:
                await page.evaluate("""(ico) => {
                    const rows = document.querySelectorAll('table.tabulkaStandard tbody tr, table tbody tr, .table tbody tr');
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
                    content_selector="table.tabulkaStandard, table, .table",
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
                has_finding=True,
            )

        return await self._run_debtor_scraper(_scrape, unavailable_msg="Register VšZP je nedostupný")
