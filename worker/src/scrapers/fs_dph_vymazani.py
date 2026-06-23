from __future__ import annotations
import logging

from playwright.async_api import Page

from .fs_base import FinancnaSpravaBase

logger = logging.getLogger(__name__)


class FsDphVymazaniScraper(FinancnaSpravaBase):
    """
    Scraper pre Finančnú správu SR — Zoznam vymazaných platiteľov DPH
    podľa §52 ods.8 zákona 563/2009 Z. z.
    Vyhľadáva jednoznačne podľa IČO — nepotrebuje ORSR dependency.
    """

    source_type = "FS_DPH_VYMAZANI"
    zoznam_link_name = "Zoznam vymazaných platiteľov DPH podľa §52 ods.8 zákona 563/2009 Z. z."
    file_prefix = "fs_dph_vymazani"
    search_by = "ico"

    async def _extract_findings(self, page: Page, search_term: str) -> str:
        """Extrahuje nálezy — či je subjekt v zozname vymazaných platiteľov DPH."""
        try:
            if await self._is_empty_page(page):
                return self._empty_findings()

            text_lower = (await page.inner_text("body")).lower()
            has_results = "vymaz" in text_lower or "dph" in text_lower

            if has_results:
                formatted = await self._parse_table_with_headers(page)
                if formatted:
                    return f"POZOR: Subjekt (IČO: {search_term}) je v zozname vymazaných platiteľov DPH.\n" + "\n\n".join(formatted)
                return f"POZOR: Subjekt (IČO: {search_term}) je v zozname vymazaných platiteľov DPH (detaily v PDF)."

            return f"Subjekt (IČO: {search_term}) nájdený bez zistených záznamov o vymazaní z registrácie DPH."

        except Exception as e:
            logger.warning(f"[{self.source_type}] Nepodarilo sa extrahovať nálezy: {e}")
            return None

    def _empty_findings(self) -> str:
        return "Žiadny záznam — subjekt nie je v zozname vymazaných platiteľov DPH."
