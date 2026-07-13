from __future__ import annotations

import logging
import re
import time
from datetime import date, timedelta
from pathlib import Path
from typing import Optional

from playwright.async_api import Page, TimeoutError as PlaywrightTimeoutError, Error as PlaywrightError

from .base import BaseScraper, ScraperUnavailableError
from ..models import ScrapedSource

logger = logging.getLogger(__name__)


class CrzScraper(BaseScraper):
    """
    Scraper pre Centrálny register zmlúv (crz.gov.sk).
    Vyhľadáva podľa IČO dodávateľa s dátumom "od" (default 1 rok dozadu, alebo user setting).
    Podporuje pagination — scrapne všetky strany a spojí ich do jedného PDF.
    """

    source_type = "CRZ"
    base_url = "https://www.crz.gov.sk/"

    async def run(self, *, ico: str, output_dir: Path, crz_date_from: Optional[str] = None, **kwargs) -> ScrapedSource:
        page: Optional[Page] = None
        try:
            logger.info(f"[{self.source_type}] Začínam vyhľadávanie pre IČO: {ico}")
            _t = time.perf_counter()
            page = await self._get_page(block_images=False)

            await self._navigate(page)
            await self._accept_cookies(page)
            await self._open_advanced_search(page)
            await self._fill_ico(page, ico)

            date_from_str = self._resolve_date_from(crz_date_from)
            await self._set_date_from(page, date_from_str)
            await self._click_search(page)
            await self._wait_for_results(page)

            if await self._check_no_results(page):
                return await self._make_no_results_result(page, ico, output_dir, date_from_str)

            all_rows_html, pages_collected = await self._collect_all_rows(page)

            if all_rows_html:
                await page.evaluate(
                    "(rowsHtml) => { const tbody = document.querySelector('table tbody'); if (tbody) tbody.innerHTML = rowsHtml.join(''); }",
                    all_rows_html,
                )

            pdf_output = output_dir / f"crz_{ico}.pdf"
            try:
                await self._generate_clean_pdf(
                    page, pdf_output,
                    title=f"Centrálny register zmlúv — IČO {ico}",
                    content_selector="table",
                    format="A4",
                    scale=0.85,
                )
                logger.info(f"[{self.source_type}] PDF vygenerované: {pdf_output}")
            except Exception as e:
                logger.error(f"[{self.source_type}] Zlyhalo generovanie PDF: {e}")
                return self._make_result(status="FAILED", status_message=f"Chyba pri generovaní PDF z CRZ: {e}")

            findings = await self._extract_findings(page, ico, pages_collected, len(all_rows_html))
            logger.info(f"[{self.source_type}] Hotovo za {time.perf_counter() - _t:.1f}s — {pages_collected} strán, {len(all_rows_html)} zmlúv")

            return self._make_result(
                status="SUCCESS",
                file_path=str(pdf_output),
                page_count=1,
                status_message=f"Výpis z CRZ úspešne vygenerovaný ({pages_collected} strán, {len(all_rows_html)} zmlúv).",
                findings=findings,
            )

        except ScraperUnavailableError:
            raise
        except Exception as e:
            logger.exception(f"[{self.source_type}] Nečakaná chyba pri IČO {ico}: {e}")
            return self._make_result(status="FAILED", file_path=None, status_message=f"Interná chyba scrapera: {str(e)}")
        finally:
            if page:
                try:
                    await page.close()
                except Exception:
                    pass

    # ── Step methods ────────────────────────────────────────────────

    async def _navigate(self, page: Page) -> None:
        logger.info(f"[{self.source_type}] Navigujem na {self.base_url}")
        try:
            await page.goto(self.base_url, timeout=30000, wait_until="domcontentloaded")
        except (PlaywrightTimeoutError, PlaywrightError) as e:
            raise ScraperUnavailableError(f"CRZ nedostupná: {e}")

    async def _accept_cookies(self, page: Page) -> None:
        try:
            btn = page.get_by_role("button", name="Prijať všetko")
            await btn.wait_for(timeout=5000)
            await btn.click()
            logger.info(f"[{self.source_type}] Cookie banner prijatý.")
        except PlaywrightTimeoutError:
            logger.info(f"[{self.source_type}] Cookie banner sa nezobrazil.")

    async def _open_advanced_search(self, page: Page) -> None:
        try:
            adv_btn = page.get_by_role("button", name="Rozšírené vyhľadávanie")
            await adv_btn.wait_for(timeout=10000)
            await adv_btn.click()
            logger.info(f"[{self.source_type}] Rozšírené vyhľadávanie otvorené.")
        except PlaywrightTimeoutError:
            raise ScraperUnavailableError("Nepodarilo sa otvoriť rozšírené vyhľadávanie na CRZ.")

    async def _fill_ico(self, page: Page, ico: str) -> None:
        try:
            ico_input = page.get_by_role("textbox", name="IČO dodávateľa:")
            await ico_input.wait_for(timeout=10000)
            await ico_input.click()
            await ico_input.fill(ico)
            logger.info(f"[{self.source_type}] IČO vyplnené: {ico}")
        except PlaywrightTimeoutError:
            raise ScraperUnavailableError("Nepodarilo sa nájsť pole IČO dodávateľa na CRZ.")

    @staticmethod
    def _resolve_date_from(crz_date_from: Optional[str]) -> str:
        if crz_date_from:
            try:
                date_from = date.fromisoformat(crz_date_from)
            except ValueError:
                logger.warning(f"[CRZ] Neplatný crz_date_from '{crz_date_from}', používam default 1 rok.")
                date_from = date.today() - timedelta(days=365)
        else:
            date_from = date.today() - timedelta(days=365)
        return date_from.strftime("%d.%m.%Y")

    async def _set_date_from(self, page: Page, date_from_str: str) -> None:
        logger.info(f"[{self.source_type}] Dátum od: {date_from_str}")
        try:
            date_input = page.locator("#frm_filter_3_art_datum_zverejnene_od")
            await date_input.wait_for(timeout=10000)
            await page.evaluate(
                "(dateStr) => {"
                "  const el = document.getElementById('frm_filter_3_art_datum_zverejnene_od');"
                "  if (!el) return;"
                "  if (window.jQuery && $(el).datepicker) { $(el).datepicker('update', dateStr); } else { el.value = dateStr; }"
                "  el.dispatchEvent(new Event('change', { bubbles: true }));"
                "}",
                date_from_str,
            )
            actual = await date_input.input_value()
            logger.info(f"[{self.source_type}] Dátum od nastavený: {actual}")
        except PlaywrightTimeoutError:
            raise ScraperUnavailableError("Nepodarilo sa vyplniť dátum 'od' na CRZ.")

    async def _click_search(self, page: Page) -> None:
        try:
            search_btn = page.get_by_role("button", name="Vyhľadať")
            await search_btn.wait_for(timeout=10000)
            await search_btn.click()
            logger.info(f"[{self.source_type}] Vyhľadávanie odoslané.")
        except PlaywrightTimeoutError:
            raise ScraperUnavailableError("Nepodarilo sa nájsť tlačidlo Vyhľadať na CRZ.")

    async def _wait_for_results(self, page: Page) -> None:
        try:
            await page.wait_for_function(
                """() => {
                    if (!document.body) return false;
                    const body = document.body.innerText ? document.body.innerText.toLowerCase() : '';
                    const hasTable = document.querySelector('table tbody tr') !== null;
                    const hasNoResults = ['nenašli sa žiadne','žiadne záznamy','neobsahuje žiadne','0 záznamov'].some(m => body.includes(m));
                    return hasTable || hasNoResults;
                }""",
                timeout=20000,
            )
        except PlaywrightTimeoutError:
            logger.warning(f"[{self.source_type}] Čakanie na výsledky vypršalo, pokračujem s aktuálnym obsahom.")

    async def _check_no_results(self, page: Page) -> bool:
        body_text = await page.inner_text("body")
        lowered = body_text.lower()
        return any(marker in lowered for marker in ["nenašli sa žiadne", "žiadne záznamy", "neobsahuje žiadne", "0 záznamov"])

    async def _make_no_results_result(self, page: Page, ico: str, output_dir: Path, date_from_str: str) -> ScrapedSource:
        logger.info(f"[{self.source_type}] Žiadne záznamy pre IČO {ico}.")
        pdf_output = output_dir / f"crz_{ico}.pdf"
        await self._generate_no_results_pdf(
            page, pdf_output, ico,
            title="Centrálny register zmlúv (CRZ)",
            message=f"Pre IČO {ico} sa v CRZ nenašli žiadne zmluvy od {date_from_str}.",
        )
        return self._make_result(
            status="SUCCESS",
            file_path=str(pdf_output),
            page_count=1,
            status_message=f"IČO {ico} – žiadne zmluvy v CRZ.",
            findings="Žiadny záznam v Centrálnom registri zmlúv.",
        )

    async def _collect_all_rows(self, page: Page) -> tuple[list[str], int]:
        """Zbiera riadky tabuľky cez pagination stránky, max 30 najnovších zmlúv."""
        MAX_CONTRACTS = 30
        all_rows_html: list[str] = []
        page_num = 1

        while True:
            rows_html = await page.evaluate("""() => {
                const tbody = document.querySelector('table tbody');
                if (!tbody) return [];
                return Array.from(tbody.querySelectorAll('tr')).map(tr => tr.outerHTML);
            }""")
            if rows_html:
                all_rows_html.extend(rows_html)
                logger.info(f"[{self.source_type}] Strana {page_num}: {len(rows_html)} riadkov (celkom {len(all_rows_html)})")

            if len(all_rows_html) >= MAX_CONTRACTS:
                all_rows_html = all_rows_html[:MAX_CONTRACTS]
                logger.info(f"[{self.source_type}] Dosiahnutý limit {MAX_CONTRACTS} zmlúv — zastavujem pagination.")
                break

            next_link = await self._find_next_page_link(page, page_num)
            if not next_link:
                break

            page_num += 1
            logger.info(f"[{self.source_type}] Prechádzam na stranu {page_num}")
            await next_link.click()
            try:
                await page.wait_for_function(
                    "() => document.querySelector('table tbody tr') !== null",
                    timeout=10000,
                )
            except PlaywrightTimeoutError:
                pass

        return all_rows_html, page_num

    async def _find_next_page_link(self, page: Page, current_page: int):
        """Nájde pagination odkaz na nasledujúcu stranu."""
        try:
            # CRZ používa štandardnú pagination — odkazy s číslami strán
            pagination_links = page.locator(
                "a:has-text('2'), a:has-text('3'), a:has-text('4'), a:has-text('5'), "
                "a:has-text('6'), a:has-text('7'), a:has-text('8'), a:has-text('9'), "
                "a:has-text('10'), a:has-text('11'), a:has-text('12'), a:has-text('13'), "
                "a:has-text('14'), a:has-text('15'), a:has-text('16'), a:has-text('17'), "
                "a:has-text('18'), a:has-text('19'), a:has-text('20')"
            )
            count = await pagination_links.count()
            for i in range(count):
                link = pagination_links.nth(i)
                link_text = (await link.inner_text()).strip()
                if link_text == str(current_page + 1):
                    return link

            # Skús "Ďalej" / "Next" tlačidlo
            next_btn = page.locator("a:has-text('Ďalej'), a:has-text('Next'), li.next a").first
            if await next_btn.count() > 0:
                return next_btn
        except Exception:
            pass
        return None

    async def _extract_findings(self, page: Page, ico: str, pages: int, row_count: int) -> str:
        """Extrahuje nálezy z CRZ výsledkov."""
        try:
            text_content = await page.inner_text("body")

            # Hľadaj celkový počet záznamov
            match = re.search(r"(\d+)\s*záznam", text_content, re.IGNORECASE)
            total_records = int(match.group(1)) if match else row_count

            if total_records > 0:
                return (
                    f"POZOR: Pre IČO {ico} sa našlo {total_records} zmlúv v CRZ "
                    f"(zobrazených na {pages} stranách). "
                    f"Odporúčame skontrolovať zmluvy v vygenerovanom PDF."
                )
            else:
                return f"Žiadny záznam v Centrálnom registri zmlúv pre IČO {ico}."
        except Exception as e:
            logger.warning(f"[{self.source_type}] Extrakcia nálezov zlyhala: {e}")
            return f"Nájdené záznamy v CRZ pre IČO {ico} ({row_count} riadkov, {pages} strán)."
