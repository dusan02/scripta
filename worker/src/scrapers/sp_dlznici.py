from __future__ import annotations
import logging
from pathlib import Path

from playwright.async_api import Page, TimeoutError as PlaywrightTimeoutError, Error as PlaywrightError

from .base import BaseScraper, ScraperUnavailableError
from ..models import ScrapedSource

logger = logging.getLogger(__name__)

_SP_FIELD_MAP = {
    "views-field-name":       "Názov / Meno",
    "views-field-ico":        "IČO",
    "views-field-address":    "Adresa",
    "views-field-city":       "Mesto",
    "views-field-debt-amount": "Dlžná suma",
    "views-field-missing-documents": "Chýbajúce podklady za obdobie",
}


class SpDlzniciScraper(BaseScraper):
    """
    Scraper pre Sociálnu poisťovňu SR — Zoznam dlžníkov na sociálnom poistení.
    Vyhľadáva podľa IČO. Stránka nemá PDF export — generuje PDF cez print-to-PDF.
    """

    source_type = "SP_DLZNICI"
    base_url = "https://socpoist.sk/nastroje-sluzby/zoznam-dlznikov"

    async def run(self, *, ico: str, output_dir: Path, **kwargs) -> ScrapedSource:
        async def _scrape(page: Page) -> ScrapedSource:
            logger.info(f"[{self.source_type}] Začínam vyhľadávanie pre IČO: {ico}")

            logger.info(f"[{self.source_type}] Navigujem na {self.base_url}")
            try:
                await page.goto(self.base_url, timeout=20000, wait_until='commit')
                await page.wait_for_load_state('domcontentloaded', timeout=10000)
            except (PlaywrightTimeoutError, PlaywrightError) as e:
                raise ScraperUnavailableError(f"SP nedostupná: {e}")
            logger.info(f"[{self.source_type}] Stránka načítaná, URL: {page.url}")

            # Skontrolovať či nás zablokovali
            body_text = await page.inner_text("body")
            if "Server je nedostupný" in body_text:
                logger.error(f"[{self.source_type}] SP zablokovala prístup (geo/bot detekcia).")
                return self._make_result(
                    status="UNAVAILABLE",
                    status_message="Sociálna poisťovňa zablokovala prístup (bot detekcia).",
                )

            # Vyplniť IČO — selektor podľa Drupal form: input[name="ico"]
            ico_input = page.locator('input[name="ico"]')
            try:
                await ico_input.wait_for(timeout=10000)
                await ico_input.fill(ico)
                logger.info(f"[{self.source_type}] IČO vyplnené: {ico}")
            except PlaywrightTimeoutError:
                logger.error(f"[{self.source_type}] Pole IČO sa nenašlo.")
                return self._make_result(
                    status="FAILED",
                    status_message="Nepodarilo sa nájsť pole IČO na stránke Sociálnej poisťovne.",
                )

            # Kliknúť na Potvrdiť
            submit_btn = page.get_by_role("button", name="Potvrdiť")
            try:
                await submit_btn.wait_for(timeout=10000)
                await submit_btn.click()
                logger.info(f"[{self.source_type}] Tlačidlo Potvrdiť kliknuté.")
            except PlaywrightTimeoutError:
                logger.error(f"[{self.source_type}] Tlačidlo Potvrdiť sa nenašlo.")
                return self._make_result(
                    status="FAILED",
                    status_message="Nepodarilo sa nájsť tlačidlo Potvrdiť na stránke Sociálnej poisťovne.",
                )

            # Počkať na výsledky — čakáme na tabuľku alebo text o prázdnych výsledkoch
            empty_locator = page.locator("text=neobsahuje žiadne položky")
            table_locator = page.locator("table tbody tr, .table tbody tr, .result-table tr")
            try:
                await empty_locator.or_(table_locator).first.wait_for(timeout=15000)
            except PlaywrightTimeoutError:
                logger.warning(f"[{self.source_type}] Čakanie na výsledky vypršalo, pokračujem.")

            # Skontrolovať či sú výsledky
            text_content = await page.inner_text("body")
            text_lower = text_content.lower()

            # Prázdne výsledky — žiadne položky
            empty_markers = [
                "zoznam neobsahuje žiadne položky",
                "nenašli sa žiadne",
                "žiadny záznam",
                "bez výsledkov",
                "neboli nájdené žiadne",
                "žiadne výsledky",
            ]
            is_empty = any(marker in text_lower for marker in empty_markers)

            # Ak sme prešli empty markers, skontrolujeme či hľadané IČO je v tabuľke
            findings = None
            is_debtor = False
            if not is_empty:
                findings = await self._extract_table_findings(page, ico, source_name="Sociálnej poisťovne", field_map=_SP_FIELD_MAP)
                is_debtor = findings is not None and ico in findings

            if not is_debtor:
                logger.info(f"[{self.source_type}] Subjekt {ico} nie je v zozname dlžníkov.")
                findings = "Žiadny záznam — subjekt nie je v zozname dlžníkov na sociálnom poistení."

            # Generovať PDF z výsledkovej stránky vždy — aj keď nie je dlžník
            pdf_output = output_dir / f"sp_dlznici_{ico}.pdf"
            try:
                await self._generate_clean_pdf(
                    page, pdf_output,
                    title="Zoznam dlžníkov Sociálnej poisťovne",
                    format="A4",
                    scale=0.9,
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
                    status_message=f"Subjekt {ico} je v zozname dlžníkov Sociálnej poisťovne.",
                    findings=findings,
                )
            else:
                return self._make_result(
                    status="SUCCESS",
                    file_path=str(pdf_output),
                    page_count=1,
                    status_message=f"Subjekt {ico} nie je v zozname dlžníkov Sociálnej poisťovne.",
                    findings=findings,
                )

        return await self._run_debtor_scraper(_scrape, unavailable_msg="Register Sociálnej poisťovne je nedostupný")
