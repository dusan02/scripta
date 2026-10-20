from __future__ import annotations
import logging
import re
import unicodedata
from typing import Optional

from playwright.async_api import Page

from .fs_base import FinancnaSpravaBase

logger = logging.getLogger(__name__)

# Marker prefix: findings text starts with this when a near-match exists but
# cannot be safely attributed to the queried company. _save_live_source_result
# maps it to state=AMBIGUOUS (not DEBT, not CLEAN).
AMBIGUOUS_PREFIX = "__AMBIGUOUS__|"


class FsDanoveDlzniciScraper(FinancnaSpravaBase):
    """
    Scraper pre Finančnú správu SR — Zoznam daňových dlžníkov.
    Vyhľadáva podľa názvu subjektu (zoznam nemá filter podľa IČO) —
    vyžaduje company_name (v live-check ho posiela frontend, v reporte ORSR).

    Právna bezpečnosť: verejná stránka tvrdí "firma je dlžník" len pri EXACT
    normalized-name match (a zhode mesta, ak je známe). Substring look-alikes
    ("Autocentrum" vs "Autocentrum Plus") → AMBIGUOUS, nie falošný DEBT.
    """

    source_type = "FS_DANOVE_DLZNICI"
    zoznam_link_name = "Zoznam daňových dlžníkov"
    zoznam_link_selector = "a[title='Zoznam daňových dlžníkov']"
    ico_input_selector = "#M4_rptFilter_ctl00_txtText"
    file_prefix = "fs_danove_dlznici"
    pdf_title = "Zoznam daňových dlžníkov"
    search_by = "name"

    @staticmethod
    def _strip_diacritics(value: str) -> str:
        v = unicodedata.normalize("NFKD", value)
        return "".join(c for c in v if not unicodedata.combining(c))

    @classmethod
    def _normalize_name(cls, value: str) -> str:
        """Normalizuje názov na porovnanie — lowercase, bez diakritiky,
        bez právnej formy, bez stavových dodatkov, bez interpunkcie.
        Právna forma aj stavový dodatok sa opakujú do stabilizácie —
        "FERROW s. r. o. v likvidácii" aj "ABC v konkurze s.r.o." → base name."""
        v = cls._strip_diacritics(value.lower())
        prev = None
        while prev != v:
            prev = v
            v = re.sub(
                r"\s*(?:spol\.\s*s\s*r\.\s*o\.|s\.?\s*r\.?\s*o\.|a\.\s*s\.|v\.\s*o\.\s*s\.|k\.\s*s\.)\.?\s*,?\s*$",
                "",
                v,
                flags=re.IGNORECASE,
            )
            v = re.sub(
                r"\s*,?\s*(?:v\s+likvidacii|v\s+konkurze|v\s+restrukturalizacii)\s*$",
                "",
                v,
                flags=re.IGNORECASE,
            )
        v = re.sub(r"[^\w\s]", " ", v)
        return re.sub(r"\s+", " ", v).strip()

    @classmethod
    def _normalize_city(cls, value: Optional[str]) -> str:
        if not value:
            return ""
        v = cls._strip_diacritics(value.lower())
        v = re.sub(r"[^\w\s]", " ", v)
        return re.sub(r"\s+", " ", v).strip()

    @classmethod
    def _city_matches(cls, company_city_norm: str, row_city_norm: str) -> bool:
        if not company_city_norm or not row_city_norm:
            return True  # unknown city → don't block an exact-name match
        return company_city_norm in row_city_norm or row_city_norm in company_city_norm

    @staticmethod
    def _format_row(name_val: str, city_val: str, psc_val: str, street_val: str, sum_val: str) -> str:
        parts = [name_val]
        detail = ", ".join(v for v in (city_val, psc_val, street_val) if v)
        if detail:
            parts.append(detail)
        if sum_val:
            try:
                f_val = float(sum_val.replace(",", ".").replace(" ", "").replace("\xa0", ""))
                sum_val = f"{f_val:,.2f}".replace(",", " ")
            except ValueError:
                pass
            parts.append(f"Suma nedoplatkov: {sum_val} €")
        return " | ".join(parts)

    async def _extract_findings(self, page: Page, search_term: str, company_name=None) -> str:
        """Extrahuje nálezy — názov, obec a sumu nedoplatkov zo zoznamu daňových dlžníkov."""
        try:
            if await self._is_empty_page(page):
                return self._empty_findings()

            rows = await self._parse_table_rows(page)
            if not rows:
                return self._empty_findings()

            # Stĺpce: Názov subjektu | Obec | PSČ | Ulica číslo | Suma nedoplatkov
            company_city = getattr(self, "_company_city", None)
            query_norm = self._normalize_name(company_name or search_term)
            city_norm = self._normalize_city(company_city)
            if not query_norm:
                return self._empty_findings()

            exact: list[str] = []
            city_mismatch: list[str] = []
            fuzzy: list[str] = []

            for row_data in rows:
                name_val = row_data[0] if len(row_data) > 0 else ""
                city_val = row_data[1] if len(row_data) > 1 else ""
                psc_val = row_data[2] if len(row_data) > 2 else ""
                street_val = row_data[3] if len(row_data) > 3 else ""
                sum_val = row_data[4] if len(row_data) > 4 else ""

                row_norm = self._normalize_name(name_val)
                if not row_norm:
                    continue

                formatted = self._format_row(name_val, city_val, psc_val, street_val, sum_val)

                if row_norm == query_norm:
                    if self._city_matches(city_norm, self._normalize_city(city_val)):
                        exact.append(formatted)
                    else:
                        city_mismatch.append(formatted)
                elif query_norm in row_norm or row_norm in query_norm:
                    fuzzy.append(formatted)

            if exact:
                return (
                    f"POZOR: Subjekt ({company_name or search_term}) je v zozname daňových dlžníkov Finančnej správy.\n"
                    + "\n".join(exact)
                )

            if city_mismatch or fuzzy:
                candidates = (city_mismatch + fuzzy)[:5]
                return (
                    f"{AMBIGUOUS_PREFIX}V zozname daňových dlžníkov sa našiel podobný názov, "
                    f"ale bez zhody IČO sa nedá bezpečne priradiť k firme {company_name or search_term} "
                    f"— vyžaduje manuálne overenie na financnasprava.sk. "
                    f"Kandidáti: {'; '.join(candidates)}"
                )

            return self._empty_findings()

        except Exception as e:
            logger.warning(f"[{self.source_type}] Nepodarilo sa extrahovať nálezy: {e}")
            return None

    def _empty_findings(self) -> str:
        return "Žiadny záznam — subjekt nie je v zozname daňových dlžníkov Finančnej správy."
