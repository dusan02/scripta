from __future__ import annotations
import asyncio
import logging
import re
from pathlib import Path
from typing import Literal, Optional

from playwright.async_api import Page, TimeoutError as PlaywrightTimeoutError, Error as PlaywrightError

from .base import BaseScraper, ScraperUnavailableError
from ..models import ScrapedSource

logger = logging.getLogger(__name__)

_SCRAPER_TIMEOUT = 90  # max seconds for entire scraper attempt
_MAX_RETRIES = 3
_RETRY_DELAY = 5  # seconds between retries


class DoveraDlzniciScraper(BaseScraper):
    """Scraper pre Dôveru zdravotnú poisťovňu — Zoznam dlžníkov na zdravotnom poistení."""

    source_type = "DOVERA_DLZNICI"
    base_url = "https://www.dovera.sk/overenia/dlznici/zoznam-dlznikov"

    async def run(self, *, ico: str, output_dir: Path, **kwargs) -> ScrapedSource:
        async def _scrape(page: Page) -> ScrapedSource:
            logger.info(f"[{self.source_type}] Začínam pre IČO: {ico}")
            pdf_output = output_dir / f"dovera_dlznici_{ico}.pdf"

            # 1. Navigate
            try:
                await page.goto(self.base_url, timeout=30000, wait_until='domcontentloaded')
            except (PlaywrightTimeoutError, PlaywrightError) as e:
                logger.warning(f"[{self.source_type}] Dôvera nedostupná ({e}) — fallback PDF.")
                await self._generate_debtor_no_results_pdf(page, pdf_output, ico, source_name="Dôvera", has_ico=False, has_no_results_text=False)
                return self._make_result(status="UNAVAILABLE", file_path=str(pdf_output), page_count=1, status_message="Dôvera: dáta dočasne nedostupné.", findings="Dáta dočasne nedostupné — skúste vygenerovať report znovu.")

            # 2. Cloudflare + cookies (quick, non-blocking if absent)
            await self._handle_cloudflare_challenge(page, max_attempts=1)
            await self._try_click(page, "button", "Prijať všetky", timeout=2000)
            await self._try_click(page, "button", "Close", timeout=2000)

            # 3. Fill IČO
            if not await self._fill_ico_field(page, ico):
                logger.error(f"[{self.source_type}] Pole pre IČO sa nenašlo — fallback PDF.")
                await self._generate_debtor_no_results_pdf(page, pdf_output, ico, source_name="Dôvera", has_ico=False, has_no_results_text=False)
                return self._make_result(status="UNAVAILABLE", file_path=str(pdf_output), page_count=1, status_message="Dôvera: dáta dočasne nedostupné.", findings="Dáta dočasne nedostupné — skúste vygenerovať report znovu.")

            # 4. Click search
            if not await self._click_search(page):
                logger.error(f"[{self.source_type}] Tlačidlo Hľadať sa nenašlo — fallback PDF.")
                await self._generate_debtor_no_results_pdf(page, pdf_output, ico, source_name="Dôvera", has_ico=True, has_no_results_text=False)
                return self._make_result(status="UNAVAILABLE", file_path=str(pdf_output), page_count=1, status_message="Dôvera: dáta dočasne nedostupné.", findings="Dáta dočasne nedostupné — skúste vygenerovať report znovu.")

            # 5. Cloudflare may appear after search
            await self._handle_cloudflare_challenge(page, max_attempts=1)
            await self._try_click(page, "button", "Close", timeout=2000)

            # 6. Wait for results
            no_results = page.locator("text=sme nenašli žiadne výsledky")
            table = page.locator("table tbody tr, .result-table tr, .table tbody tr")
            try:
                await no_results.or_(table).first.wait_for(timeout=8000)
            except PlaywrightTimeoutError:
                logger.warning(f"[{self.source_type}] Čakanie na výsledky vypršalo, pokračujem.")

            # 7. Check results
            body_text = await page.inner_text("body")
            is_empty = "sme nenašli žiadne výsledky" in body_text
            has_ico_on_page = ico in re.findall(r"\d+", body_text)

            findings = None
            is_debtor = False
            if not is_empty:
                findings = await self._extract_findings(page, ico)
                is_debtor = findings is not None and "POZOR" in (findings or "")
                if is_debtor and findings and ico not in findings:
                    is_debtor = False
                    findings = None

            # 8. Generate PDF
            if not is_debtor or findings is None:
                logger.info(f"[{self.source_type}] Subjekt {ico} nie je v zozname dlžníkov Dôvery.")
                findings = "Žiadny záznam — subjekt nie je v zozname dlžníkov Dôvery."
                await self._generate_debtor_no_results_pdf(page, pdf_output, ico, source_name="Dôvera", has_ico=has_ico_on_page, has_no_results_text=is_empty)
                return self._make_result(status="SUCCESS", file_path=str(pdf_output), page_count=1, status_message=f"Subjekt {ico} nie je v zozname dlžníkov Dôvery.", findings=findings)

            # Debtor found — hide ad banner, generate clean PDF
            try:
                await page.evaluate("""() => {
                    const allEls = document.querySelectorAll('div, section, article');
                    for (const el of allEls) {
                        if (el.innerText && el.innerText.includes('Nenašli ste sa v zozname dlžníkov') && el.innerText.length < 500) {
                            el.style.display = 'none';
                        }
                    }
                }""")
            except Exception:
                pass

            await self._generate_clean_pdf(page, pdf_output, title="Zoznam dlžníkov Dôvera")
            return self._make_result(status="SUCCESS", file_path=str(pdf_output), page_count=1, status_message=f"Subjekt {ico} je v zozname dlžníkov Dôvery.", findings=findings)

        # Wrap with retry + overall timeout per attempt
        last_result = None
        for attempt in range(1, _MAX_RETRIES + 1):
            try:
                result = await asyncio.wait_for(
                    self._run_debtor_scraper(_scrape, unavailable_msg="Register Dôvery je nedostupný"),
                    timeout=_SCRAPER_TIMEOUT,
                )
                # If we got a SUCCESS (even with fallback PDF), return it
                if result.status == "SUCCESS":
                    return result
                last_result = result
                logger.warning(f"[{self.source_type}] Pokus {attempt}/{_MAX_RETRIES} vrátil {result.status}, skúšam znova...")
            except asyncio.TimeoutError:
                logger.warning(f"[{self.source_type}] Timeout pokus {attempt}/{_MAX_RETRIES} ({_SCRAPER_TIMEOUT}s)")
                last_result = self._make_result(status="FAILED", status_message=f"Dôvera: prekročený timeout ({attempt}. pokus).")
            except Exception as e:
                logger.warning(f"[{self.source_type}] Chyba pokus {attempt}/{_MAX_RETRIES}: {e}")
                last_result = self._make_result(status="FAILED", status_message=f"Dôvera: chyba ({attempt}. pokus).")

            if attempt < _MAX_RETRIES:
                await asyncio.sleep(_RETRY_DELAY)

        # All retries exhausted — return UNAVAILABLE with user-friendly message
        logger.error(f"[{self.source_type}] Všetky {_MAX_RETRIES} pokusy zlyhali pre IČO {ico}")
        return self._make_result(
            status="UNAVAILABLE",
            status_message="Dôvera: dočasne nedostupné — skúste vygenerovať report znovu.",
        )

    async def _try_click(self, page: Page, role: Literal["button", "link"], name: str, timeout: int = 3000) -> bool:
        try:
            btn = page.get_by_role(role, name=name)
            await btn.wait_for(timeout=timeout)
            await btn.click()
            logger.info(f"[{self.source_type}] {name} kliknuté.")
            return True
        except PlaywrightTimeoutError:
            return False

    async def _fill_ico_field(self, page: Page, ico: str) -> bool:
        for selector in [
            "input.input[name='q']",
            "input[class='input']",
            "input[placeholder*='IČO']", "input[placeholder*='ico']", "input[placeholder*='Obchodné']",
            "input[type='text']", "input[type='search']", "#ico", "input.search-input",
            "input[name*='ico']", "input[name*='search']", "input[name*='query']",
        ]:
            try:
                el = page.locator(selector).first
                await el.wait_for(timeout=1500)
                await el.click()
                await el.fill(ico)
                logger.info(f"[{self.source_type}] IČO vyplnené ({selector}): {ico}")
                return True
            except (PlaywrightTimeoutError, PlaywrightError):
                continue

        # Last resort: role-based
        try:
            textbox = page.get_by_role("textbox")
            await textbox.first.wait_for(timeout=2000)
            await textbox.first.click()
            await textbox.first.fill(ico)
            logger.info(f"[{self.source_type}] IČO vyplnené cez get_by_role: {ico}")
            return True
        except (PlaywrightTimeoutError, PlaywrightError):
            return False

    async def _click_search(self, page: Page) -> bool:
        # Skús Enter key na inpute ako najrýchlejšiu cestu
        try:
            await page.keyboard.press("Enter")
            logger.info(f"[{self.source_type}] Search cez Enter key.")
            return True
        except (PlaywrightTimeoutError, PlaywrightError):
            pass

        for selector in [
            "div.btn-layout--vertical button[type='submit']",
            "button:has-text('Hľadať')",
            "input[value='Hľadať']", "button[type='submit']",
            "a:has-text('Hľadať')", ".search-button", "button:has-text('Vyhľadať')",
        ]:
            try:
                btn = page.locator(selector).first
                await btn.wait_for(timeout=1500)
                await btn.click()
                logger.info(f"[{self.source_type}] Hľadať kliknuté ({selector}).")
                return True
            except (PlaywrightTimeoutError, PlaywrightError):
                continue

        try:
            search_btn = page.get_by_text("Hľadať", exact=True)
            await search_btn.wait_for(timeout=2000)
            await search_btn.click()
            return True
        except (PlaywrightTimeoutError, PlaywrightError):
            return False

    async def _extract_findings(self, page: Page, ico: str) -> Optional[str]:
        """Extrahuje nálezy zo stránky — hľadá elementy obsahujúce IČO."""
        try:
            # Hľadaj všetky texty obsahujúce IČO
            elements = page.locator(f"text={ico}")
            count = await elements.count()
            if count == 0:
                return None

            # Zbieraj texty z okolitých elementov
            texts = []
            for i in range(min(count, 5)):
                try:
                    el = elements.nth(i)
                    # Skús získať text z rodičovského elementu pre kontext
                    parent = el.locator("xpath=..")
                    parent_text = (await parent.inner_text(timeout=2000)).strip()
                    parent_text = re.sub(r'\s+', ' ', parent_text)
                    if parent_text:
                        texts.append(parent_text)
                except PlaywrightTimeoutError:
                    continue

            if not texts:
                return None

            parts = [f"POZOR: Subjekt (IČO: {ico}) je v zozname dlžníkov Dôvery."]
            for t in texts:
                parts.append(t)
            findings = "\n".join(parts)
            logger.info(f"[{self.source_type}] Findings extrahované: {findings[:200]}")
            return findings

        except Exception as e:
            logger.warning(f"[{self.source_type}] Extrakcia nálezov zlyhala: {e}")
            return None
