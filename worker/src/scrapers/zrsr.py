from pathlib import Path
from typing import Optional
import logging
import time
from playwright.async_api import Page, TimeoutError as PlaywrightTimeoutError, Error as PlaywrightError

from .base import BaseScraper, ScrapedSource, ScraperUnavailableError

logger = logging.getLogger(__name__)


class ZrsrScraper(BaseScraper):
    """
    Scraper pre Živnostenský register SR.
    """

    source_type = "ZRSR"
    _base_url_company = "https://www.zrsr.sk/index"
    _base_url_person = "https://www.zrsr.sk/index"

    async def run(
        self,
        *,
        output_dir: Path,
        ico: Optional[str] = None,
        name: Optional[str] = None,
        surname: Optional[str] = None,
        birth_date: Optional[str] = None,
        **kwargs
    ) -> ScrapedSource:
        """
        Hlavná metóda na spustenie scrapovania ZRSR.
        """
        page: Optional[Page] = None
        try:
            page = await self._get_page()
            if ico:
                return await self._search_company(page, ico=ico, output_dir=output_dir)
            elif name and surname:
                return await self._search_person(
                    page,
                    name=name,
                    surname=surname,
                    birth_date=birth_date,
                    output_dir=output_dir,
                )
            else:
                return self._make_result(
                    status="FAILED",
                    status_message="Pre ZRSR je potrebné zadať IČO alebo Meno a Priezvisko.",
                )
        except PlaywrightError as e:
            logger.error(f"[{self.source_type}] Playwright chyba: {e}")
            return self._make_result(
                status="FAILED",
                status_message=f"Sieťová chyba pri spracovaní ZRSR: {e}"
            )
        except Exception as e:
            logger.error(f"[{self.source_type}] Nečakaná chyba: {e}")
            return self._make_result(
                status="FAILED",
                status_message=f"Chyba pri spracovaní: {e}"
            )
        finally:
            if page:
                try:
                    await page.close()
                except Exception:
                    pass

    async def _search_company(self, page: Page, *, ico: str, output_dir: Path) -> ScrapedSource:
        if not ico:
            return self._make_result(
                status="FAILED",
                status_message="IČO je povinné pre vyhľadávanie firmy v ZRSR.",
            )

        logger.info(f"[{self.source_type}] Navigujem na {self._base_url_company}")
        _t = time.perf_counter()
        try:
            await page.goto(self._base_url_company, timeout=45000, wait_until="domcontentloaded")
        except PlaywrightTimeoutError:
            raise ScraperUnavailableError("Timeout pri načítaní stránky ZRSR.")
        logger.debug(f"[{self.source_type}] ⏱ goto: {time.perf_counter() - _t:.2f}s")
        _t = time.perf_counter()

        try:
            logger.info(f"[{self.source_type}] Vypĺňam formulár IČO: {ico}")
            await page.click("label[for='how-filtered-ico']", timeout=10000)
            await page.fill("input#filter_ico", ico, timeout=10000)
            logger.info(f"[{self.source_type}] Odosielam formulár.")
            
            # Riešenie Altcha Anti-Bot ochrany (proof-of-work)
            altcha_ok = await self._solve_altcha(page)
            if not altcha_ok:
                return self._make_result(
                    status="UNAVAILABLE",
                    status_message="ZRSR: Altcha anti-bot ochranu sa nepodarilo vyriešiť.",
                )

            async with page.expect_navigation(timeout=30000):
                await page.click("input[name='cmdPotvrdit']", timeout=10000)
        except PlaywrightTimeoutError:
            raise ScraperUnavailableError("Timeout pri odosielaní formulára ZRSR.")
        except Exception as e:
            logger.error(f"[{self.source_type}] Chyba odoslania formulára: {e}")
            return self._make_result(
                status="FAILED",
                status_message=f"Chyba pri odoslaní formulára ZRSR (firma): {e}",
            )
        logger.debug(f"[{self.source_type}] ⏱ formulár + altcha + submit: {time.perf_counter() - _t:.2f}s")

        return await self._process_zrsr_results(page, f"ico_{ico}", output_dir)

    async def _search_person(
        self,
        page: Page,
        *,
        name: Optional[str],
        surname: Optional[str],
        birth_date: Optional[str],
        output_dir: Path,
    ) -> ScrapedSource:
        if not name or not surname:
            return self._make_result(
                status="FAILED",
                status_message="Meno a priezvisko sú povinné pre vyhľadávanie osoby v ZRSR.",
            )

        logger.info(f"[{self.source_type}] Navigujem na {self._base_url_person}")
        try:
            await page.goto(self._base_url_person, timeout=45000, wait_until="domcontentloaded")
        except PlaywrightTimeoutError:
            raise ScraperUnavailableError("Timeout pri načítaní stránky ZRSR.")

        try:
            logger.info(f"[{self.source_type}] Vypĺňam Meno: {name}, Priezvisko: {surname}")
            await page.click("label[for='how-filtered-fo']", timeout=10000)
            await page.fill("input#filter_fo_meno", name, timeout=10000)
            await page.fill("input#filter_fo_priezvisko", surname, timeout=10000)
            
            # Riešenie Altcha Anti-Bot ochrany (proof-of-work)
            altcha_ok = await self._solve_altcha(page)
            if not altcha_ok:
                return self._make_result(
                    status="UNAVAILABLE",
                    status_message="ZRSR: Altcha anti-bot ochranu sa nepodarilo vyriešiť.",
                )

            submit_btn = page.locator("input[name='cmdPotvrdit']")
            async with page.expect_navigation(timeout=30000):
                await submit_btn.click(timeout=10000)
        except PlaywrightTimeoutError:
            raise ScraperUnavailableError("Timeout pri odosielaní formulára ZRSR.")
        except Exception as e:
            logger.error(f"[{self.source_type}] Chyba odoslania formulára: {e}")
            return self._make_result(
                status="FAILED",
                status_message=f"Chyba pri odoslaní formulára ZRSR (osoba): {e}",
            )

        safe_label = f"{surname.lower()}_{name.lower()}".replace(" ", "_")
        return await self._process_zrsr_results(page, safe_label, output_dir)

    async def _process_zrsr_results(self, page: Page, label: str, output_dir: Path) -> ScrapedSource:
        logger.info(f"[{self.source_type}] Spracovávam výsledky vyhľadávania.")
        _t = time.perf_counter()
        
        text_content = await page.inner_text("body")
        if "Neboli nájdené žiadne záznamy" in text_content or "Nenašiel sa žiadny" in text_content:
            logger.info(f"[{self.source_type}] Záznam nenájdený.")
            return self._make_result(
                status="SUCCESS",
                file_path=None,
                status_message="Záznam sa nenachádza v ZRSR.",
                findings="Žiadny záznam v Živnostenskom registri SR.",
            )

        # Pokus o klik na detail — s retry na 'Odkaz je neplatný'
        max_detail_retries = 2
        for detail_attempt in range(max_detail_retries):
            try:
                # Počkáme, kým sa zjaví link na detail
                try:
                    await page.wait_for_selector("a.govuk-link[href*='Detail'], a.govuk-link[href*='detail']", timeout=10000)
                except PlaywrightTimeoutError:
                    pass
                
                detail_link = page.locator("a.govuk-link[href*='Detail'], a.govuk-link[href*='detail']").first
                if await detail_link.count() > 0:
                    logger.info(f"[{self.source_type}] Klikám na detail (attempt {detail_attempt+1}/{max_detail_retries}).")
                    async with page.expect_navigation(timeout=30000):
                        await detail_link.click(timeout=10000)

                    # Verifikácia, že sme na správnej stránke
                    try:
                        await page.wait_for_selector("text=Výpis zo živnostenského registra", timeout=10000)
                        logger.info(f"[{self.source_type}] Detail úspešne overený.")
                        break
                    except PlaywrightTimeoutError:
                        html = await page.content()
                        if "Odkaz je neplatný" in html:
                            logger.warning(f"[{self.source_type}] 'Odkaz je neplatný' (attempt {detail_attempt+1}/{max_detail_retries}).")
                            if detail_attempt < max_detail_retries - 1:
                                logger.info(f"[{self.source_type}] Retry: vrátim sa na výsledky a skúsim znova.")
                                await page.go_back(timeout=15000)
                                await page.wait_for_load_state("domcontentloaded", timeout=15000)
                                await page.wait_for_timeout(1500)
                                continue
                            else:
                                logger.error(f"[{self.source_type}] 'Odkaz je neplatný' aj po {max_detail_retries} pokusoch.")
                                return self._make_result(
                                    status="UNAVAILABLE",
                                    status_message="ZRSR portál vrátil 'Odkaz je neplatný' — výpis nie je dostupný.",
                                )
                        else:
                            logger.warning(f"[{self.source_type}] Nenašiel sa text 'Výpis zo živnostenského registra'.")
                            return self._make_result(
                                status="UNAVAILABLE",
                                status_message="ZRSR detail stránka sa nenačítala správne — možno maintenance alebo zmena layoutu.",
                            )
                else:
                    logger.info(f"[{self.source_type}] Detail link nenájdený, generujem PDF z aktuálneho pohľadu.")
                    break
            except Exception as e:
                logger.warning(f"[{self.source_type}] Chyba pri klikaní na detail (attempt {detail_attempt+1}): {e}")
                if detail_attempt < max_detail_retries - 1:
                    await page.wait_for_timeout(2000)
                    continue
                break

        logger.debug(f"[{self.source_type}] ⏱ detail + spracovanie: {time.perf_counter() - _t:.2f}s")
        _t = time.perf_counter()

        logger.info(f"[{self.source_type}] Generujem PDF.")
        pdf_output = output_dir / f"zrsr_{label}.pdf"
        
        try:
            pdf_ok = await self._print_page_to_pdf(page, pdf_output)
            if pdf_ok == 0:
                logger.error(f"[{self.source_type}] PDF validácia zlyhala — stránka nebola načítaná.")
                return self._make_result(
                    status="FAILED",
                    status_message="ZRSR PDF je prázdne alebo neúplné — stránka sa nepodarila načítať.",
                )
            logger.debug(f"[{self.source_type}] ⏱ print_pdf: {time.perf_counter() - _t:.2f}s")
            logger.info(f"[{self.source_type}] PDF úspešne vygenerované na {pdf_output}")
        except Exception as e:
            logger.error(f"[{self.source_type}] Zlyhalo generovanie PDF: {e}")
            return self._make_result(
                status="FAILED",
                status_message=f"Chyba pri generovaní PDF z ZRSR: {e}",
            )

        findings = await self._extract_findings(page)

        return self._make_result(
            status="SUCCESS",
            file_path=str(pdf_output),
            page_count=1,
            status_message="Výpis z ZRSR stiahnutý.",
            findings=findings,
        )

    async def _solve_altcha(self, page: Page) -> bool:
        """Pokúsi sa vyriešiť Altcha proof-of-work challenge.
        Altcha je web component so shadow DOM — treba kliknúť na vnútorný checkbox
        alebo na label 'Nie som robot'.
        Vráti True ak sa podarilo, False ak nie."""
        for attempt in range(3):
            try:
                widget = page.locator("altcha-widget")
                if await widget.count() == 0:
                    logger.warning(f"[{self.source_type}] Altcha widget sa nenašiel (pokus {attempt+1}/3).")
                    if attempt < 2:
                        await page.wait_for_timeout(2000)
                    continue

                # Skús 1: Klik na label 'Nie som robot' (najspoľahlivejšie)
                try:
                    label = page.locator("label[for^='altcha_checkbox']")
                    if await label.count() > 0:
                        logger.info(f"[{self.source_type}] Klikám na 'Nie som robot' label (attempt {attempt+1}/3).")
                        await label.click(timeout=5000)
                    else:
                        raise Exception("No label found")
                except Exception:
                    # Skús 2: Klik na checkbox (light DOM alebo shadow DOM)
                    try:
                        checkbox = page.locator("altcha-widget input[type='checkbox'], altcha-widget >> shadow >> input[type='checkbox']")
                        if await checkbox.count() > 0:
                            logger.info(f"[{self.source_type}] Klikám na Altcha checkbox (attempt {attempt+1}/3).")
                            await checkbox.click(timeout=5000)
                        else:
                            raise Exception("No checkbox in shadow DOM")
                    except Exception:
                        # Skús 3: Klik na samotný widget element
                        logger.info(f"[{self.source_type}] Klikám na Altcha widget element (attempt {attempt+1}/3).")
                        await widget.click(timeout=5000)

                # Počkaj na proof-of-work — Altcha počíta hash, môže trvať
                logger.info(f"[{self.source_type}] Čakám na Altcha proof-of-work...")
                await page.wait_for_function(
                    'document.querySelector("input[name=\\"altcha\\"]") && document.querySelector("input[name=\\"altcha\\"]").value !== ""',
                    timeout=15000
                )
                logger.info(f"[{self.source_type}] Altcha úspešne vyriešená!")
                return True

            except Exception as e:
                logger.warning(f"[{self.source_type}] Altcha attempt {attempt+1}/3 zlyhal: {e}")
                if attempt < 2:
                    await page.wait_for_timeout(2000)

        logger.error(f"[{self.source_type}] Altcha sa nepodarila vyriešiť po 3 pokusoch.")
        return False

    async def _extract_findings(self, page: Page) -> Optional[str]:
        try:
            text_content = await page.inner_text("body")
            if "pozastaven" in text_content.lower():
                return "POZOR: Živnosť je pozastavená."
            if "zaniknut" in text_content.lower() or "zánik" in text_content.lower():
                return "POZOR: Živnosť je zaniknutá."
            return "Aktívny záznam v ZRSR."
        except Exception as e:
            logger.warning(f"[{self.source_type}] Nepodarilo sa extrahovať nálezy: {e}")
            return "Záznam v ZRSR nájdený."
