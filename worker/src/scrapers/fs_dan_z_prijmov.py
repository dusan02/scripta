from __future__ import annotations
import logging

from playwright.async_api import Page

from .fs_base import FinancnaSpravaBase

logger = logging.getLogger(__name__)


class FsDanZPrijmovScraper(FinancnaSpravaBase):
    """
    Scraper pre Finančnú správu SR — Zoznam subjektov s výškou dane
    z príjmov právnickej osoby.
    Vyhľadáva jednoznačne podľa IČO — nepotrebuje ORSR dependency.
    """

    source_type = "FS_DAN_Z_PRIJMOV"
    zoznam_link_name = "Zoznam subjektov s výškou dane z príjmov právnickej osoby"
    file_prefix = "fs_dan_z_prijmov"
    pdf_title = "Zoznam subjektov s výškou dane z príjmov"
    search_by = "ico"

    async def _extract_findings(self, page: Page, search_term: str) -> str:
        """Extrahuje nálezy — výšku dane z príjmov právnickej osoby."""
        try:
            if await self._is_empty_page(page):
                return self._empty_findings()

            text_lower = (await page.inner_text("body")).lower()
            has_results = "daň" in text_lower or "príjmov" in text_lower or "výška" in text_lower

            if has_results:
                rows = await self._parse_table_rows(page)
                if rows:
                    info = []
                    for row_data in rows:
                        # Stĺpce: IČO | DIČ | Názov | Obec | PSČ | Ulica | Štát | Od | Do | Vyrubená daň | Daňová strata | (?)
                        ico_val = row_data[0] if len(row_data) > 0 else ""
                        dic_val = row_data[1] if len(row_data) > 1 else ""
                        name_val = row_data[2] if len(row_data) > 2 else ""
                        city_val = row_data[3] if len(row_data) > 3 else ""
                        psc_val = row_data[4] if len(row_data) > 4 else ""
                        street_val = row_data[5] if len(row_data) > 5 else ""
                        from_val = row_data[7] if len(row_data) > 7 else ""
                        to_val = row_data[8] if len(row_data) > 8 else ""
                        dan_val = row_data[9] if len(row_data) > 9 else ""
                        strata_val = row_data[10] if len(row_data) > 10 else ""

                        def format_eur(val: str) -> str:
                            try:
                                f_val = float(val.replace(',', '.').replace(' ', ''))
                                return f"{f_val:,.2f}".replace(',', ' ')
                            except ValueError:
                                return val

                        parts = []
                        if name_val:
                            parts.append(f"Názov: {name_val}")
                        if ico_val:
                            parts.append(f"IČO: {ico_val}")
                        if dic_val:
                            parts.append(f"DIČ: {dic_val}")
                        if from_val and to_val:
                            parts.append(f"Obdobie: {from_val} — {to_val}")
                        if dan_val:
                            parts.append(f"Vyrubená daň: {format_eur(dan_val)} EUR")
                        if strata_val:
                            parts.append(f"Daňová strata: {format_eur(strata_val)} EUR")

                        if parts:
                            info.append("\n".join(parts))

                    if info:
                        return "\n\n".join(info)

                return f"Subjekt (IČO: {search_term}) je v zozname subjektov s výškou dane z príjmov (detaily v PDF)."

            return f"Subjekt (IČO: {search_term}) nájdený bez zistených záznamov o výške dane z príjmov."

        except Exception as e:
            logger.warning(f"[{self.source_type}] Nepodarilo sa extrahovať nálezy: {e}")
            return None

    def _empty_findings(self) -> str:
        return "Žiadny záznam — subjekt nie je v zozname subjektov s výškou dane z príjmov právnickej osoby."
