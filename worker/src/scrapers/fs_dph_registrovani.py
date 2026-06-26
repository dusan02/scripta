from __future__ import annotations
import logging
import re

from playwright.async_api import Page

from .fs_base import FinancnaSpravaBase

logger = logging.getLogger(__name__)


class FsDphRegistrovaniScraper(FinancnaSpravaBase):
    """
    Scraper pre Finančnú správu SR — Zoznam daňových subjektov
    registrovaných pre DPH.
    Vyhľadáva jednoznačne podľa IČO — nepotrebuje ORSR dependency.
    Extrahuje IČ DPH (napr. SK7120001713) z výsledkov pre ďalšie použitie.
    """

    source_type = "FS_DPH_REGISTROVANI"
    zoznam_link_name = "Zoznam daňových subjektov registrovaných pre DPH"
    file_prefix = "fs_dph_registrovani"
    pdf_title = "Zoznam daňových subjektov registrovaných pre DPH"
    search_by = "ico"

    async def _extract_ic_dph(self, page: Page) -> str | None:
        """Extrahuje IČ DPH z výsledkovej tabuľky (napr. SK7120001713)."""
        try:
            return await page.evaluate("""() => {
                const headers = Array.from(document.querySelectorAll('table thead th, table thead td'));
                const icDphIdx = headers.findIndex(h => {
                    const t = h.textContent.trim().toLowerCase();
                    return t === 'ič dph' || t === 'ic dph' || t === 'ič_dph' || t === 'ic_dph';
                });
                if (icDphIdx === -1) return null;
                const firstRow = document.querySelector('table tbody tr');
                if (!firstRow) return null;
                const cells = firstRow.querySelectorAll('td');
                if (cells.length <= icDphIdx) return null;
                const val = cells[icDphIdx].textContent.trim();
                return val || null;
            }""")
        except Exception as e:
            logger.warning(f"[{self.source_type}] Extrakcia IČ DPH zlyhala: {e}")
            return None

    async def _extract_findings(self, page: Page, search_term: str) -> str:
        """Extrahuje nálezy — DPH registráciu subjektu."""
        try:
            if await self._is_empty_page(page):
                return self._empty_findings()

            text_lower = (await page.inner_text("body")).lower()
            has_results = "dph" in text_lower or "registrovan" in text_lower or "daňový subjekt" in text_lower

            if has_results:
                _SKIP = {"názov subjektu", "názov", "obec", "psč", "psc", "ulica", "ulica číslo", "ičo", "ico", "dič", "dic", "štát", "stat"}
                formatted = await self._parse_table_with_headers(page, skip_columns=_SKIP)
                if formatted:
                    return f"Subjekt (IČO: {search_term}) je registrovaný pre DPH.\n" + "\n\n".join(formatted)

                return f"Subjekt (IČO: {search_term}) je registrovaný pre DPH (detaily v PDF)."

            return f"Subjekt (IČO: {search_term}) nájdený bez zistených záznamov o DPH registrácii."

        except Exception as e:
            logger.warning(f"[{self.source_type}] Nepodarilo sa extrahovať nálezy: {e}")
            return None

    def _empty_findings(self) -> str:
        return "Žiadny záznam — subjekt nie je v zozname daňových subjektov registrovaných pre DPH."
