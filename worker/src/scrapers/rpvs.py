from __future__ import annotations
import asyncio
import logging
import time
from pathlib import Path
from typing import Optional

from playwright.async_api import Page, TimeoutError as PlaywrightTimeoutError

from .base import BaseScraper, ScraperUnavailableError
from ..models import ScrapedSource

logger = logging.getLogger(__name__)

class RpvsScraper(BaseScraper):
    """
    Scraper pre Register partnerov verejného sektora (RPVS).
    Používa Rozšírené vyhľadávanie -> zadá IČO -> nastaví filter Stav=Platný ->
    Hľadať -> klikne na názov firmy v 4. stĺpci ->
    overí "Aktuálne údaje" a IČO na detailnej stránke.
    """

    source_type = "RPVS"
    base_url = "https://rpvs.gov.sk/rpvs"

    async def run(self, *, ico: str, output_dir: Path, **kwargs) -> ScrapedSource:
        page: Optional[Page] = None
        try:
            logger.info(f"[{self.source_type}] Začínam vyhľadávanie pre IČO: {ico}")
            _t = time.perf_counter()
            page = await self._get_page(block_images=False, locale="sk-SK")
            logger.debug(f"[{self.source_type}] ⏱ get_page: {time.perf_counter() - _t:.2f}s")
            _t = time.perf_counter()

            # 1. Načítaj stránku Rozšíreného vyhľadávania priamo
            advanced_url = "https://rpvs.gov.sk/rpvs/Partner/Partner/VyhladavaniePartnera"
            logger.info(f"[{self.source_type}] Navigujem na {advanced_url}")
            await self._safe_goto(page, advanced_url)
            try:
                await page.wait_for_load_state("domcontentloaded", timeout=15000)
            except PlaywrightTimeoutError:
                pass

            await self._dismiss_cookie_banner(page)

            logger.debug(f"[{self.source_type}] ⏱ goto + rozš. vyhľadávanie: {time.perf_counter() - _t:.2f}s")
            _t = time.perf_counter()

            # 3. Zadaj IČO do #Filter_Ico
            ico_input = page.locator("#Filter_Ico")
            try:
                await ico_input.wait_for(state="visible", timeout=10000)
                await ico_input.fill(ico)
                logger.info(f"[{self.source_type}] Zadané IČO {ico} do poľa #Filter_Ico")
            except PlaywrightTimeoutError:
                logger.error(f"[{self.source_type}] Nenájdené pole IČO (#Filter_Ico).")
                raise ScraperUnavailableError("RPVS: Nenájdené pole IČO.")

            # 4. Nastav filter Stav = Platný (Select2 dropdown)
            try:
                # Otvor Select2 dropdown pre Stav
                status_select2 = page.locator("#Filter_Stav + .select2 .select2-selection, #Filter_Stav ~ .select2 .select2-selection, .select2-selection[aria-labelledby^='select2-Filter_Stav']").first
                if await status_select2.count() > 0:
                    await status_select2.click()
                    logger.info(f"[{self.source_type}] Otvorený Select2 dropdown Stav")
                    # Počkaj na výsledky a klikni na možnosť "Platný"
                    platny_option = page.locator(".select2-results__option:has-text('Platný'), .select2-results__option:has-text('Platny')").first
                    await platny_option.wait_for(state="visible", timeout=5000)
                    await platny_option.click()
                    logger.info(f"[{self.source_type}] Nastavený filter Stav = Platný")
                else:
                    logger.warning(f"[{self.source_type}] Stav Select2 nenájdený, pokračujem bez filtra.")
            except Exception as e:
                logger.warning(f"[{self.source_type}] Nepodarilo sa nastaviť filter Stav ({e}), pokračujem bez filtra.")

            # 5. Klikni "Hľadať" — tlačidlo vo forme #filter
            search_btn = page.locator("form[id='filter'] button[type='submit']")
            try:
                await search_btn.wait_for(state="visible", timeout=10000)
                await search_btn.click()
            except PlaywrightTimeoutError:
                logger.warning(f"[{self.source_type}] Tlačidlo 'Hľadať' nenájdené, skúšam fallback.")
                search_btn = page.get_by_role("button", name="Hľadať")
                await search_btn.click()

            # 6. Počkaj na výsledky tabuľky (konkrétna tabuľka s id table-VyhladavaniePartnera)
            try:
                await page.wait_for_function(
                    """(ico) => {
                        const text = document.body.innerText;
                        const table = document.querySelector('#table-VyhladavaniePartnera');
                        if (!table) return false;
                        const rows = Array.from(table.querySelectorAll('tbody tr'));
                        const cleanTarget = ico.replace(/\\D/g, '');
                        const hasIco = rows.some(tr =>
                            Array.from(tr.querySelectorAll('td')).some(td =>
                                td.innerText.replace(/\\D/g, '').includes(cleanTarget)
                            )
                        );
                        const hasNoResults = text.includes('Nenašli sa žiadne')
                            || text.includes('0 celkom 0')
                            || text.includes('0 až 0');
                        return hasIco || hasNoResults;
                    }""",
                    arg=ico,
                    timeout=15000
                )
                logger.info(f"[{self.source_type}] Výsledky vyhľadávania načítané.")
            except Exception as e:
                logger.warning(f"[{self.source_type}] Čakanie na výsledky vypršalo ({e}), pokračujem...")

            logger.debug(f"[{self.source_type}] ⏱ fill + filter + search + výsledky: {time.perf_counter() - _t:.2f}s")
            _t = time.perf_counter()

            # 7. Skontroluj prázdne výsledky
            empty_cell = page.locator(".dataTables_empty")
            if await empty_cell.count() > 0:
                logger.info(f"[{self.source_type}] IČO {ico} nebolo nájdené v RPVS (dataTables_empty).")
                return self._make_result(
                    status="SUCCESS",
                    file_path=None,
                    status_message=f"IČO {ico} nebolo nájdené v RPVS.",
                    findings="Subjekt nie je evidovaný ako partner verejného sektora.",
                )
            body_text = await page.inner_text("body")
            if "Nenašli sa žiadne" in body_text or "0 až 0" in body_text or "0 celkom 0" in body_text:
                logger.info(f"[{self.source_type}] IČO {ico} nebolo nájdené v RPVS (text).")
                return self._make_result(
                    status="SUCCESS",
                    file_path=None,
                    status_message=f"IČO {ico} nebolo nájdené v RPVS.",
                    findings="Subjekt nie je evidovaný ako partner verejného sektora.",
                )

            # 8. Nájdi platný záznam a klikni na názov partnera v 2. stĺpci
            company_name = None
            detail_loaded = False

            result_table = page.locator("#table-VyhladavaniePartnera")
            rows = result_table.locator("tbody tr")
            row_count = await rows.count()
            logger.info(f"[{self.source_type}] Počet riadkov vo výsledkovej tabuľke: {row_count}")

            for i in range(row_count):
                row = rows.nth(i)
                try:
                    status_text = await row.locator("td:nth-child(7)").inner_text()
                    if "Platný" in status_text.strip():
                        link = row.locator("td:nth-child(2) a").first
                        if await link.count() > 0:
                            company_name = (await link.inner_text()).strip()
                            logger.info(f"[{self.source_type}] Klikám na platný záznam: {company_name} (riadok {i+1})")
                            await link.click()
                            detail_loaded = True
                            break
                except Exception:
                    continue

            # Fallback: ak sa nenašiel "Platný" riadok, klikni na prvý odkaz v 2. stĺpci
            if not detail_loaded:
                logger.warning(f"[{self.source_type}] Nenájdený riadok so statusom 'Platný', skúšam prvý odkaz.")
                first_link = result_table.locator("tbody tr td:nth-child(2) a").first
                try:
                    await first_link.wait_for(state="visible", timeout=10000)
                    company_name = (await first_link.inner_text()).strip()
                    logger.info(f"[{self.source_type}] Klikám na prvý záznam: {company_name}")
                    await first_link.click()
                except PlaywrightTimeoutError:
                    logger.warning(f"[{self.source_type}] Prvý odkaz nenájdený, skúšam fallback odd/even.")
                    company_link = result_table.locator("tbody tr.odd td:nth-child(2) a, tbody tr.even td:nth-child(2) a").first
                    await company_link.wait_for(state="visible", timeout=10000)
                    company_name = (await company_link.inner_text()).strip()
                    await company_link.click()

            # 9. Počkaj na načítanie detailnej stránky
            try:
                await page.wait_for_load_state("domcontentloaded", timeout=15000)
            except PlaywrightTimeoutError:
                pass

            # 10. Overenie detailnej stránky
            try:
                heading_partner = page.get_by_role("heading", name="Partner verejného sektora")
                await heading_partner.wait_for(state="visible", timeout=10000)
                await page.wait_for_selector("text=Aktuálne údaje", timeout=10000)
                logger.info(f"[{self.source_type}] Stránka detailu overená ('Partner verejného sektora' + 'Aktuálne údaje').")
            except PlaywrightTimeoutError:
                logger.warning(f"[{self.source_type}] Nadpisy na detailnej stránke sa nenašli, overujem IČO v texte.")

            # Overenie IČO na stránke
            try:
                detail_text = (await page.inner_text("body")).replace(" ", "").replace("\xa0", "")
                clean_ico = ico.replace(" ", "").replace("\xa0", "")
                if clean_ico not in detail_text:
                    logger.warning(f"[{self.source_type}] IČO {ico} sa nenašlo v texte detailnej stránky.")
                else:
                    logger.info(f"[{self.source_type}] IČO {ico} overené na detailnej stránke.")
            except Exception as e:
                logger.warning(f"[{self.source_type}] Nepodarilo sa overiť IČO: {e}")

            # 9. Stiahnutie PDF — skús "Verifikačný dokument (pdf)" alebo "Stiahnuť výpis"
            file_path = output_dir / f"{self.source_type}_{ico}.pdf"
            logger.info(f"[{self.source_type}] Sťahujem PDF výpis pre IČO {ico}")

            try:
                # Priorita 1: "Verifikačný dokument (pdf)" — odkaz na detailnej stránke
                verify_link = page.locator("a:has-text('Verifikačný dokument')").first
                if await verify_link.count() > 0:
                    logger.info(f"[{self.source_type}] Klikám na 'Verifikačný dokument (pdf)'")
                    dl_result = await self._download_pdf(page, "a:has-text('Verifikačný dokument')", file_path)
                    if dl_result > 0:
                        logger.info(f"[{self.source_type}] PDF úspešne stiahnuté do {file_path}")
                    else:
                        raise Exception("Download prebehol, ale súbor je prázdny (0 bytes)")
                else:
                    raise Exception("Odkaz 'Verifikačný dokument' sa nenašiel")
            except Exception as e:
                logger.warning(f"[{self.source_type}] Stiahnutie PDF zlyhalo ({e}). Robím fallback na tlač stránky.")
                await page.emulate_media(media="screen")
                try:
                    await page.add_style_tag(content="body, body * { color: #000000 !important; background-color: #ffffff !important; background-image: none !important; }")
                except Exception as style_err:
                    logger.warning(f"[{self.source_type}] Nepodarilo sa injektovať štýly pre tlač: {style_err}")
                await self._print_page_to_pdf(page, file_path)

            logger.debug(f"[{self.source_type}] ⏱ detail + PDF: {time.perf_counter() - _t:.2f}s")

            findings = await self._extract_findings(page)

            return self._make_result(
                status="SUCCESS",
                file_path=str(file_path),
                page_count=1,
                status_message="Výpis z RPVS úspešne vygenerovaný.",
                findings=findings,
                company_name=company_name,
            )

        except ScraperUnavailableError as e:
            logger.error(f"[{self.source_type}] Scraper unavailable: {e}")
            return self._make_result(
                status="UNAVAILABLE",
                file_path=None,
                status_message=str(e),
            )
        except Exception as e:
            logger.exception(f"[{self.source_type}] Nečakaná chyba pri IČO {ico}: {e}")
            return self._make_result(
                status="FAILED",
                file_path=None,
                status_message=f"Interná chyba scrapera: {str(e)}",
            )
        finally:
            if page:
                try:
                    await page.close()
                except Exception:
                    pass

    async def _extract_findings(self, page: Page) -> Optional[str]:
        try:
            text_content = (await page.inner_text("body")).lower()
            if "dátum výmazu" in text_content and "nie je" not in text_content:
                return "POZOR: Partner má evidovaný dátum výmazu z RPVS."
            return "Subjekt je evidovaný ako partner verejného sektora (Koneční užívatelia výhod uvedení vo výpise)."
        except Exception as e:
            logger.warning(f"[{self.source_type}] Nepodarilo sa extrahovať nálezy: {e}")
            return "Subjekt bol nájdený v Registri partnerov verejného sektora."
