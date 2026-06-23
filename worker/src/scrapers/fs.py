from __future__ import annotations
import logging

from playwright.async_api import Page

from .fs_base import FinancnaSpravaBase

logger = logging.getLogger(__name__)


class FinancnaSpravaScraper(FinancnaSpravaBase):
    """
    Scraper pre Finančnú správu SR — Zoznam daňových dlžníkov.
    Vyžaduje názov subjektu (nie IČO). Názov sa získava z ORSR scraperu.
    """

    source_type = "FINANCNA_SPRAVA"
    zoznam_link_name = "Zoznam daňových dlžníkov"
    file_prefix = "financna_sprava_dlznici"

    async def _extract_findings(self, page: Page, search_term: str) -> str:
        """Extrahuje nálezy z výsledkovej tabuľky zoznamu daňových dlžníkov."""
        try:
            if await self._is_empty_page(page):
                return self._empty_findings()

            text_lower = (await page.inner_text("body")).lower()
            has_debt = "nedoplatok" in text_lower or "nedoplatky" in text_lower or "dlžník" in text_lower

            if has_debt:
                formatted = await self._parse_table_with_headers(page)
                if formatted:
                    return f"POZOR: Subjekt '{search_term}' je v zozname daňových dlžníkov.\n" + "\n\n".join(formatted)

            return f"Subjekt '{search_term}' nájdený v zozname Finančnej správy bez zistených nedoplatkov."

        except Exception as e:
            logger.warning(f"[{self.source_type}] Nepodarilo sa extrahovať nálezy: {e}")
            return None

    def _empty_findings(self) -> str:
        return "Žiadny záznam v zozname daňových dlžníkov — subjekt nemá daňové nedoplatky."
