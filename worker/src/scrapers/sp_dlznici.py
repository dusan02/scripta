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

    async def _navigate_sp(self, page: Page, url: str) -> Page:
        """Naviguje na SP stránku s content check — retry cez retry_async.
        Raises ContentCheckError ak 'Server je nedostupný' (retry sa pokúsi znova).
        Raises ScraperUnavailableError pri perzistentnom timeoute."""
        from .mixins import SKIP_PDF_VAR
        nav_timeout = 25000 if SKIP_PDF_VAR.get() else 30000
        await page.goto(url, timeout=nav_timeout, wait_until='commit')
        await page.wait_for_load_state('domcontentloaded', timeout=nav_timeout)
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

            # Priama navigácia na GET vyhľadávací filter — Drupal SSR vráti výsledky
            # okamžite bez potreby vypĺňania a klikania na formulár.
            search_url = f"{self.base_url}?name=&city=&glossary=&ico={ico}"
            logger.info(f"[{self.source_type}] Navigujem na {search_url}")

            # Unified retry s content check — v live check len 1 pokus bez backoffu
            from .mixins import SKIP_PDF_VAR
            is_live = SKIP_PDF_VAR.get()
            max_nav_attempts = 1 if is_live else (settings.scraper_retries + 1)
            try:
                nav_result = await retry_async_call(
                    self._navigate_sp, page, search_url,
                    source_type=self.source_type,
                    max_attempts=max_nav_attempts,
                    base_delay=1.0 if is_live else settings.scraper_retry_delay,
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

            # Skontrolovať tabuľku s výsledkami
            table_rows = page.locator("table.cols-6 tbody tr, table tbody tr")
            row_count = await table_rows.count()

            findings = None
            is_debtor = False

            if row_count > 0:
                findings = await self._extract_table_findings(page, ico, source_name="Sociálnej poisťovne", field_map=_SP_FIELD_MAP)
                is_debtor = findings is not None and "POZOR" in findings

            text_content = await page.inner_text("body")
            has_ico_on_page = (ico in re.findall(r"\d+", text_content)) or (await page.locator(f'input[value="{ico}"]').count() > 0)
            is_empty = row_count == 0

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
                    has_finding=False,
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
                has_finding=True,
            )

        return await self._run_debtor_scraper(_scrape, unavailable_msg="Register Sociálnej poisťovne je nedostupný")
