from __future__ import annotations
import logging

from playwright.async_api import Page

from .fs_base import FinancnaSpravaBase

logger = logging.getLogger(__name__)


class FsDanPrijmovRegistrovaniScraper(FinancnaSpravaBase):
    """
    Scraper pre Finančnú správu SR — Zoznam daňových subjektov
    registrovaných na daň z príjmov.
    Vyhľadáva jednoznačne podľa IČO — nepotrebuje ORSR dependency.
    """

    source_type = "FS_DAN_PRIJMOV_REG"
    zoznam_link_name = "Zoznam daňových subjektov registrovaných na daň z príjmov"
    file_prefix = "fs_dan_prijmov_reg"
    search_by = "ico"

    async def _extract_findings(self, page: Page, search_term: str) -> str:
        """Extrahuje nálezy — registráciu subjektu na daň z príjmov."""
        try:
            if await self._is_empty_page(page):
                return self._empty_findings()

            text_lower = (await page.inner_text("body")).lower()
            has_results = "daň z príjmov" in text_lower or "registrovan" in text_lower or "daňový subjekt" in text_lower

            if has_results:
                _SKIP = {"názov subjektu", "názov", "obec", "psč", "psc", "ulica", "ulica číslo", "ičo", "ico", "dič", "dic", "štát", "stat", "ič dph", "ič_dph"}
                formatted = await self._parse_table_with_headers(page, skip_columns=_SKIP)
                if formatted:
                    return f"Subjekt (IČO: {search_term}) je registrovaný na daň z príjmov.\n" + "\n\n".join(formatted)

                return f"Subjekt (IČO: {search_term}) je registrovaný na daň z príjmov (detaily v PDF)."

            return f"Subjekt (IČO: {search_term}) nájdený bez zistených záznamov o registrácii na daň z príjmov."

        except Exception as e:
            logger.warning(f"[{self.source_type}] Nepodarilo sa extrahovať nálezy: {e}")
            return None

    def _empty_findings(self) -> str:
        return "Žiadny záznam — subjekt nie je v zozname daňových subjektov registrovaných na daň z príjmov."
