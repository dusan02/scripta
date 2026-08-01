from __future__ import annotations
import logging
import re
import unicodedata
from typing import Optional

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
    zoznam_link_selector = "a[title='Zoznam daňových dlžníkov']"
    ico_input_selector = "#M4_rptFilter_ctl00_txtText"
    file_prefix = "financna_sprava_dlznici"
    pdf_title = "Zoznam daňových dlžníkov — Finančná správa SR"

    async def _extract_findings(self, page: Page, search_term: str, company_name: str = None) -> str:
        """Extrahuje nálezy z výsledkovej tabuľky zoznamu daňových dlžníkov.

        FS vyhľadávanie robí partial match — "BILLA" nájde "BILLABONK", "Jozef Billa",
        "Patrik Billa". Pre overenie používame presný názov spoločnosti z ORSR
        (company_name) a porovnávame per-row, nie word-boundary na celom texte.
        """
        try:
            if await self._is_empty_page(page):
                return self._empty_findings()

            text_lower = (await page.inner_text("body")).lower()
            has_debt = "nedoplatok" in text_lower or "nedoplatky" in text_lower or "dlžník" in text_lower

            if has_debt:
                # Parse rows individually for per-row name verification
                rows = await self._parse_table_rows(page, max_rows=20)
                if rows:
                    # Extract headers to find "Názov subjektu" column
                    headers = await self._get_table_headers(page)
                    name_col_idx = self._find_name_column(headers)

                    # Use company_name (full, from ORSR) for verification — fallback to search_term
                    verify_name = company_name or search_term
                    norm_verify = _normalize_name(verify_name)

                    matched_rows = []
                    for row_data in rows:
                        row_name = row_data[name_col_idx] if name_col_idx is not None and name_col_idx < len(row_data) else ""
                        norm_row = _normalize_name(row_name)

                        if norm_verify and norm_row:
                            # Exact normalized match — "billa s r o" == "billa s r o"
                            # Also check without legal form suffix for robustness
                            matches = (
                                norm_verify == norm_row
                                or norm_verify.startswith(norm_row)
                                or norm_row.startswith(norm_verify)
                            )
                            if matches:
                                # Format this row
                                formatted = self._format_row(row_data, headers)
                                if formatted:
                                    matched_rows.append(formatted)
                            else:
                                logger.info(
                                    f"[{self.source_type}] Riadok vynechaný (name mismatch): "
                                    f"'{row_name}' != '{verify_name}'"
                                )

                    if matched_rows:
                        return f"POZOR: Subjekt '{verify_name}' je v zozname daňových dlžníkov.\n" + "\n\n".join(matched_rows)
                    else:
                        logger.info(
                            f"[{self.source_type}] Tabuľka nájdená, ale žiadny riadok sa nezhoduje "
                            f"s názvom '{verify_name}' — false positive (partial match)."
                        )
                        return self._empty_findings()

                # Fallback: no rows parsed, try old approach
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

    async def _get_table_headers(self, page: Page) -> list[str]:
        """Extrahuje hlavičku tabuľky."""
        try:
            header_loc = page.locator("table thead tr th, .table thead tr th, table thead tr td")
            count = await header_loc.count()
            headers = []
            for h in range(count):
                try:
                    headers.append((await header_loc.nth(h).inner_text(timeout=2000)).strip())
                except Exception:
                    headers.append("")
            return headers
        except Exception:
            return []

    @staticmethod
    def _find_name_column(headers: list[str]) -> Optional[int]:
        """Nájde index stĺpca 'Názov subjektu' (alebo podobného)."""
        for i, h in enumerate(headers):
            h_lower = h.lower()
            if "názov" in h_lower or "nazov" in h_lower or "meno" in h_lower:
                return i
        return None

    @staticmethod
    def _format_row(row_data: list[str], headers: list[str]) -> str:
        """Naformátuje jeden riadok tabuľky."""
        if headers and len(headers) >= len(row_data):
            parts = []
            for i, val in enumerate(row_data):
                if val and headers[i].lower() not in ("hľadať", "akcia"):
                    parts.append(f"{headers[i]}: {val}")
            return "\n".join(parts) if parts else ""
        else:
            parts = [f"• {val}" for val in row_data if val]
            return "\n".join(parts) if parts else ""

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

    async def _download_pdf(self, page: Page, output_path: Path, findings: str = None) -> bool:
        """Generuje PDF z výsledkovej stránky pomocou print-to-PDF namiesto Export do PDF.

        Finančná správa otvára popup s PDF viewerom, ktorý page.pdf() nedokáže
        zachytiť — výsledkom je prázdna stránka. Namiesto toho používame
        _generate_clean_pdf (rovnaký prístup ako ostatné debtor scrapery).
        """
        try:
            disclaimer_html = None
            if findings and "POZOR" in findings:
                disclaimer_html = findings.replace("\n", "<br/>")
            await self._generate_clean_pdf(
                page, output_path,
                title=self.pdf_title,
                disclaimer_html=disclaimer_html,
                content_selector="table, .table, .datagrid",
                format="A4",
                scale=0.9,
            )
            logger.info(f"[{self.source_type}] PDF vygenerované cez _generate_clean_pdf: {output_path}")
            return True
        except Exception as e:
            logger.warning(f"[{self.source_type}] _generate_clean_pdf zlyhal, skúšam fallback _download_pdf: {e}")
            return await super()._download_pdf(page, output_path, findings=findings)
