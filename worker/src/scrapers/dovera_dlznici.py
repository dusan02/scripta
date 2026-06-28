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
                await page.goto(self.base_url, timeout=20000, wait_until='domcontentloaded')
            except (PlaywrightTimeoutError, PlaywrightError) as e:
                logger.warning(f"[{self.source_type}] Dôvera nedostupná ({e}) — generujem fallback PDF.")
                pdf_output = output_dir / f"dovera_dlznici_{ico}.pdf"
                try:
                    await self._generate_debtor_no_results_pdf(
                        page, pdf_output, ico,
                        source_name="Dôvera",
                        has_ico=False,
                        has_no_results_text=False,
                    )
                except Exception as e2:
                    logger.error(f"[{self.source_type}] Zlyhalo aj fallback PDF: {e2}")
                    raise ScraperUnavailableError(f"Dôvera nedostupná: {e}")
                return self._make_result(
                    status="SUCCESS",
                    file_path=str(pdf_output),
                    page_count=1,
                    status_message="Dôvera: stránka nedostupná (timeout/blokovanie).",
                    findings="Dôvera: vyhľadávanie zlyhalo — stránka nedostupná.",
                )

            # Cloudflare Turnstile challenge — skús vyriešiť ak je zobrazený
            await self._handle_cloudflare_challenge(page, max_attempts=2)

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

            # Vyplniť IČO do textového poľa — skúšame viacero selektorov
            try:
                try:
                    await page.wait_for_load_state("networkidle", timeout=8000)
                except PlaywrightTimeoutError:
                    pass

                # Dôvera lazy-loaduje formulár — počkáme navyše
                await page.wait_for_timeout(1000)

                ico_filled = False
                for selector in [
                    "input[placeholder*='IČO']",
                    "input[placeholder*='ico']",
                    "input[placeholder*='Obchodné']",
                    "input[type='text']",
                    "input[type='search']",
                    "#ico",
                    "input.search-input",
                    "input[name*='ico']",
                    "input[name*='search']",
                    "input[name*='query']",
                ]:
                    try:
                        el = page.locator(selector).first
                        await el.wait_for(timeout=3000)
                        await el.click()
                        await el.fill(ico)
                        ico_filled = True
                        logger.info(f"[{self.source_type}] IČO vyplnené (selector: {selector}): {ico}")
                        break
                    except (PlaywrightTimeoutError, PlaywrightError):
                        continue

                if not ico_filled:
                    # Skús role-based ako posledný pokus
                    try:
                        textbox = page.get_by_role("textbox")
                        await textbox.first.wait_for(timeout=5000)
                        await textbox.first.click()
                        await textbox.first.fill(ico)
                        ico_filled = True
                        logger.info(f"[{self.source_type}] IČO vyplnené cez get_by_role: {ico}")
                    except (PlaywrightTimeoutError, PlaywrightError):
                        pass

                if not ico_filled:
                    logger.error(f"[{self.source_type}] Textové pole sa nenašlo — generujem PDF z aktuálneho stavu.")
                    pdf_output = output_dir / f"dovera_dlznici_{ico}.pdf"
                    try:
                        await self._generate_debtor_no_results_pdf(
                            page, pdf_output, ico,
                            source_name="Dôvera",
                            has_ico=False,
                            has_no_results_text=False,
                        )
                    except Exception as e:
                        logger.error(f"[{self.source_type}] Zlyhalo aj fallback PDF: {e}")
                        return self._make_result(status="FAILED", status_message=f"Nepodarilo sa nájsť pole na stránke Dôvery: {e}")
                    return self._make_result(
                        status="SUCCESS",
                        file_path=str(pdf_output),
                        page_count=1,
                        status_message="Dôvera: nepodarilo sa vykonať vyhľadávanie (zmena stránky).",
                        findings="Dôvera: vyhľadávanie zlyhalo — stránka sa pravdepodobne zmenila.",
                    )
            except Exception as e:
                logger.error(f"[{self.source_type}] Neočakávaná chyba pri vypĺňaní IČO: {e}")
                pdf_output = output_dir / f"dovera_dlznici_{ico}.pdf"
                try:
                    await self._generate_debtor_no_results_pdf(
                        page, pdf_output, ico,
                        source_name="Dôvera",
                        has_ico=False,
                        has_no_results_text=False,
                    )
                except Exception as e2:
                    logger.error(f"[{self.source_type}] Zlyhalo aj fallback PDF: {e2}")
                    return self._make_result(status="FAILED", status_message=f"Chyba pri vypĺňaní IČO: {e}")
                return self._make_result(
                    status="SUCCESS",
                    file_path=str(pdf_output),
                    page_count=1,
                    status_message="Dôvera: nepodarilo sa vykonať vyhľadávanie (zmena stránky).",
                    findings="Dôvera: vyhľadávanie zlyhalo — stránka sa pravdepodobne zmenila.",
                )

            # Kliknúť "Hľadať" — skúšame viacero selektorov
            search_clicked = False
            for selector in [
                "button:has-text('Hľadať')",
                "input[value='Hľadať']",
                "button[type='submit']",
                "a:has-text('Hľadať')",
                ".search-button",
                "button:has-text('Vyhľadať')",
            ]:
                try:
                    btn = page.locator(selector).first
                    await btn.wait_for(timeout=3000)
                    await btn.click()
                    search_clicked = True
                    logger.info(f"[{self.source_type}] Tlačidlo Hľadať kliknuté (selector: {selector}).")
                    break
                except (PlaywrightTimeoutError, PlaywrightError):
                    continue

            if not search_clicked:
                try:
                    search_btn = page.get_by_text("Hľadať", exact=True)
                    await search_btn.wait_for(timeout=5000)
                    await search_btn.click()
                    search_clicked = True
                    logger.info(f"[{self.source_type}] Tlačidlo Hľadať kliknuté cez get_by_text.")
                except (PlaywrightTimeoutError, PlaywrightError):
                    pass

            if not search_clicked:
                logger.error(f"[{self.source_type}] Tlačidlo Hľadať sa nenašlo — generujem PDF z aktuálneho stavu.")
                pdf_output = output_dir / f"dovera_dlznici_{ico}.pdf"
                try:
                    await self._generate_debtor_no_results_pdf(
                        page, pdf_output, ico,
                        source_name="Dôvera",
                        has_ico=True,
                        has_no_results_text=False,
                    )
                except Exception as e:
                    logger.error(f"[{self.source_type}] Zlyhalo aj fallback PDF: {e}")
                    return self._make_result(status="FAILED", status_message=f"Nepodarilo sa nájsť tlačidlo Hľadať: {e}")
                return self._make_result(
                    status="SUCCESS",
                    file_path=str(pdf_output),
                    page_count=1,
                    status_message="Dôvera: nepodarilo sa spustiť vyhľadávanie (zmena stránky).",
                    findings="Dôvera: vyhľadávanie zlyhalo — tlačidlo sa nenašlo.",
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
            await page.wait_for_timeout(2000)
            try:
                await page.wait_for_load_state("domcontentloaded", timeout=8000)
            except PlaywrightTimeoutError:
                logger.warning(f"[{self.source_type}] domcontentloaded timeout — pokračujem.")

            # Skontrolovať výsledky — vyžadujeme obe podmienky pre negatívny výsledok
            body_text = await page.inner_text("body")

            # Dôvera zobrazuje "Pre „ICO" sme nenašli žiadne výsledky v zozname dlžníkov."
            no_results_marker = f"sme nenašli žiadne výsledky"
            is_empty = no_results_marker in body_text
            has_ico_on_page = ico in re.findall(r"\d+", body_text)

            # Najprv skúsime extrahovať nálezy z tabuľky — to je spoľahlivé
            # (na rozdiel od kontroly "ico in body_text" ktorá môže matchnúť
            # IČO v hlavičke/footri/JS kóde stránky)
            findings = None
            is_debtor = False
            if not is_empty:
                findings = await self._extract_findings(page, ico)
                is_debtor = findings is not None and "POZOR" in (findings or "")
                # Dodatočná kontrola: IČO by malo byť v extrahovaných nálezoch
                if is_debtor and findings and ico not in findings:
                    logger.warning(f"[{self.source_type}] Nálezy nájdené, ale IČO {ico} nie je v nich — pravdepodobne false positive.")
                    is_debtor = False
                    findings = None

            # Generovať PDF
            pdf_output = output_dir / f"dovera_dlznici_{ico}.pdf"

            if not is_debtor or findings is None:
                logger.info(
                    f"[{self.source_type}] Subjekt {ico} nie je v zozname dlžníkov Dôvery "
                    f"(IČO na stránke: {has_ico_on_page}, negatívny text: {is_empty})."
                )
                findings = "Žiadny záznam — subjekt nie je v zozname dlžníkov Dôvery."
                try:
                    await self._generate_debtor_no_results_pdf(
                        page, pdf_output, ico,
                        source_name="Dôvera",
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
                    status_message=f"Subjekt {ico} nie je v zozname dlžníkov Dôvery.",
                    findings=findings,
                )

            # Inak sme našli subjekt v tabuľke (is_debtor = True).
            # Stránka Dôvery vracia presné výsledky pre vyhľadané IČO,
            # takže nie je potrebné skrývať ostatné prvky (čo spôsobovalo
            # skrytie sumy a názvu spoločnosti, pretože neobsahovali text IČO).

            # Schováme len reklamný banner s robotom ("Nenašli ste sa v zozname dlžníkov?"),
            # aby PDF zaberalo menej miesta a nemalo zbytočnú druhú stranu.
            try:
                await page.evaluate("""() => {
                    const allEls = document.querySelectorAll('div, section, article');
                    for (const el of allEls) {
                        if (el.innerText && el.innerText.includes('Nenašli ste sa v zozname dlžníkov')) {
                            // Skryjeme len element, ktorý neobsahuje príliš veľa iného textu (aby sme neskryli celú stránku)
                            if (el.innerText.length < 500) {
                                el.style.display = 'none';
                            }
                        }
                    }
                }""")
            except Exception as e:
                logger.warning(f"[{self.source_type}] Zlyhalo skrytie reklamného bannera: {e}")

            try:
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

            return self._make_result(
                status="SUCCESS",
                file_path=str(pdf_output),
                page_count=1,
                status_message=f"Subjekt {ico} je v zozname dlžníkov Dôvery.",
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
