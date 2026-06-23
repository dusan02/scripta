from __future__ import annotations
import logging

from playwright.async_api import Page

from .fs_base import FinancnaSpravaBase

logger = logging.getLogger(__name__)


class FsDphRegistrovaniScraper(FinancnaSpravaBase):
    """
    Scraper pre Finančnú správu SR — Zoznam daňových subjektov
    registrovaných pre DPH.
    Vyhľadáva jednoznačne podľa IČO — nepotrebuje ORSR dependency.
    """

    source_type = "FS_DPH_REGISTROVANI"
    zoznam_link_name = "Zoznam daňových subjektov registrovaných pre DPH"
    file_prefix = "fs_dph_registrovani"
    search_by = "ico"

    async def _extract_findings(self, page: Page, search_term: str) -> str:
        """Extrahuje nálezy — DPH registráciu subjektu."""
        try:
            if await self._is_empty_page(page):
                return self._empty_findings()

            text_lower = (await page.inner_text("body")).lower()
            has_results = "dph" in text_lower or "registrovan" in text_lower or "daňový subjekt" in text_lower

            if has_results:
                rows = await self._parse_table_rows(page)
                if rows:
                    info = []
                    for row_data in rows:
                        parts = []
                        for val in row_data:
                            if val and val.strip():
                                parts.append(val.strip())
                        if parts:
                            info.append(" | ".join(parts))
                    if info:
                        return "\n".join(info)

                return f"Subjekt (IČO: {search_term}) je registrovaný pre DPH (detaily v PDF)."

            return f"Subjekt (IČO: {search_term}) nájdený bez zistených záznamov o DPH registrácii."

        except Exception as e:
            logger.warning(f"[{self.source_type}] Nepodarilo sa extrahovať nálezy: {e}")
            return None

    def _empty_findings(self) -> str:
        return "Žiadny záznam — subjekt nie je v zozname daňových subjektov registrovaných pre DPH."
