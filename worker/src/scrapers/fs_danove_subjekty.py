from __future__ import annotations
import logging

from playwright.async_api import Page

from .fs_base import FinancnaSpravaBase

logger = logging.getLogger(__name__)


class FsDanoveSubjektyScraper(FinancnaSpravaBase):
    """
    Scraper pre Finančnú správu SR — Zoznam daňových subjektov,
    ktorým bol určený index daňovej spoľahlivosti.
    Vyhľadáva jednoznačne podľa IČO — nepotrebuje ORSR dependency.
    """

    source_type = "FS_DANOVE_SUBJEKTY"
    zoznam_link_name = "Zoznam daňových subjektov, ktorým bol určený index daňovej spoľahlivosti"
    file_prefix = "fs_danove_subjekty"
    pdf_title = "Zoznam daňových subjektov — index daňovej spoľahlivosti"
    search_by = "ico"

    async def _extract_findings(self, page: Page, search_term: str) -> str:
        """Extrahuje nálezy — index daňovej spoľahlivosti subjektu."""
        try:
            if await self._is_empty_page(page):
                return self._empty_findings()

            text_lower = (await page.inner_text("body")).lower()
            has_results = "index" in text_lower or "daňovej spoľahlivosti" in text_lower or "spoľahlivos" in text_lower

            if has_results:
                rows = await self._parse_table_rows(page)
                if rows:
                    info = []
                    for row_data in rows:
                        # Stĺpce: DIČ, IČO, Meno/názov, Obec, PSČ, Ulica, Štát, Index spoľahlivosti
                        ico_val = row_data[1] if len(row_data) > 1 else ""
                        name_val = row_data[2] if len(row_data) > 2 else ""
                        city_val = row_data[3] if len(row_data) > 3 else ""
                        rating_val = row_data[7] if len(row_data) > 7 else ""

                        city_clean = city_val.split("\n")[0].strip() if city_val else ""

                        line = f"IČO: {ico_val} — {name_val}"
                        if city_clean:
                            line += f" ({city_clean})"
                        if rating_val:
                            # Pridaj POZOR pre menej spoľahlivých a nespoľahlivých, aby šablóna vyhodnotila riziko
                            if "menej spoľahlivý" in rating_val.lower() or "nespoľahlivý" in rating_val.lower():
                                line = "POZOR: " + line + f" — Hodnotenie: {rating_val}"
                            else:
                                line += f" — Hodnotenie: {rating_val}"
                        info.append(line)

                    if info:
                        return "\n".join(info)

                return f"Subjekt (IČO: {search_term}) je v zozname daňových subjektov s indexom daňovej spoľahlivosti (detaily v PDF)."

            return f"Subjekt (IČO: {search_term}) nájdený bez zistených záznamov o indexe daňovej spoľahlivosti."

        except Exception as e:
            logger.warning(f"[{self.source_type}] Nepodarilo sa extrahovať nálezy: {e}")
            return None

    def _empty_findings(self) -> str:
        return "Žiadny záznam — subjekt nie je v zozname daňových subjektov s indexom daňovej spoľahlivosti."
