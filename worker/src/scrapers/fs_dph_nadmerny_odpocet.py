from __future__ import annotations
import logging

from playwright.async_api import Page

from .fs_base import FinancnaSpravaBase

logger = logging.getLogger(__name__)


class FsDphNadmernyOdpocetScraper(FinancnaSpravaBase):
    """
    Scraper pre Finančnú správu SR — Zoznam daňových subjektov (DPH)
    s výškou nadmerného odpočtu a výškou vlastnej daňovej povinnosti.
    Vyhľadáva jednoznačne podľa IČO — nepotrebuje ORSR dependency.
    """

    source_type = "FS_DPH_NADMERNY_ODPOCET"
    zoznam_link_name = "Zoznam daňových subjektov (DPH) s výškou nadmerného odpočtu a výškou vlastnej daňovej povinnosti"
    file_prefix = "fs_dph_nadmerny_odpocet"
    search_by = "ico"

    async def _extract_findings(self, page: Page, search_term: str) -> str:
        """Extrahuje nálezy — nadmerný odpočet a vlastnú daňovú povinnosť DPH."""
        try:
            if await self._is_empty_page(page):
                return self._empty_findings()

            text_lower = (await page.inner_text("body")).lower()
            has_results = "nadmerný" in text_lower or "odpočet" in text_lower or "dph" in text_lower or "daňovej povinnosti" in text_lower

            if has_results:
                _SKIP = {"názov subjektu", "názov", "obec", "psč", "psc", "ulica", "ičo", "ico", "dič", "dic", "štát", "stat"}
                formatted = await self._parse_table_with_headers(page, skip_columns=_SKIP)
                if formatted:
                    return f"Subjekt (IČO: {search_term}) je v zozname DPH subjektov s nadmerným odpočtom.\n" + "\n\n".join(formatted)

                return f"Subjekt (IČO: {search_term}) je v zozname DPH subjektov s nadmerným odpočtom (detaily v PDF)."

            return f"Subjekt (IČO: {search_term}) nájdený bez zistených záznamov o nadmernom odpočte DPH."

        except Exception as e:
            logger.warning(f"[{self.source_type}] Nepodarilo sa extrahovať nálezy: {e}")
            return None

    def _empty_findings(self) -> str:
        return "Žiadny záznam — subjekt nie je v zozname DPH subjektov s nadmerným odpočtom."
