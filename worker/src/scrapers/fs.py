from __future__ import annotations
import logging
import re
import unicodedata

from pathlib import Path
from playwright.async_api import Page

from .fs_base import FinancnaSpravaBase

logger = logging.getLogger(__name__)


def _normalize_name(name: str) -> str:
    """Normalizuje názov firmy pre porovnanie: bez diakritiky, lowercase, bez právnej formy."""
    nfkd = unicodedata.normalize('NFKD', name)
    without_accents = ''.join(c for c in nfkd if not unicodedata.combining(c))
    lower = without_accents.lower()
    lower = re.sub(
        r'\s+(?:spol\.\s*s\s*r\.\s*o\.|s\.?\s*r\.?\s*o\.|a\.\s*s\.|v\.\s*o\.\s*s\.|k\.\s*s\.)\.?$',
        '', lower, flags=re.IGNORECASE,
    )
    cleaned = re.sub(r'[^a-z\s]', '', lower)
    return ' '.join(cleaned.split())


class FinancnaSpravaScraper(FinancnaSpravaBase):
    """
    Scraper pre Finančnú správu SR — Zoznam daňových dlžníkov.
    Vyžaduje názov subjektu (nie IČO). Názov sa získava z ORSR scraperu.
    """

    source_type = "FINANCNA_SPRAVA"
    zoznam_link_name = "Zoznam daňových dlžníkov"
    file_prefix = "financna_sprava_dlznici"
    pdf_title = "Zoznam daňových dlžníkov — Finančná správa SR"

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
                    table_text = " ".join(formatted)
                    if not self._verify_name_match(search_term, table_text):
                        logger.info(
                            f"[{self.source_type}] Tabuľka nájdená, ale názov sa nezhoduje "
                            f"s hľadaným '{search_term}' — false positive (partial match)."
                        )
                        return self._empty_findings()

                    return f"POZOR: Subjekt '{search_term}' je v zozname daňových dlžníkov.\n" + "\n\n".join(formatted)

            return f"Subjekt '{search_term}' nájdený v zozname Finančnej správy bez zistených nedoplatkov."

        except Exception as e:
            logger.warning(f"[{self.source_type}] Nepodarilo sa extrahovať nálezy: {e}")
            return None

    @staticmethod
    def _verify_name_match(search_term: str, table_text: str) -> bool:
        """Overí, že hľadaný názov sa v tabuľke vyskytuje ako celé slovo (word boundary).

        FS vyhľadávanie robí partial match — "MET Slovakia" môže nájsť "MULTIMET SLOVAKIA".
        Word-boundary kontrola zabráni false positives: \\bmet slovakia\\b sa nenájde
        v "multimet slovakia" pretože "met" je súčasťou "multimet" (žiadny word boundary).
        """
        norm_search = _normalize_name(search_term)
        norm_table = _normalize_name(table_text)
        if not norm_search:
            return True
        pattern = r'\b' + re.escape(norm_search) + r'\b'
        match = bool(re.search(pattern, norm_table))
        logger.debug(
            f"[FINANCNA_SPRAVA] Name match: search='{norm_search}' "
            f"table='{norm_table[:80]}' → {'OK' if match else 'FAIL'}"
        )
        return match

    def _empty_findings(self) -> str:
        return "Žiadny záznam v zozname daňových dlžníkov — subjekt nemá daňové nedoplatky."

    async def _download_pdf(self, page: Page, output_path: Path) -> bool:
        """Generuje PDF z výsledkovej stránky pomocou print-to-PDF namiesto Export do PDF.

        Finančná správa otvára popup s PDF viewerom, ktorý page.pdf() nedokáže
        zachytiť — výsledkom je prázdna stránka. Namiesto toho používame
        _generate_clean_pdf (rovnaký prístup ako ostatné debtor scrapery).
        """
        try:
            await self._generate_clean_pdf(
                page, output_path,
                title=self.pdf_title,
                content_selector="table, .table, .datagrid",
                format="A4",
                scale=0.9,
            )
            logger.info(f"[{self.source_type}] PDF vygenerované cez _generate_clean_pdf: {output_path}")
            return True
        except Exception as e:
            logger.warning(f"[{self.source_type}] _generate_clean_pdf zlyhal, skúšam fallback _download_pdf: {e}")
            return await super()._download_pdf(page, output_path)
