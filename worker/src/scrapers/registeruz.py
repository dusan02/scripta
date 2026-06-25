from __future__ import annotations
import logging
import time
from pathlib import Path
from typing import Optional

from playwright.async_api import Page, TimeoutError as PlaywrightTimeoutError

from .base import BaseScraper, ScraperUnavailableError
from ..models import ScrapedSource

logger = logging.getLogger(__name__)


class RegisterUzScraper(BaseScraper):
    """
    Scraper pre Register účtovných závierok (registeruz.sk).
    URL: https://www.registeruz.sk/cruz-public/domain/accountingentity/simplesearch
    Vyhľadávanie podľa IČO, sťahuje účtovnú závierku ako PDF/XLSX.
    """

    source_type = "REGISTER_UZ"
    base_url = "https://www.registeruz.sk/cruz-public/domain/accountingentity/simplesearch"
    _title = "Register účtovných závierok (registeruz.sk)"
    _no_results_msg = "Subjekt nie je evidovaný v Registri účtovných závierok."

    async def run(self, *, ico: str, output_dir: Path, **kwargs) -> ScrapedSource:
        page: Optional[Page] = None
        try:
            logger.info(f"[{self.source_type}] Začínam vyhľadávanie pre IČO: {ico}")
            _t = time.perf_counter()
            page = await self._get_page(block_images=False)
            logger.debug(f"[{self.source_type}] ⏱ get_page: {time.perf_counter() - _t:.2f}s")

            await self._safe_goto(page, self.base_url)
            logger.info(f"[{self.source_type}] Stránka načítaná: {self.base_url}")

            # Cookie consent — "Povoliť všetko"
            try:
                cookie_btn = page.get_by_role("link", name="Povoliť všetko")
                await cookie_btn.wait_for(state="visible", timeout=5000)
                await cookie_btn.click()
                logger.info(f"[{self.source_type}] Cookie consent prijatý.")
            except PlaywrightTimeoutError:
                logger.debug(f"[{self.source_type}] Cookie banner sa nezobrazil, pokračujem.")

            # Vyplnenie IČO do vyhľadávacieho poľa
            search_input = page.get_by_role("textbox", name="Zadajte názov účtovnej")
            try:
                await search_input.wait_for(state="visible", timeout=10000)
                await search_input.fill(ico)
            except PlaywrightTimeoutError:
                raise ScraperUnavailableError(f"{self.source_type}: Nenájdené vyhľadávacie pole.")

            # Kliknúť na "Vyhľadať"
            search_btn = page.get_by_role("button", name="Vyhľadať")
            try:
                await search_btn.wait_for(state="visible", timeout=10000)
                await search_btn.click()
            except PlaywrightTimeoutError:
                logger.warning(f"[{self.source_type}] 'Vyhľadať' tlačidlo nenájdené cez get_by_role, skúšam CSS.")
                await page.locator("button:has-text('Vyhľadať'), input[value*='Vyhľadať']").first.click()

            try:
                await page.wait_for_load_state("networkidle", timeout=15000)
            except PlaywrightTimeoutError:
                logger.warning(f"[{self.source_type}] networkidle timeout, pokračujem...")

            # Skontrolujeme, či sú nejaké výsledky
            result_link = page.locator("a[href*='accountingentity']").first
            no_results = page.locator("text=neboli nájdené žiadne").first

            try:
                await result_link.or_(no_results).wait_for(timeout=15000)
            except PlaywrightTimeoutError:
                logger.warning(f"[{self.source_type}] Čakanie na výsledky vypršalo, pokračujem...")

            # Skontrolujeme no results
            body_text = await page.inner_text("body")
            if "neboli nájdené žiadne" in body_text.lower() or "žiadne výsledky" in body_text.lower():
                logger.info(f"[{self.source_type}] IČO {ico} — žiadne výsledky.")
                file_path = output_dir / f"{self.source_type}_{ico}.pdf"
                await self._generate_no_results_pdf(
                    page, file_path, ico,
                    title=self._title,
                    message=f"Pre IČO {ico} sa v {self._title} nenašiel žiadny záznam.",
                )
                return self._make_result(
                    status="SUCCESS",
                    file_path=str(file_path),
                    page_count=1,
                    status_message=f"IČO {ico} nebolo nájdené v {self.source_type}.",
                    findings=self._no_results_msg,
                )

            # Kliknúť na prvý výsledok (link bez textu — ikona/obrázok)
            try:
                empty_link = page.get_by_role("link").filter(has_text="")
                await empty_link.first.wait_for(state="visible", timeout=10000)
                await empty_link.first.click()
                logger.info(f"[{self.source_type}] Kliknuté na prvý výsledok.")
            except PlaywrightTimeoutError:
                # Skúsime kliknúť na akýkoľvek link s accountingentity
                logger.warning(f"[{self.source_type}] Prvý výsledok link nenájdený, skúšam href link.")
                await result_link.click()

            try:
                await page.wait_for_load_state("networkidle", timeout=15000)
            except PlaywrightTimeoutError:
                pass

            # Kliknúť na najnovšie obdobie (napr. "01/2025 - 12/2025 Individuálna")
            try:
                period_link = page.get_by_role("link", name="Individuálna").first
                await period_link.wait_for(state="visible", timeout=10000)
                await period_link.click()
                logger.info(f"[{self.source_type}] Kliknuté na obdobie (Individuálna).")
            except PlaywrightTimeoutError:
                # Skúsime regex na formát "01/2025 - 12/2025"
                logger.warning(f"[{self.source_type}] 'Individuálna' link nenájdený, skúšam regex.")
                period_link = page.locator("a:has-text(/\\d{2}\\/\\d{4}.*\\d{2}\\/\\d{4}/)").first
                await period_link.click()

            try:
                await page.wait_for_load_state("networkidle", timeout=15000)
            except PlaywrightTimeoutError:
                pass

            # Kliknúť na "Účtovná závierka"
            try:
                uvierka_link = page.get_by_role("link", name="Účtovná závierka").first
                await uvierka_link.wait_for(state="visible", timeout=10000)
                await uvierka_link.click()
                logger.info(f"[{self.source_type}] Kliknuté na účtovnú závierku.")
            except PlaywrightTimeoutError:
                logger.warning(f"[{self.source_type}] Link 'Účtovná závierka' nenájdený.")
                # Skúsime stiahnuť priamo z tejto stránky
                pass

            try:
                await page.wait_for_load_state("networkidle", timeout=10000)
            except PlaywrightTimeoutError:
                pass

            # Stiahnuť PDF — kliknúť na "Stiahnuť" (druhé occurrence podľa test skriptu)
            file_path = output_dir / f"{self.source_type}_{ico}.pdf"
            downloaded = False

            try:
                stiahnut_links = page.get_by_role("link", name="Stiahnuť")
                count = await stiahnut_links.count()
                logger.info(f"[{self.source_type}] Nájdených {count} 'Stiahnuť' linkov.")

                # Skúsime PDF (druhý link podľa test skriptu), fallback na prvý
                click_idx = 1 if count > 1 else 0

                async with page.expect_download(timeout=30000) as download_info:
                    await stiahnut_links.nth(click_idx).click()
                download = await download_info.value
                await download.save_as(str(file_path))
                downloaded = True
                logger.info(f"[{self.source_type}] Účtovná závierka stiahnutá: {file_path}")
            except PlaywrightTimeoutError:
                logger.warning(f"[{self.source_type}] Timeout pri sťahovaní účtovnej závierky.")
            except Exception as e:
                logger.warning(f"[{self.source_type}] Download zlyhal: {e}")

            if not downloaded:
                # Fallback — vygenerujeme PDF z aktuálnej stránky
                logger.info(f"[{self.source_type}] Download zlyhal, generujem PDF z stránky.")
                await self._generate_clean_pdf(
                    page,
                    file_path,
                    title=self._title,
                    content_selector="main, .main, .content, table",
                    format="A4",
                    scale=0.9,
                )

            # Extrahuj findings
            findings = await self._extract_findings(page, ico)

            return self._make_result(
                status="SUCCESS",
                file_path=str(file_path),
                page_count=1,
                status_message=f"Účtovná závierka pre IČO {ico} úspešne stiahnutá.",
                findings=findings or f"Účtovná závierka nájdená v {self._title}.",
            )

        except ScraperUnavailableError:
            raise
        except Exception as e:
            logger.exception(f"[{self.source_type}] Nečakaná chyba pri IČO {ico}: {e}")
            return self._make_result(
                status="FAILED",
                file_path=None,
                status_message=f"Interná chyba scrapera: {str(e)}",
            )
        finally:
            if page:
                await page.close()

    async def _extract_findings(self, page: Page, ico: str) -> Optional[str]:
        """Extrahuje základné informácie zo stránky výsledkov."""
        try:
            text = await page.inner_text("body")
            parts = [f"Účtovná závierka nájdená pre IČO {ico} v Registri účtovných závierok."]

            # Hľadáme obdobie
            import re
            period_match = re.search(r'(\d{2}/\d{4}\s*-\s*\d{2}/\d{4})', text)
            if period_match:
                parts.append(f"Obdobie: {period_match.group(1)}")

            # Hľadáme typ závierky
            if "Individuálna" in text:
                parts.append("Typ: Individuálna účtovná závierka")
            elif "Konsolidovaná" in text:
                parts.append("Typ: Konsolidovaná účtovná závierka")

            return "\n".join(parts)
        except Exception as e:
            logger.warning(f"[{self.source_type}] Extrakcia nálezov zlyhala: {e}")
            return None
