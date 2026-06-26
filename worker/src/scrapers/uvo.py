from __future__ import annotations

import logging
import re
import time
from pathlib import Path
from typing import Optional

from playwright.async_api import Page, TimeoutError as PlaywrightTimeoutError, Error as PlaywrightError

from .base import BaseScraper, ScraperUnavailableError
from ..models import ScrapedSource

logger = logging.getLogger(__name__)

_NO_RESULTS_MARKERS = ["nenašli sa žiadne", "žiadne záznamy", "neobsahuje žiadne", "0 záznamov", "žiadne výsledky"]


class UvoScraper(BaseScraper):
    """
    Scraper pre Úrad pre verejné obstarávanie (uvo.gov.sk).
    Vyhľadáva podľa IČO v globálnom vyhľadávaní — profily VO/O, referencie, zákazky.
    Generuje PDF z výsledkov vyhľadávania.
    """

    source_type = "UVO"
    base_url = "https://www.uvo.gov.sk/"

    async def run(self, *, ico: str, output_dir: Path, **kwargs) -> ScrapedSource:
        page: Optional[Page] = None
        try:
            logger.info(f"[{self.source_type}] Začínam vyhľadávanie pre IČO: {ico}")
            _t = time.perf_counter()
            page = await self._get_page(block_images=False)

            await self._navigate(page)
            await self._accept_cookies(page)
            await self._search(page, ico)
            await self._wait_for_results(page)

            if await self._check_no_results(page):
                return await self._make_no_results_result(page, ico, output_dir)

            record_count = await self._extract_record_count(page)
            all_html, pages_collected = await self._collect_all_pages(page)

            if all_html:
                await page.evaluate(
                    "(html) => { const c = document.querySelector('.gs-result-block'); if (c) c.innerHTML = html; }",
                    all_html,
                )

            pdf_output = output_dir / f"uvo_{ico}.pdf"
            try:
                await self._generate_clean_pdf(
                    page, pdf_output,
                    title=f"Úrad pre verejné obstarávanie — IČO {ico}",
                    content_selector=".gs-result-block",
                    format="A4",
                    scale=0.85,
                )
                logger.info(f"[{self.source_type}] PDF vygenerované: {pdf_output}")
            except Exception as e:
                logger.error(f"[{self.source_type}] Zlyhalo generovanie PDF: {e}")
                return self._make_result(status="FAILED", status_message=f"Chyba pri generovaní PDF z UVO: {e}")

            findings = self._build_findings(ico, pages_collected, record_count)
            logger.info(f"[{self.source_type}] Hotovo za {time.perf_counter() - _t:.1f}s — {pages_collected} strán")

            return self._make_result(
                status="SUCCESS",
                file_path=str(pdf_output),
                page_count=1,
                status_message=f"Výpis z UVO úspešne vygenerovaný ({pages_collected} strán).",
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
            raise ScraperUnavailableError(f"UVO nedostupná: {e}")

    async def _accept_cookies(self, page: Page) -> None:
        try:
            btn = page.get_by_role("button", name="Accept all")
            await btn.wait_for(timeout=5000)
            await btn.click()
            logger.info(f"[{self.source_type}] Cookie banner prijatý.")
        except PlaywrightTimeoutError:
            logger.info(f"[{self.source_type}] Cookie banner sa nezobrazil.")

    async def _search(self, page: Page, ico: str) -> None:
        try:
            search_input = page.get_by_role("textbox", name="Hľadaný výraz")
            await search_input.wait_for(timeout=10000)
            await search_input.fill(ico)
            await page.get_by_role("button", name="Hľadať").click()
            logger.info(f"[{self.source_type}] Vyhľadávanie odoslané pre IČO: {ico}")
        except PlaywrightTimeoutError:
            raise ScraperUnavailableError("Nepodarilo sa vyplniť vyhľadávanie na UVO.")

    async def _wait_for_results(self, page: Page) -> None:
        try:
            await page.wait_for_function(
                """() => {
                    if (!document.body) return false;
                    const body = document.body.innerText ? document.body.innerText.toLowerCase() : '';
                    const hasResults = document.querySelector('.gs-result-block') !== null
                        && document.querySelector('.gs-result-block').children.length > 0;
                    const hasNoResults = ['nenašli sa žiadne','žiadne záznamy','neobsahuje žiadne','0 záznamov','žiadne výsledky'].some(m => body.includes(m));
                    return hasResults || hasNoResults;
                }""",
                timeout=20000,
            )
        except PlaywrightTimeoutError:
            logger.warning(f"[{self.source_type}] Čakanie na výsledky vypršalo, pokračujem s aktuálnym obsahom.")

    async def _check_no_results(self, page: Page) -> bool:
        body_text = await page.inner_text("body")
        lowered = body_text.lower()
        return any(marker in lowered for marker in _NO_RESULTS_MARKERS)

    async def _make_no_results_result(self, page: Page, ico: str, output_dir: Path) -> ScrapedSource:
        logger.info(f"[{self.source_type}] Žiadne záznamy pre IČO {ico}.")
        pdf_output = output_dir / f"uvo_{ico}.pdf"
        await self._generate_no_results_pdf(
            page, pdf_output, ico,
            title="Úrad pre verejné obstarávanie (UVO)",
            message=f"Pre IČO {ico} sa v UVO nenašli žiadne záznamy.",
        )
        return self._make_result(
            status="SUCCESS",
            file_path=str(pdf_output),
            page_count=1,
            status_message=f"IČO {ico} – žiadne záznamy v UVO.",
            findings="Žiadny záznam v registri Úradu pre verejné obstarávanie.",
        )

    # ── Pagination ───────────────────────────────────────────────────

    async def _collect_all_pages(self, page: Page) -> tuple[str, int]:
        all_html = ""
        page_num = 1

        while True:
            block_html = await page.evaluate("""() => {
                const block = document.querySelector('.gs-result-block');
                if (!block) return '';
                return block.innerHTML;
            }""")
            if block_html:
                all_html += block_html
                logger.info(f"[{self.source_type}] Strana {page_num}: obsah zachytený")

            next_link = await self._find_next_page_link(page)
            if not next_link:
                break

            page_num += 1
            logger.info(f"[{self.source_type}] Prechádzam na stranu {page_num}")
            await next_link.click()
            try:
                await page.wait_for_function(
                    "() => document.querySelector('.gs-result-block') !== null",
                    timeout=10000,
                )
            except PlaywrightTimeoutError:
                pass

        return all_html, page_num

    async def _find_next_page_link(self, page: Page):
        try:
            next_btn = page.locator("a:has-text('Ďalšia'), li.next a, a[rel='next']").first
            if await next_btn.count() > 0:
                return next_btn
        except Exception:
            pass
        return None

    # ── Findings ─────────────────────────────────────────────────────

    async def _extract_record_count(self, page: Page) -> int:
        try:
            text_content = await page.inner_text("body")
            match = re.search(r"(\d+)\s*záznam", text_content, re.IGNORECASE)
            return int(match.group(1)) if match else 0
        except Exception:
            return 0

    @staticmethod
    def _build_findings(ico: str, pages: int, record_count: int) -> str:
        if record_count > 0:
            return (
                f"POZOR: Pre IČO {ico} sa našlo {record_count} záznamov v UVO "
                f"(zobrazených na {pages} stranách). "
                f"Odporúčame skontrolovať záznamy vo vygenerovanom PDF."
            )
        return f"Žiadny záznam v registri Úradu pre verejné obstarávanie pre IČO {ico}."
