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
    Vyhľadáva podľa IČO dodávateľa s dátumovým rozsahom (today-1year ~ today).
    Podporuje pagination — scrapne všetky strany a spojí ich do jedného PDF.
    """

    source_type = "CRZ"
    base_url = "https://www.crz.gov.sk/"

    async def run(self, *, ico: str, output_dir: Path, **kwargs) -> ScrapedSource:
        page: Optional[Page] = None
        try:
            logger.info(f"[{self.source_type}] Začínam vyhľadávanie pre IČO: {ico}")
            _t = time.perf_counter()
            page = await self._get_page(block_images=False)

            # ── 1. Navigácia ───────────────────────────────────────────
            logger.info(f"[{self.source_type}] Navigujem na {self.base_url}")
            try:
                await page.goto(self.base_url, timeout=30000, wait_until="domcontentloaded")
            except (PlaywrightTimeoutError, PlaywrightError) as e:
                raise ScraperUnavailableError(f"CRZ nedostupná: {e}")
            logger.debug(f"[{self.source_type}] ⏱ goto: {time.perf_counter() - _t:.2f}s")

            # ── 2. Cookie banner ───────────────────────────────────────
            try:
                btn = page.get_by_role("button", name="Prijať všetko")
                await btn.wait_for(timeout=5000)
                await btn.click()
                logger.info(f"[{self.source_type}] Cookie banner prijatý.")
            except PlaywrightTimeoutError:
                logger.info(f"[{self.source_type}] Cookie banner sa nezobrazil.")

            # ── 3. Rozšírené vyhľadávanie ──────────────────────────────
            try:
                adv_btn = page.get_by_role("button", name="Rozšírené vyhľadávanie")
                await adv_btn.wait_for(timeout=10000)
                await adv_btn.click()
                logger.info(f"[{self.source_type}] Rozšírené vyhľadávanie otvorené.")
            except PlaywrightTimeoutError:
                logger.error(f"[{self.source_type}] Tlačidlo 'Rozšírené vyhľadávanie' sa nenašlo.")
                return self._make_result(
                    status="FAILED",
                    status_message="Nepodarilo sa otvoriť rozšírené vyhľadávanie na CRZ.",
                )

            # ── 4. Vyplniť IČO dodávateľa ───────────────────────────────
            try:
                ico_input = page.get_by_role("textbox", name="IČO dodávateľa:")
                await ico_input.wait_for(timeout=10000)
                await ico_input.click()
                await ico_input.fill(ico)
                logger.info(f"[{self.source_type}] IČO vyplnené: {ico}")
            except PlaywrightTimeoutError:
                logger.error(f"[{self.source_type}] Pole 'IČO dodávateľa' sa nenašlo.")
                return self._make_result(
                    status="FAILED",
                    status_message="Nepodarilo sa nájsť pole IČO dodávateľa na CRZ.",
                )

            # ── 5. Dátumy: od = today-1year, do = today ────────────────
            today = date.today()
            date_from = today - timedelta(days=365)
            date_from_str = date_from.strftime("%d.%m.%Y")
            date_to_str = today.strftime("%d.%m.%Y")

            logger.info(f"[{self.source_type}] Dátumy: od {date_from_str} do {date_to_str}")

            # Dátum "od"
            try:
                from_input = page.get_by_role("textbox", name="Zverejnené: od")
                await from_input.wait_for(timeout=10000)
                await from_input.click()
                await from_input.fill(date_from_str)
                logger.info(f"[{self.source_type}] Dátum od vyplnený: {date_from_str}")
            except PlaywrightTimeoutError:
                logger.error(f"[{self.source_type}] Pole 'Zverejnené: od' sa nenašlo.")
                return self._make_result(
                    status="FAILED",
                    status_message="Nepodarilo sa vyplniť dátum 'od' na CRZ.",
                )

            # Dátum "do"
            try:
                to_input = page.get_by_role("textbox", name="Zverejnené: do")
                await to_input.wait_for(timeout=10000)
                await to_input.click()
                await to_input.fill(date_to_str)
                logger.info(f"[{self.source_type}] Dátum do vyplnený: {date_to_str}")
            except PlaywrightTimeoutError:
                logger.error(f"[{self.source_type}] Pole 'Zverejnené: do' sa nenašlo.")
                return self._make_result(
                    status="FAILED",
                    status_message="Nepodarilo sa vyplniť dátum 'do' na CRZ.",
                )

            # ── 6. Vyhľadať ─────────────────────────────────────────────
            try:
                search_btn = page.get_by_role("button", name="Vyhľadať")
                await search_btn.wait_for(timeout=10000)
                await search_btn.click()
                logger.info(f"[{self.source_type}] Vyhľadávanie odoslané.")
            except PlaywrightTimeoutError:
                logger.error(f"[{self.source_type}] Tlačidlo 'Vyhľadať' sa nenašlo.")
                return self._make_result(
                    status="FAILED",
                    status_message="Nepodarilo sa nájsť tlačidlo Vyhľadať na CRZ.",
                )

            # ── 7. Počkať na výsledky ───────────────────────────────────
            try:
                await page.wait_for_load_state("domcontentloaded", timeout=15000)
            except PlaywrightTimeoutError:
                pass

            # Skontrolovať či sú výsledky
            body_text = await page.inner_text("body")
            no_results_markers = [
                "nenašli sa žiadne",
                "žiadne záznamy",
                "neobsahuje žiadne",
                "0 záznamov",
            ]
            is_empty = any(marker in body_text.lower() for marker in no_results_markers)

            if is_empty:
                logger.info(f"[{self.source_type}] Žiadne záznamy pre IČO {ico}.")
                pdf_output = output_dir / f"crz_{ico}.pdf"
                await self._generate_no_results_pdf(
                    page, pdf_output, ico,
                    title="Centrálny register zmlúv (CRZ)",
                    message=f"Pre IČO {ico} sa v CRZ nenašli žiadne zmluvy v období {date_from_str} – {date_to_str}.",
                )
                return self._make_result(
                    status="SUCCESS",
                    file_path=str(pdf_output),
                    page_count=1,
                    status_message=f"IČO {ico} – žiadne zmluvy v CRZ.",
                    findings="Žiadny záznam v Centrálnom registri zmlúv v zadanom období.",
                )

            # ── 8. Pagination — scrapne všetky strany ────────────────────
            all_rows_html, pages_collected = await self._collect_all_rows(page)

            # Spojí všetky riadky do jednej tabuľky
            if all_rows_html:
                await page.evaluate("""(rowsHtml) => {
                    const tbody = document.querySelector('table tbody');
                    if (tbody) {
                        tbody.innerHTML = rowsHtml.join('');
                    }
                }""", all_rows_html)

            # ── 9. Generovať PDF ────────────────────────────────────────
            pdf_output = output_dir / f"crz_{ico}.pdf"
            try:
                await self._generate_clean_pdf(
                    page,
                    pdf_output,
                    title=f"Centrálny register zmlúv — IČO {ico}",
                    content_selector="table",
                    format="A4",
                    scale=0.85,
                )
                logger.info(f"[{self.source_type}] PDF vygenerované: {pdf_output}")
            except Exception as e:
                logger.error(f"[{self.source_type}] Zlyhalo generovanie PDF: {e}")
                return self._make_result(
                    status="FAILED",
                    status_message=f"Chyba pri generovaní PDF z CRZ: {e}",
                )

            # ── 10. Findings ────────────────────────────────────────────
            findings = await self._extract_findings(page, ico, pages_collected, len(all_rows_html))

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

    async def _collect_all_rows(self, page: Page) -> tuple[list[str], int]:
        """Zbiera všetky riadky tabuľky cez pagination stránky. Vráti (rows_html, page_count)."""
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

            next_link = await self._find_next_page_link(page, page_num)
            if not next_link:
                break

            page_num += 1
            logger.info(f"[{self.source_type}] Prechádzam na stranu {page_num}")
            await next_link.click()
            try:
                await page.wait_for_load_state("domcontentloaded", timeout=10000)
            except PlaywrightTimeoutError:
                pass
            try:
                await page.locator("table tbody tr").first.wait_for(timeout=8000)
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
