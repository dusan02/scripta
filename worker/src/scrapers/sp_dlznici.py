from __future__ import annotations
import asyncio
import logging
import random
import re
from pathlib import Path

from playwright.async_api import Page, TimeoutError as PlaywrightTimeoutError, Error as PlaywrightError

from .base import BaseScraper, ScraperUnavailableError, ContentCheckError, retry_async, retry_async_call
from ..config import settings
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

    async def _navigate_sp(self, page: Page) -> Page:
        """Naviguje na SP stránku s content check — retry cez retry_async.
        Raises ContentCheckError ak 'Server je nedostupný' (retry sa pokúsi znova).
        Raises ScraperUnavailableError pri perzistentnom timeoute."""
        await page.goto(self.base_url, timeout=30000, wait_until='commit')
        await page.wait_for_load_state('domcontentloaded', timeout=30000)
        logger.info(f"[{self.source_type}] Stránka načítaná, URL: {page.url}")
        # Content check: "Server je nedostupný" = retry
        body_text = await page.inner_text("body")
        if "Server je nedostupný" in body_text:
            raise ContentCheckError(
                "SP — 'Server je nedostupný'",
                result=self._make_result(
                    status="UNAVAILABLE",
                    status_message="Sociálna poisťovňa — nemám prístup.",
                ),
            )
        return page

    async def run(self, *, ico: str, output_dir: Path, **kwargs) -> ScrapedSource:
        async def _scrape(page: Page) -> ScrapedSource:
            logger.info(f"[{self.source_type}] Začínam vyhľadávanie pre IČO: {ico}")

            logger.info(f"[{self.source_type}] Navigujem na {self.base_url}")
            # Unified retry s content check — 3 pokusy, exponential backoff s jitterom
            # retry_async_call:
            #   - pri ContentCheckError s result → vráti result (UNAVAILABLE)
            #   - pri perzistentnom timeoute → raise ScraperUnavailableError
            try:
                nav_result = await retry_async_call(
                    self._navigate_sp, page,
                    source_type=self.source_type,
                    max_attempts=settings.scraper_retries + 1,
                )
            except ScraperUnavailableError:
                return self._make_result(
                    status="UNAVAILABLE",
                    status_message="Sociálna poisťovňa — nedostupná po viacerých pokusoch.",
                )
            # Ak retry vrátil ScrapedSource (z ContentCheckError), je to UNAVAILABLE
            if isinstance(nav_result, ScrapedSource):
                return nav_result

            # Zavri cookie banner ak sa zobrazil
            await self._dismiss_cookie_banner(page)

            # Vyplniť IČO — presný CSS selector #edit-ico--2 (Drupal form)
            ico_input = page.locator('#edit-ico--2, input[name="ico"]')
            try:
                await ico_input.first.wait_for(timeout=15000)
                await ico_input.first.fill(ico)
                logger.info(f"[{self.source_type}] IČO vyplnené: {ico}")
            except PlaywrightTimeoutError:
                logger.error(f"[{self.source_type}] Pole IČO sa nenašlo.")
                return self._make_result(
                    status="FAILED",
                    status_message="Nepodarilo sa nájsť pole IČO na stránke Sociálnej poisťovne.",
                )

            # Kliknúť na Potvrdiť — presný CSS selector #edit-submit-debitors--2 (input[type=submit])
            submit_btn = page.locator('#edit-submit-debitors--2, input[value="Potvrdiť"]')
            try:
                await submit_btn.first.wait_for(timeout=15000)
                await submit_btn.first.click()
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
                await empty_locator.or_(table_locator).first.wait_for(timeout=8000)
            except PlaywrightTimeoutError:
                logger.warning(f"[{self.source_type}] Čakanie na výsledky vypršalo, pokračujem.")

            # Skontrolovať či sú výsledky — vyžadujeme obe podmienky pre negatívny výsledok:
            # (1) IČO musí byť na stránke (dôkaz že sa hľadalo to správne IČO)
            # (2) text o negatívnom výsledku
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
            has_ico_on_page = ico in re.findall(r"\d+", text_content)

            # Ak sme prešli empty markers, skontrolujeme či hľadané IČO je v tabuľke
            findings = None
            is_debtor = False
            if not is_empty:
                findings = await self._extract_table_findings(page, ico, source_name="Sociálnej poisťovne", field_map=_SP_FIELD_MAP)
                # _extract_table_findings already filters rows by IČO match (line 505 in mixins.py),
                # so if findings is non-None with POZOR, the IČO was verified at row level.
                is_debtor = findings is not None and "POZOR" in findings

            pdf_output = output_dir / f"sp_dlznici_{ico}.pdf"

            if not is_debtor:
                logger.info(
                    f"[{self.source_type}] Subjekt {ico} nie je v zozname dlžníkov "
                    f"(IČO na stránke: {has_ico_on_page}, negatívny text: {is_empty})."
                )
                findings = "Žiadny záznam — subjekt nie je v zozname dlžníkov na sociálnom poistení."
                try:
                    await self._generate_debtor_no_results_pdf(
                        page, pdf_output, ico,
                        source_name="Sociálnej poisťovne",
                        has_ico=has_ico_on_page,
                        has_no_results_text=is_empty,
                    )
                except Exception as e:
                    logger.error(f"[{self.source_type}] Zlyhalo generovanie no-results PDF: {e}")
                    return self._make_result(status="FAILED", status_message=f"Chyba pri PDF: {e}")

                return self._make_result(
                    status="SUCCESS",
                    file_path=str(pdf_output),
                    page_count=1,
                    status_message=f"Subjekt {ico} nie je v zozname dlžníkov Sociálnej poisťovne.",
                    findings=findings,
                )

            # is_debtor = True — generovať PDF z reálnej stránky
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

            return self._make_result(
                status="SUCCESS",
                file_path=str(pdf_output),
                page_count=1,
                status_message=f"Subjekt {ico} je v zozname dlžníkov Sociálnej poisťovne.",
                findings=findings,
            )

        return await self._run_debtor_scraper(_scrape, unavailable_msg="Register Sociálnej poisťovne je nedostupný")
