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

_EMPTY_MARKERS = ("Nenašli sa žiadne", "Podmienkam nevyhovuje žiadny")

_LEGAL_FORM_RE = re.compile(
    r'((?:spol\.\s*s\s*r\.\s*o\.|s\.?\s*r\.?\s*o\.|a\.\s*s\.|v\.\s*o\.\s*s\.|k\.\s*s\.))\.?\s.*$',
    re.IGNORECASE,
)
_QUOTE_RE = re.compile(r'^["\']+(.+?)["\']+')
_NUM_RE = re.compile(r'^\d+\.$')


class OrsrScraper(BaseScraper):
    """Scraper pre Obchodný register SR (ORSR). Hľadá firmu podľa IČO a sťahuje PDF výpis."""

    source_type = "ORSR"
    base_url = "https://www.orsr.sk/hladaj_ico.asp"

    # ── Public ───────────────────────────────────────────────────────

    async def run(self, *, ico: str, output_dir: Path, orsr_extract_type: str = "CURRENT", **kwargs) -> ScrapedSource:
        page: Optional[Page] = None
        try:
            logger.info(f"[{self.source_type}] Začínam pre IČO: {ico} (typ: {orsr_extract_type})")
            _t = time.perf_counter()
            page = await self._get_page(block_images=False)
            print(f"[{self.source_type}] ⏱ get_page: {time.perf_counter() - _t:.2f}s")

            await self._navigate_to_search(page, ico)
            print(f"[{self.source_type}] ⏱ goto: {time.perf_counter() - _t:.2f}s")
            _t = time.perf_counter()

            if await self._is_empty_results(page):
                return self._make_result(
                    status="SUCCESS",
                    file_path=None,
                    status_message=f"IČO {ico} nebolo nájdené v ORSR.",
                    findings="Žiadny záznam v Obchodnom registri SR.",
                )

            link_name = "Úplný" if orsr_extract_type == "FULL" else "Aktuálny"
            company_name = await self._click_extract_link(page, link_name)
            if company_name is None:
                return self._make_result(
                    status="SUCCESS",
                    file_path=None,
                    status_message=f"Výpis pre IČO {ico} nebol nájdený.",
                    findings="Záznam neexistuje alebo nebol nájdený.",
                )
            print(f"[{self.source_type}] ⏱ detail_click + meno: {time.perf_counter() - _t:.2f}s")
            _t = time.perf_counter()

            pdf_output = output_dir / f"orsr_{ico}.pdf"
            try:
                await self._print_page_to_pdf(page, pdf_output)
                print(f"[{self.source_type}] ⏱ print_pdf: {time.perf_counter() - _t:.2f}s")
                logger.info(f"[{self.source_type}] PDF: {pdf_output}")
            except Exception as e:
                logger.error(f"[{self.source_type}] PDF zlyhalo: {e}")
                return self._make_result(status="FAILED", status_message=f"Chyba pri generovaní PDF z ORSR: {e}")

            findings = await self._extract_findings(page)
            return self._make_result(
                status="SUCCESS",
                file_path=str(pdf_output),
                page_count=1,
                status_message="Výpis z ORSR úspešne stiahnutý.",
                findings=findings,
                company_name=company_name,
            )
        except ScraperUnavailableError as e:
            logger.error(f"[{self.source_type}] Nedostupný: {e}")
            return self._make_result(status="UNAVAILABLE", status_message=f"Register ORSR je nedostupný: {e}")
        except PlaywrightError as e:
            logger.error(f"[{self.source_type}] Playwright chyba: {e}")
            return self._make_result(status="FAILED", status_message=f"Sieťová chyba pri spracovaní ORSR: {e}")
        except Exception as e:
            logger.error(f"[{self.source_type}] Nečakaná chyba: {e}", exc_info=True)
            return self._make_result(status="FAILED", status_message=f"{type(e).__name__}: {e}")
        finally:
            if page:
                await page.close()

    # ── Private helpers ──────────────────────────────────────────────

    async def _navigate_to_search(self, page: Page, ico: str) -> None:
        search_url = f"{self.base_url}?ICO={ico}&SID=0"
        logger.info(f"[{self.source_type}] Navigujem na {search_url}")
        try:
            await page.goto(search_url, timeout=45000, wait_until="domcontentloaded")
        except PlaywrightTimeoutError:
            raise ScraperUnavailableError("Timeout pri načítaní stránky ORSR.")

    async def _is_empty_results(self, page: Page) -> bool:
        text = await page.inner_text("body")
        return any(marker in text for marker in _EMPTY_MARKERS)

    async def _click_extract_link(self, page: Page, link_name: str) -> Optional[str]:
        """Nájde odkaz 'Aktuálny'/'Úplný', extrahuje company_name z riadku a klikne."""
        detail_link = page.get_by_role("link", name=link_name).first
        try:
            await detail_link.wait_for(timeout=10000)
        except PlaywrightTimeoutError:
            logger.warning(f"[{self.source_type}] Odkaz '{link_name}' nenájdený.")
            return None

        company_name = await self._extract_company_name(detail_link)
        logger.info(f"[{self.source_type}] Klikám '{link_name}' pre: {company_name}")
        await detail_link.click()
        await page.wait_for_load_state("domcontentloaded", timeout=45000)
        return company_name

    async def _extract_company_name(self, detail_link) -> Optional[str]:
        """Extrahuje obchodné meno z riadku tabuľky, v ktorom je odkaz."""
        try:
            row = detail_link.locator("xpath=ancestor::tr")
            cells = row.locator("td")
            for i in range(await cells.count()):
                val = (await cells.nth(i).inner_text()).strip()
                if val and not _NUM_RE.match(val) and "aktuálny" not in val.lower() and "úplný" not in val.lower():
                    return self._clean_company_name(val)
        except Exception as row_err:
            logger.warning(f"[{self.source_type}] Riadok tabuľky zlyhal: {row_err}")
        # Fallback na text odkazu
        try:
            return self._clean_company_name(await detail_link.inner_text())
        except Exception:
            return None

    @staticmethod
    def _clean_company_name(raw: str) -> str:
        """Očistí obchodné meno — úvodzovky, trailing obec za právnou formou."""
        name = raw.strip()
        m = _QUOTE_RE.match(name)
        if m:
            return m.group(1).strip()
        return _LEGAL_FORM_RE.sub(r'\1', name).strip()

    async def _extract_findings(self, page: Page) -> Optional[str]:
        try:
            text = (await page.inner_text("body")).lower()
            if "v likvidácii" in text:
                return "POZOR: Spoločnosť je v likvidácii."
            if "vymazaná" in text:
                return "POZOR: Spoločnosť je vymazaná z ORSR."
            return "Aktívna spoločnosť v ORSR (bez zistených anomálií)."
        except Exception as e:
            logger.warning(f"[{self.source_type}] Nálezy zlyhali: {e}")
            return "Nálezy sa nepodarilo extrahovať."
