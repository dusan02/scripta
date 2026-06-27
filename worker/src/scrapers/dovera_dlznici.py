from __future__ import annotations
import logging
import re
from pathlib import Path
from typing import Optional

from playwright.async_api import Page, TimeoutError as PlaywrightTimeoutError, Error as PlaywrightError

from .base import BaseScraper, ScraperUnavailableError
from ..models import ScrapedSource

logger = logging.getLogger(__name__)


class DoveraDlzniciScraper(BaseScraper):
    """
    Scraper pre Dôveru zdravotnú poisťovňu — Zoznam dlžníkov na zdravotnom poistení.
    Vyhľadáva podľa IČO. Stránka nemá PDF export — generuje PDF cez print-to-PDF.
    """

    source_type = "DOVERA_DLZNICI"
    base_url = "https://www.dovera.sk/overenia/dlznici/zoznam-dlznikov"

    async def run(self, *, ico: str, output_dir: Path, **kwargs) -> ScrapedSource:
        async def _scrape(page: Page) -> ScrapedSource:
            logger.info(f"[{self.source_type}] Začínam vyhľadávanie pre IČO: {ico}")

            logger.info(f"[{self.source_type}] Navigujem na {self.base_url}")
            try:
                await page.goto(self.base_url, timeout=45000, wait_until='domcontentloaded')
            except (PlaywrightTimeoutError, PlaywrightError) as e:
                raise ScraperUnavailableError(f"Dôvera nedostupná: {e}")

            # Cloudflare Turnstile challenge — skús vyriešiť ak je zobrazený
            await self._handle_cloudflare_challenge(page, max_attempts=3)

            # Kliknúť "Prijať všetky" (cookie banner)
            try:
                btn = page.get_by_role("button", name="Prijať všetky")
                await btn.wait_for(timeout=5000)
                await btn.click()
                logger.info(f"[{self.source_type}] Cookie banner prijatý.")
            except PlaywrightTimeoutError:
                logger.info(f"[{self.source_type}] Cookie banner sa nezobrazil.")

            # Zavrieť modálne okno (Close button) ak je zobrazené
            try:
                close_btn = page.get_by_role("button", name="Close")
                await close_btn.wait_for(timeout=3000)
                await close_btn.click()
                logger.info(f"[{self.source_type}] Modálne okno zavreté.")
            except PlaywrightTimeoutError:
                logger.info(f"[{self.source_type}] Modálne okno sa nezobrazilo.")

            # Vyplniť IČO do textového poľa
            try:
                textbox = page.get_by_role("textbox")
                await textbox.wait_for(timeout=10000)
                await textbox.click()
                await textbox.fill(ico)
                logger.info(f"[{self.source_type}] IČO vyplnené: {ico}")
            except PlaywrightTimeoutError:
                logger.error(f"[{self.source_type}] Textové pole sa nenašlo.")
                return self._make_result(
                    status="FAILED",
                    status_message="Nepodarilo sa nájsť textové pole na stránke Dôvery.",
                )

            # Kliknúť "Hľadať"
            try:
                search_btn = page.get_by_text("Hľadať", exact=True)
                await search_btn.wait_for(timeout=10000)
                await search_btn.click()
                logger.info(f"[{self.source_type}] Tlačidlo Hľadať kliknuté.")
            except PlaywrightTimeoutError:
                logger.error(f"[{self.source_type}] Tlačidlo Hľadať sa nenašlo.")
                return self._make_result(
                    status="FAILED",
                    status_message="Nepodarilo sa nájsť tlačidlo Hľadať na stránke Dôvery.",
                )

            # Cloudflare challenge môže zobraziť aj po vyhľadávaní
            await self._handle_cloudflare_challenge(page, max_attempts=2)

            # Zavrieť modálne okno (Close button) ak sa zobrazilo po vyhľadávaní
            try:
                close_btn = page.get_by_role("button", name="Close")
                await close_btn.wait_for(timeout=3000)
                await close_btn.click()
                logger.info(f"[{self.source_type}] Modálne okno po vyhľadávaní zavreté.")
            except PlaywrightTimeoutError:
                pass

            # Počkať na výsledky
            await page.wait_for_timeout(3000)
            try:
                await page.wait_for_load_state("domcontentloaded", timeout=10000)
            except PlaywrightTimeoutError:
                logger.warning(f"[{self.source_type}] domcontentloaded timeout — pokračujem.")

            # Skontrolovať výsledky — hľadať IČO v textoch na stránke
            body_text = await page.inner_text("body")

            # Dôvera zobrazuje "Pre „ICO" sme nenašli žiadne výsledky v zozname dlžníkov."
            no_results_marker = f"sme nenašli žiadne výsledky"
            is_empty = no_results_marker in body_text

            # Najprv skúsime extrahovať nálezy z tabuľky — to je spoľahlivé
            # (na rozdiel od kontroly "ico in body_text" ktorá môže matchnúť
            # IČO v hlavičke/footri/JS kóde stránky)
            findings = None
            is_debtor = False
            if not is_empty:
                findings = await self._extract_findings(page, ico)
                is_debtor = findings is not None and "POZOR" in (findings or "")
                # Dodatočná kontrola: IČO by malo byť v extrahovaných nálezoch
                if is_debtor and ico not in findings:
                    logger.warning(f"[{self.source_type}] Nálezy nájdené, ale IČO {ico} nie je v nich — pravdepodobne false positive.")
                    is_debtor = False
                    findings = None

            if not is_debtor or findings is None:
                logger.info(f"[{self.source_type}] Subjekt {ico} nie je v zozname dlžníkov Dôvery.")
                findings = "Žiadny záznam — subjekt nie je v zozname dlžníkov Dôvery."

            # Generovať PDF z výsledkovej stránky
            pdf_output = output_dir / f"dovera_dlznici_{ico}.pdf"
            try:
                # Keď nie sú výsledky, odstráň všetko okrem vyhľadávacieho formulára
                if is_empty:
                    await page.evaluate("""() => {
                        // Nájdi main content / search form area
                        const keep = document.querySelector('main, .main, .content, .search-form, form, [class*="content"], [class*="search"]');
                        const body = document.body;
                        if (keep && keep !== body) {
                            while (body.firstChild) body.removeChild(body.firstChild);
                            body.appendChild(keep);
                        }
                        // Odstráň všetky promo boxy aj keď zostali vo vnútri
                        document.querySelectorAll('[class*="promo"], [class*="banner"], [class*="cta"], [class*="pay"]').forEach(el => el.remove());
                        document.querySelectorAll('*').forEach(el => {
                            if (el.children.length === 0) {
                                const text = (el.textContent || '').trim();
                                if (text.includes('Nenašli ste sa') || text.includes('Overte si') || text.includes('zaplatiť')) {
                                    el.remove();
                                }
                            }
                        });
                    }""")

                await self._generate_clean_pdf(
                    page, pdf_output,
                    title="Zoznam dlžníkov Dôvera",
                )
            except Exception as e:
                logger.error(f"[{self.source_type}] Zlyhalo generovanie PDF: {e}")
                return self._make_result(
                    status="FAILED",
                    status_message=f"Chyba pri generovaní PDF: {e}",
                )

            if is_debtor and findings and "POZOR" in findings:
                return self._make_result(
                    status="SUCCESS",
                    file_path=str(pdf_output),
                    page_count=1,
                    status_message=f"Subjekt {ico} je v zozname dlžníkov Dôvery.",
                    findings=findings,
                )
            else:
                return self._make_result(
                    status="SUCCESS",
                    file_path=str(pdf_output),
                    page_count=1,
                    status_message=f"Subjekt {ico} nie je v zozname dlžníkov Dôvery.",
                    findings=findings,
                )

        return await self._run_debtor_scraper(_scrape, unavailable_msg="Register Dôvery je nedostupný")

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
