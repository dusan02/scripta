"""
Direct JSON parser for RÚZ SK GAAP financial statements (template Úč POD / 699).

Eliminates LLM hallucinations by extracting financial metrics directly from
the structured JSON tables returned by the RÚZ API.

Mapping is based on official template 699 from /api/sablona?id=699:
  - Table 0: "Strana aktív" (rows 1-78, 7 columns, 4 data columns)
  - Table 1: "Strana pasív" (rows 79-145, 5 columns, 2 data columns)
  - Table 2: "Výkaz ziskov a strát" (rows 1-61, 5 columns, 2 data columns)

Row indices (cisloRiadku) map to data[] positions via:
  - Aktív:  data_index = cisloRiadku - 1   (first row cisloRiadku=1)
  - Pasív:  data_index = cisloRiadku - 79  (first row cisloRiadku=79)
  - Income: data_index = cisloRiadku - 1   (first row cisloRiadku=1)
"""

from __future__ import annotations

import json
import logging
import re
from datetime import datetime
from pathlib import Path
from typing import Optional

from src.agents.shared import (
    AuditorReportData,
    CompanyFinancialExtraction,
    FinancialMetrics,
    VerificationConfidenceItem,
)

logger = logging.getLogger(__name__)

# ── Row indices (cisloRiadku from template 699) ──────────────────────────────

# Strana aktív (table 0)
ROW_TOTAL_ASSETS = 1
ROW_NON_CURRENT_ASSETS = 2      # Neobežný majetok (r.03 + r.11 + r.21)
ROW_INTANGIBLE_ASSETS = 3       # Dlhodobý nehmotný majetok súčet
ROW_TANGIBLE_ASSETS = 11        # Dlhodobý hmotný majetok súčet
ROW_LT_FINANCIAL_ASSETS = 21    # Dlhodobý finančný majetok súčet
ROW_CURRENT_ASSETS = 33
ROW_INVENTORY = 34
ROW_LT_RECEIVABLES = 41         # Dlhodobé pohľadávky súčet
ROW_TRADE_RECEIVABLES_TOTAL = 53  # Krátkodobé pohľadávky súčet
ROW_TRADE_RECEIVABLES = 54        # Pohľadávky z obchodného styku súčet
ROW_ST_FINANCIAL_ASSETS = 66    # Krátkodobý finančný majetok súčet
ROW_FINANCIAL_ACCOUNTS = 71       # Finančné účty
ROW_CASH = 72                     # Peniaze
ROW_DEFERRED_ASSETS = 74        # Časové rozlíšenie (aktív)

# Strana pasív (table 1)
ROW_TOTAL_EQUITY = 80
ROW_SHARE_CAPITAL = 81          # Základné imanie súčet
ROW_SHARE_PREMIUM = 85          # Emisné ážio
ROW_OTHER_CAPITAL_FUNDS = 86    # Ostatné kapitálové fondy
ROW_STATUTORY_RESERVES = 87     # Zákonné rezervné fondy
ROW_OTHER_PROFIT_FUNDS = 90     # Ostatné fondy zo zisku
ROW_RETAINED_EARNINGS = 97      # Výsledok hosp. minulých rokov (súčet)
ROW_RETAINED_PROFIT = 98        # Nerozdelený zisk minulých rokov
ROW_ACCUMULATED_LOSS = 99       # Neuhradená strata minulých rokov
ROW_CURRENT_YEAR_PROFIT = 100   # Výsledok hosp. za úč. obdobie po zdanení
ROW_TOTAL_LIABILITIES = 101
ROW_LT_LIABILITIES = 102
ROW_LT_RESERVES = 118           # Dlhodobé rezervy
ROW_LT_BANK_LOANS = 121
ROW_ST_LIABILITIES = 122
ROW_TRADE_PAYABLES = 123
ROW_ST_RESERVES = 136           # Krátkodobé rezervy
ROW_EMPLOYEE_LIAB = 131
ROW_SOCIAL_INS_LIAB = 132
ROW_TAX_LIAB = 133
ROW_ST_BANK_LOANS = 139
ROW_ST_FINANCIAL_ASSIST = 140   # Krátkodobé finančné výpomoci
ROW_RESERVES = 141  # Časové rozlíšenie (pasív)

# Výkaz ziskov a strát (table 2)
ROW_NET_REVENUE = 1
ROW_OPERATING_INCOME = 2        # Výnosy z hosp. činnosti spolu
ROW_OPERATING_COSTS = 10       # Náklady na hospodársku činnosť spolu (NOT COGS — includes wages, depreciation, services)
ROW_MATERIAL_CONSUMPTION = 12  # Spotreba materiálu, energie
ROW_SERVICES = 14              # Služby
ROW_PERSONNEL_COSTS = 15
ROW_WAGE_COSTS = 16            # Mzdové náklady (podmnožina osobných)
ROW_TAXES_FEES = 20            # Dane a poplatky
ROW_DEPRECIATION = 21
ROW_OPERATING_PROFIT = 27
ROW_VALUE_ADDED = 28
ROW_FINANCIAL_INCOME = 29
ROW_FINANCIAL_EXPENSES = 45
ROW_FINANCIAL_RESULT = 55      # Výsledok hosp. z fin. činnosti
ROW_INTEREST_EXPENSE = 49
ROW_PROFIT_BEFORE_TAX = 56
ROW_INCOME_TAX = 57
ROW_PROFIT_TRANSFER = 60       # Prevod podielov na výsledku spoločníkom
ROW_NET_PROFIT = 61

# Offsets to convert cisloRiadku → data[] index
_ACTIV_OFFSET = 1
_PASIV_OFFSET = 79
_INCOME_OFFSET = 1

# Column indices within a data row (0-indexed)
# Aktív: [Označenie, Text, ČísloRiadku, Brutto, Korekcia, Netto2, Netto3]
_ACTIV_CURRENT_NET_COL = 5   # Netto 2 = current period net
_ACTIV_PREV_NET_COL = 6      # Netto 3 = preceding period net

# Pasív: [Označenie, Text, ČísloRiadku, Bežné, Predchádzajúce]
_PASIV_CURRENT_COL = 3
_PASIV_PREV_COL = 4

# Income: [Označenie, Text, ČísloRiadku, Bežné, Predchádzajúce]
_INCOME_CURRENT_COL = 3
_INCOME_PREV_COL = 4


# ── Helpers ───────────────────────────────────────────────────────────────────

def _to_float(val) -> Optional[float]:
    """Safely convert a value to float.

    Handles Slovak formatting:
    - spaces/nbsp as thousand separators
    - comma as decimal separator
    - parentheses notation (1234) as negative numbers → -1234
    Returns None for empty/non-numeric values.
    """
    if val is None or val == "" or val == " ":
        return None
    if isinstance(val, bool):
        return None
    if isinstance(val, (int, float)):
        return float(val)
    if isinstance(val, str):
        cleaned = val.strip()
        if not cleaned:
            return None
        # Parentheses notation: (1234) → -1234 (Slovak accounting standard)
        is_negative = False
        if cleaned.startswith('(') and cleaned.endswith(')'):
            is_negative = True
            cleaned = cleaned[1:-1].strip()
        # Remove thousand separators (spaces/nbsp), keep last comma/dot as decimal
        cleaned = re.sub(r'[\s\xa0]', '', cleaned)
        if ',' in cleaned and '.' in cleaned:
            # Mixed: the last separator is the decimal separator
            last_comma = cleaned.rfind(',')
            last_dot = cleaned.rfind('.')
            if last_comma > last_dot:
                # Comma is decimal → dot is thousand
                cleaned = cleaned.replace('.', '').replace(',', '.')
            else:
                # Dot is decimal → comma is thousand
                cleaned = cleaned.replace(',', '')
        elif ',' in cleaned:
            # Only comma: assume decimal separator
            cleaned = cleaned.replace(',', '.')
        # If multiple dots remain (e.g. "1.234.567"), remove all but last
        if cleaned.count('.') > 1:
            parts = cleaned.split('.')
            cleaned = ''.join(parts[:-1]) + '.' + parts[-1]
        try:
            result = float(cleaned) if cleaned else None
            if result is not None and is_negative:
                result = -result
            return result
        except ValueError:
            return None
    return None


def _extract_row_value(row, data_cols: int, target_col: int) -> Optional[float]:
    """Extract a value from a specific data column in a row.

    Handles both full rows (with label columns prefixing data) and data-only rows.
    - data_cols: number of data columns for this table type (4 for aktiv, 2 for others)
    - target_col: 0-indexed position within the data columns
    """
    if row is None:
        return None

    if isinstance(row, list):
        if len(row) == data_cols:
            data_start = 0
        elif len(row) > data_cols:
            data_start = len(row) - data_cols
        else:
            return None
        idx = data_start + target_col
        if 0 <= idx < len(row):
            return _to_float(row[idx])
        return None

    # Some APIs may return scalar values for single-column data
    if isinstance(row, (int, float, str)) and data_cols == 1 and target_col == 0:
        return _to_float(row)

    return None


def _get_row(tables: list, table_idx: int, cislo_riadku: int, offset: int, data_cols: int = 0) -> Optional[list]:
    """Get a data row by cisloRiadku from a specific table.

    Handles two data formats from RUZ API:
    - List-of-lists: data[idx] = [val1, val2, ...] (older format)
    - Flat array: data is [val1, val2, val3, val4, val5, val6, ...] where each
      group of data_cols values represents one row (2025+ format)
    """
    if table_idx >= len(tables):
        return None
    data = tables[table_idx].get("data", [])
    idx = cislo_riadku - offset
    if not data or idx < 0:
        return None

    # Detect flat data format (scalars instead of lists)
    first = data[0]
    if not isinstance(first, list) and data_cols > 0:
        # Flat array — reshape: each row has data_cols values
        start = idx * data_cols
        if start + data_cols <= len(data):
            return data[start : start + data_cols]
        return None

    # Standard list-of-lists format
    if idx < len(data):
        return data[idx]
    return None


def _get_activ_value(tables: list, cislo_riadku: int, current: bool = True) -> Optional[float]:
    """Extract current or preceding period value from Strana aktív.

    Aktív has 4 data columns: [Brutto, Korekcia, Netto2 (current), Netto3 (preceding)].
    We use Netto (column index 2) for current period.
    """
    row = _get_row(tables, 0, cislo_riadku, _ACTIV_OFFSET, data_cols=4)
    if row is None:
        return None
    target = 2 if current else 3  # Netto2 / Netto3
    return _extract_row_value(row, 4, target)


def _get_pasiv_value(tables: list, cislo_riadku: int, current: bool = True) -> Optional[float]:
    """Extract current or preceding period value from Strana pasív."""
    row = _get_row(tables, 1, cislo_riadku, _PASIV_OFFSET, data_cols=2)
    if row is None:
        return None
    target = 0 if current else 1
    return _extract_row_value(row, 2, target)


def _get_income_value(tables: list, cislo_riadku: int, current: bool = True) -> Optional[float]:
    """Extract current or preceding period value from Výkaz ziskov a strát."""
    row = _get_row(tables, 2, cislo_riadku, _INCOME_OFFSET, data_cols=2)
    if row is None:
        return None
    target = 0 if current else 1
    return _extract_row_value(row, 2, target)


def _identify_tables(tables: list) -> dict[str, int]:
    """Identify table indices by their Slovak names.

    Returns a dict mapping 'aktiv', 'pasiv', 'income' to table indices.
    Logs available table names if mandatory tables (aktiv/pasiv) are not found.
    """
    result = {}
    for i, tab in enumerate(tables):
        nazov = tab.get("nazov", {}).get("sk", "").lower()
        if "strana akt" in nazov or "aktív" in nazov or ("akt" in nazov and "pas" not in nazov):
            result["aktiv"] = i
        elif "strana pas" in nazov or "pasív" in nazov or "pas" in nazov:
            result["pasiv"] = i
        elif "ziskov a str" in nazov or "profit and loss" in nazov or "výsledovka" in nazov:
            result["income"] = i

    if "aktiv" not in result or "pasiv" not in result:
        available = [t.get("nazov", {}).get("sk", "?") for t in tables]
        logger.warning(
            f"[RUZ_PARSER] Required tables not found (found: {list(result.keys())}). "
            f"Available table names: {available}"
        )

    return result


def _compute_months(obdobie_od: str, obdobie_do: str) -> Optional[int]:
    """Compute number of months between two date strings."""
    try:
        d_from = datetime.strptime(obdobie_od[:10], "%Y-%m-%d")
        d_to = datetime.strptime(obdobie_do[:10], "%Y-%m-%d")
        months = (d_to.year - d_from.year) * 12 + (d_to.month - d_from.month) + 1
        return months if 1 <= months <= 24 else None
    except (ValueError, TypeError):
        return None


# ── Sanity checks ─────────────────────────────────────────────────────────────

def _sanity_check(metrics: FinancialMetrics, total_liabilities_exact: Optional[float] = None) -> list[str]:
    """Validate financial consistency. Returns list of warning messages."""
    warnings = []

    # Check 1: assets ≈ equity + total liabilities
    # Prefer exact total liabilities (row 101) which includes reserves and other liabilities.
    # Fall back to LT + ST if row 101 is not available.
    assets = metrics.celkove_aktiva
    equity = metrics.vlastne_imanie_celkom
    if total_liabilities_exact is not None:
        total_liab = total_liabilities_exact
    else:
        total_liab = (metrics.dlhodobe_zavazky or 0) + (metrics.kratkodobe_zavazky or 0)

    if assets is not None and equity is not None and abs(assets) > 0:
        expected_assets = equity + total_liab
        diff = abs(assets - expected_assets)
        rel = diff / abs(assets)
        if rel > 0.15:
            warnings.append(
                f"Balance sheet large mismatch: assets={assets:.0f} vs equity+liabilities={expected_assets:.0f} "
                f"(diff={diff:.0f}, {rel*100:.1f}%) — possible parsing error or other liabilities"
            )
        elif rel > 0.05:
            warnings.append(
                f"Balance sheet minor gap: assets={assets:.0f} vs equity+liabilities={expected_assets:.0f} "
                f"(diff={diff:.0f}, {rel*100:.1f}%) — likely accruals/other items not captured"
            )

    # Check 2: revenue should be non-negative
    if metrics.trzby_z_hlavnej_cinnosti is not None and metrics.trzby_z_hlavnej_cinnosti < 0:
        warnings.append(f"Revenue is negative: {metrics.trzby_z_hlavnej_cinnosti}")

    # Check 3: personnel costs should be non-negative
    if metrics.osobne_naklady is not None and metrics.osobne_naklady < 0:
        warnings.append(f"Personnel costs are negative: {metrics.osobne_naklady}")

    return warnings


def _estimate_cf(
    net_profit: Optional[float],
    depreciation: Optional[float],
    inventory_curr: Optional[float],
    inventory_prev: Optional[float],
    receivables_curr: Optional[float],
    receivables_prev: Optional[float],
    payables_curr: Optional[float],
    payables_prev: Optional[float],
) -> Optional[float]:
    """Indirect-method operating cash flow estimate.

    CF ≈ Net Profit + Depreciation - ΔInventory - ΔReceivables + ΔPayables
    Returns None if required inputs are missing.
    """
    if net_profit is None or depreciation is None:
        return None
    cf = net_profit + depreciation
    # Apply working capital adjustments only when both periods are available
    if inventory_curr is not None and inventory_prev is not None:
        cf -= (inventory_curr - inventory_prev)
    if receivables_curr is not None and receivables_prev is not None:
        cf -= (receivables_curr - receivables_prev)
    if payables_curr is not None and payables_prev is not None:
        cf += (payables_curr - payables_prev)
    return round(cf, 2)


# ── Main parser ───────────────────────────────────────────────────────────────

def parse_tables_to_metrics(
    tables: list[dict],
    titulna_strana: dict,
    ico: str,
    id_sablony: Optional[int] = None,
) -> Optional[FinancialMetrics]:
    """Parse RÚZ JSON tables into FinancialMetrics.

    Args:
        tables: List of table dicts from obsah.tabulky (across all výkazy for one závierka)
        titulna_strana: obsah.titulnaStrana dict
        ico: Company IČO
        id_sablony: RÚZ template ID (699 = standard SK GAAP). If provided and not 699,
            extended fields (asset/equity composition) are skipped to avoid row-index mismatch.

    Returns:
        FinancialMetrics if parsing succeeds, None otherwise
    """
    if not tables:
        return None

    # Template guard: šablóna 699 je jediná s overeným row mappingom.
    # Konsolidované závierky (684) a iné šablóny majú odlišné číslovanie riadkov.
    # Pre ne preskočíme extrakciu nových polí (asset/equity composition).
    extended_fields_ok = (id_sablony is None or id_sablony == 699)
    if not extended_fields_ok:
        logger.warning(
            f"[RUZ_PARSER] IČO {ico}: neznáma šablóna {id_sablony} — "
            "preskakujem extrakciu rozšírených polí (asset/equity composition)"
        )

    # Identify table indices by name
    tab_map = _identify_tables(tables)
    if "aktiv" not in tab_map or "pasiv" not in tab_map:
        logger.debug(f"[RUZ_PARSER] Missing aktív/pasív tables — skipping (tables: {list(tab_map.keys())})")
        return None

    # Reorder tables so aktív=0, pasív=1, income=2 (if present)
    ordered = []
    ordered.append(tables[tab_map["aktiv"]])
    ordered.append(tables[tab_map["pasiv"]])
    if "income" in tab_map:
        ordered.append(tables[tab_map["income"]])

    # Extract period info from titulnaStrana
    obdobie_od = titulna_strana.get("obdobieOd", "")
    obdobie_do = titulna_strana.get("obdobieDo", "")
    konsolidovana = titulna_strana.get("konsolidovana", False)

    # ── Unit detection: EUR vs tisíce EUR ──
    # RÚZ JSON zvyčajne vracia hodnoty v EUR. Niektoré výkazy však používajú tisíce EUR.
    # Detekcia: ak celkové aktíva < 1000 pre bežnú firmu, pravdepodobne sú to tisíce EUR.
    # RÚZ API neposkytuje explicitné pole pre jednotky, tak použijeme heuristiku:
    #   - Ak total_assets < 1000 a zároveň pocet_zamestnancov > 10, pravdepodobne tisíce EUR
    #   - Pri tisícoch EUR násobíme všetky hodnoty × 1000
    unit_multiplier = 1.0
    _preliminary_assets = _get_activ_value(ordered, ROW_TOTAL_ASSETS)
    _preliminary_zam = titulna_strana.get("pocetZamestnancov") or titulna_strana.get("priemernyPocetZamestnancov")
    if _preliminary_assets is not None and _preliminary_zam is not None:
        try:
            zam_int = int(float(_preliminary_zam))
            # Heuristic: if assets < 5000 and employees > 5,
            # the values are likely in thousands of EUR rather than EUR.
            # Additional guard: assets per employee should be > 1 EUR if unit=EUR,
            # so assets < 5000 with many employees strongly implies thousands.
            if abs(_preliminary_assets) < 5000 and zam_int > 5:
                unit_multiplier = 1000.0
                logger.warning(
                    f"[RUZ_PARSER] IČO {ico}: detekované tisíce EUR "
                    f"(assets={_preliminary_assets}, zamestnanci={zam_int}) — násobím ×1000"
                )
        except (ValueError, TypeError):
            pass

    # Extract year from obdobieDo (ISO or Slovak date string)
    year = None
    if obdobie_do:
        m = re.search(r'(20\d{2})', str(obdobie_do))
        if m:
            try:
                year = int(m.group(1))
                if year > datetime.now().year + 1:
                    logger.warning(f"[RUZ_PARSER] IČO {ico}: suspicious future year {year} from obdobieDo='{obdobie_do}' — skipping")
                    return None
            except (ValueError, TypeError):
                pass
    if year is None:
        logger.warning("[RUZ_PARSER] Could not extract year from obdobieDo")
        return None

    # Počet zamestnancov
    pocet_zam = titulna_strana.get("pocetZamestnancov") or titulna_strana.get("priemernyPocetZamestnancov")
    pocet_zam_int = None
    if pocet_zam is not None:
        try:
            pocet_zam_int = int(float(pocet_zam))
        except (ValueError, TypeError):
            pass

    # Compute months in period
    months = _compute_months(obdobie_od, obdobie_do)

    # ── Extract metrics from tables ──
    has_income = len(ordered) > 2

    # Balance sheet — aktív
    celkove_aktiva = _get_activ_value(ordered, ROW_TOTAL_ASSETS)
    obezny_majetok = _get_activ_value(ordered, ROW_CURRENT_ASSETS)
    zasoby = _get_activ_value(ordered, ROW_INVENTORY)
    peniaze = _get_activ_value(ordered, ROW_CASH)
    pohladavky = _get_activ_value(ordered, ROW_TRADE_RECEIVABLES)

    # ── Cash fallback: ak riadok 72 (Peniaze) je 0 alebo None, skús alternatívne riadky ──
    # Niektoré firmy (najmä veľké akciové spoločnosti) vykazujú hotovosť na riadku 71
    # (Finančné účty) alebo 66 (Krátkodobý finančný majetok súčet) namiesto 72.
    if not peniaze or peniaze == 0:
        _alt_cash = _get_activ_value(ordered, ROW_FINANCIAL_ACCOUNTS)  # riadok 71
        if _alt_cash and _alt_cash > 0:
            logger.info(f"[RUZ_PARSER] IČO {ico} rok {year}: cash fallback riadok 71 (Finančné účty) = {_alt_cash}")
            peniaze = _alt_cash
        else:
            _alt_cash2 = _get_activ_value(ordered, ROW_ST_FINANCIAL_ASSETS)  # riadok 66
            if _alt_cash2 and _alt_cash2 > 0:
                logger.info(f"[RUZ_PARSER] IČO {ico} rok {year}: cash fallback riadok 66 (Krátkodobý fin. majetok) = {_alt_cash2}")
                peniaze = _alt_cash2

    # ── Asset composition (extended fields — only for template 699) ──
    neobezny_majetok = None
    dlhodoby_nehmotny_majetok = None
    dlhodoby_hmotny_majetok = None
    dlhodoby_financny_majetok = None
    dlhodobe_pohladavky = None
    kratkodoby_financny_majetok = None
    casove_rozlisenie_aktiv = None
    if extended_fields_ok:
        neobezny_majetok = _get_activ_value(ordered, ROW_NON_CURRENT_ASSETS)
        dlhodoby_nehmotny_majetok = _get_activ_value(ordered, ROW_INTANGIBLE_ASSETS)
        dlhodoby_hmotny_majetok = _get_activ_value(ordered, ROW_TANGIBLE_ASSETS)
        dlhodoby_financny_majetok = _get_activ_value(ordered, ROW_LT_FINANCIAL_ASSETS)
        dlhodobe_pohladavky = _get_activ_value(ordered, ROW_LT_RECEIVABLES)
        kratkodoby_financny_majetok = _get_activ_value(ordered, ROW_ST_FINANCIAL_ASSETS)
        casove_rozlisenie_aktiv = _get_activ_value(ordered, ROW_DEFERRED_ASSETS)

    # Balance sheet — pasív
    vlastne_imanie = _get_pasiv_value(ordered, ROW_TOTAL_EQUITY)
    celkove_cudzie_zdroje = _get_pasiv_value(ordered, ROW_TOTAL_LIABILITIES)
    dlhodobe_zavazky = _get_pasiv_value(ordered, ROW_LT_LIABILITIES)
    kratkodobe_zavazky = _get_pasiv_value(ordered, ROW_ST_LIABILITIES)
    zavazky_obchod = _get_pasiv_value(ordered, ROW_TRADE_PAYABLES)
    zavazky_zamestnanci = _get_pasiv_value(ordered, ROW_EMPLOYEE_LIAB)
    zavazky_sp = _get_pasiv_value(ordered, ROW_SOCIAL_INS_LIAB)
    danove_zavazky = _get_pasiv_value(ordered, ROW_TAX_LIAB)

    # ── Equity composition + reserves (extended fields — only for template 699) ──
    zakladne_imanie = None
    emisione_azio = None
    ostatne_kapitalove_fondy = None
    zakonne_rezervne_fondy = None
    ostatne_fondy_zo_zisku = None
    vysledok_minuly_rokov = None
    nerozdeleny_zisk = None
    neuhradena_strata = None
    vysledok_beziaceho_roka = None
    dlhodobe_rezervy = None
    kratkodobe_rezervy = None
    bezne_bankove_uvery = None
    kratkodobe_financne_vypomoci = None
    if extended_fields_ok:
        zakladne_imanie = _get_pasiv_value(ordered, ROW_SHARE_CAPITAL)
        emisione_azio = _get_pasiv_value(ordered, ROW_SHARE_PREMIUM)
        ostatne_kapitalove_fondy = _get_pasiv_value(ordered, ROW_OTHER_CAPITAL_FUNDS)
        zakonne_rezervne_fondy = _get_pasiv_value(ordered, ROW_STATUTORY_RESERVES)
        ostatne_fondy_zo_zisku = _get_pasiv_value(ordered, ROW_OTHER_PROFIT_FUNDS)
        vysledok_minuly_rokov = _get_pasiv_value(ordered, ROW_RETAINED_EARNINGS)
        nerozdeleny_zisk = _get_pasiv_value(ordered, ROW_RETAINED_PROFIT)
        neuhradena_strata = _get_pasiv_value(ordered, ROW_ACCUMULATED_LOSS)
        vysledok_beziaceho_roka = _get_pasiv_value(ordered, ROW_CURRENT_YEAR_PROFIT)
        dlhodobe_rezervy = _get_pasiv_value(ordered, ROW_LT_RESERVES)
        kratkodobe_rezervy = _get_pasiv_value(ordered, ROW_ST_RESERVES)
        bezne_bankove_uvery = _get_pasiv_value(ordered, ROW_ST_BANK_LOANS)
        kratkodobe_financne_vypomoci = _get_pasiv_value(ordered, ROW_ST_FINANCIAL_ASSIST)

    # Income statement
    trzby = _get_income_value(ordered, ROW_NET_REVENUE) if has_income else None
    osobne_naklady = _get_income_value(ordered, ROW_PERSONNEL_COSTS) if has_income else None
    odpisy = _get_income_value(ordered, ROW_DEPRECIATION) if has_income else None
    uroky = _get_income_value(ordered, ROW_INTEREST_EXPENSE) if has_income else None
    zisk_po_zdaneni = _get_income_value(ordered, ROW_NET_PROFIT) if has_income else None

    # ── Income statement detail (extended fields — only for template 699) ──
    naklady_na_hosp_cinnost = None
    spotreba_materialu = None
    sluzby = None
    mzdove_naklady = None
    dane_a_poplatky = None
    vysledok_z_fin_cinnosti = None
    zisk_pred_zdanenim = None
    dan_z_prijmu_val = None
    prevod_podielov_spolocnikom = None
    if extended_fields_ok and has_income:
        naklady_na_hosp_cinnost = _get_income_value(ordered, ROW_OPERATING_COSTS)
        spotreba_materialu = _get_income_value(ordered, ROW_MATERIAL_CONSUMPTION)
        sluzby = _get_income_value(ordered, ROW_SERVICES)
        mzdove_naklady = _get_income_value(ordered, ROW_WAGE_COSTS)
        dane_a_poplatky = _get_income_value(ordered, ROW_TAXES_FEES)
        vysledok_z_fin_cinnosti = _get_income_value(ordered, ROW_FINANCIAL_RESULT)
        zisk_pred_zdanenim = _get_income_value(ordered, ROW_PROFIT_BEFORE_TAX)
        dan_z_prijmu_val = _get_income_value(ordered, ROW_INCOME_TAX)
        prevod_podielov_spolocnikom = _get_income_value(ordered, ROW_PROFIT_TRANSFER)

    # If revenue is None, try operating income total as fallback
    if trzby is None and has_income:
        trzby = _get_income_value(ordered, ROW_OPERATING_INCOME)

    # Hrubá marža: Tržby - (Spotreba materiálu + Služby) ako proxy pre COGS v SK GAAP
    # Riadok 10 (náklady na hosp. činnosť spolu) zahŕňa aj mzdy, odpisy → nie je COGS.
    # Fallback: Pridaná hodnota (riadok 28) ako najbližšie proxy z SK GAAP výkazu.
    hruba_marza = None
    if has_income:
        spotreba = _get_income_value(ordered, ROW_MATERIAL_CONSUMPTION)
        sluzby_val = _get_income_value(ordered, ROW_SERVICES)
        cogs_proxy = None
        if spotreba is not None or sluzby_val is not None:
            cogs_proxy = (spotreba or 0) + (sluzby_val or 0)
        if trzby is not None and cogs_proxy is not None and cogs_proxy > 0:
            hruba_marza = trzby - cogs_proxy
        if hruba_marza is None:
            # Fallback: Pridaná hodnota (proxy pre hrubú maržu v SK GAAP)
            hruba_marza = _get_income_value(ordered, ROW_VALUE_ADDED)

    # ── Per-field unit sanity check ──
    # RÚZ JSON občas vracia detailné P&L riadky (spotreba materiálu, náklady na hosp.
    # činnosť) v tisícoch EUR, zatiaľ čo súhrnné riadky (tržby) sú v EUR — alebo naopak.
    # Heuristika: pri tržbách > 100M € je spotreba materiálu < 0.1% tržieb ekonomicky
    # nemožná → hodnota je takmer isto v tisícoch → ×1000.
    # Overené na KIA (35876832): 2025 spotreba=5 459 634 → ×1000 = 5.46B (76% tržieb ✓)
    def _fix_thousands(val: Optional[float], ref: Optional[float], field_name: str) -> Optional[float]:
        if val is None or ref is None or ref <= 100_000_000:
            return val
        # Handle both positive and negative values (e.g. profitBeforeTax can be negative)
        if 0 < abs(val) < ref * 0.001 and abs(val) * 1000 <= ref * 2:
            logger.warning(
                f"[RUZ_PARSER] IČO {ico}: {field_name}={val:.0f} je podozrivo malá "
                f"voči tržbám {ref:.0f} — pravdepodobne tisíce EUR, násobím ×1000"
            )
            return val * 1000
        return val

    if has_income and trzby is not None:
        naklady_na_hosp_cinnost = _fix_thousands(naklady_na_hosp_cinnost, trzby, "naklady_na_hosp_cinnost")
        spotreba_materialu = _fix_thousands(spotreba_materialu, trzby, "spotreba_materialu")
        sluzby = _fix_thousands(sluzby, trzby, "sluzby")
        mzdove_naklady = _fix_thousands(mzdove_naklady, trzby, "mzdove_naklady")
        # dane_a_poplatky je prirodzene malá hodnota (typicky 0.05-0.5% tržieb)
        # — heuristika < 0.1% by falošne označila legitímne hodnoty za tisíce EUR
        # zisk_pred_zdanenim, dan_z_prijmu a uroky: pre veľké firmy (>100M € tržby)
        # je hodnota < 0.1% tržieb takmer isto v tisícoch EUR. Heuristika
        # abs(val)*1000 <= ref*2 zabraňuje falošným pozitívam (napr. pre low-margin
        # firmy s reálne malým PBT by ×1000 prevýšilo tržby).
        # Bug: bez tejto opravy vznikal mismatch jednotiek — PBT v tisícoch EUR,
        # ale dan_z_prijmu v EUR → efektívna daňová sadzba 24 087% namiesto 24%.
        zisk_pred_zdanenim = _fix_thousands(zisk_pred_zdanenim, trzby, "zisk_pred_zdanenim")
        dan_z_prijmu_val = _fix_thousands(dan_z_prijmu_val, trzby, "dan_z_prijmu")
        uroky = _fix_thousands(uroky, trzby, "uroky")
        vysledok_z_fin_cinnosti = _fix_thousands(vysledok_z_fin_cinnosti, trzby, "vysledok_z_fin_cinnosti")

    # ── Apply unit multiplier (EUR vs tisíce EUR) ──
    if unit_multiplier != 1.0:
        celkove_aktiva = celkove_aktiva * unit_multiplier if celkove_aktiva is not None else None
        obezny_majetok = obezny_majetok * unit_multiplier if obezny_majetok is not None else None
        zasoby = zasoby * unit_multiplier if zasoby is not None else None
        peniaze = peniaze * unit_multiplier if peniaze is not None else None
        pohladavky = pohladavky * unit_multiplier if pohladavky is not None else None
        vlastne_imanie = vlastne_imanie * unit_multiplier if vlastne_imanie is not None else None
        dlhodobe_zavazky = dlhodobe_zavazky * unit_multiplier if dlhodobe_zavazky is not None else None
        kratkodobe_zavazky = kratkodobe_zavazky * unit_multiplier if kratkodobe_zavazky is not None else None
        zavazky_obchod = zavazky_obchod * unit_multiplier if zavazky_obchod is not None else None
        zavazky_zamestnanci = zavazky_zamestnanci * unit_multiplier if zavazky_zamestnanci is not None else None
        zavazky_sp = zavazky_sp * unit_multiplier if zavazky_sp is not None else None
        danove_zavazky = danove_zavazky * unit_multiplier if danove_zavazky is not None else None
        trzby = trzby * unit_multiplier if trzby is not None else None
        osobne_naklady = osobne_naklady * unit_multiplier if osobne_naklady is not None else None
        odpisy = odpisy * unit_multiplier if odpisy is not None else None
        uroky = uroky * unit_multiplier if uroky is not None else None
        zisk_po_zdaneni = zisk_po_zdaneni * unit_multiplier if zisk_po_zdaneni is not None else None
        hruba_marza = hruba_marza * unit_multiplier if hruba_marza is not None else None
        # Extended asset composition
        neobezny_majetok = neobezny_majetok * unit_multiplier if neobezny_majetok is not None else None
        dlhodoby_nehmotny_majetok = dlhodoby_nehmotny_majetok * unit_multiplier if dlhodoby_nehmotny_majetok is not None else None
        dlhodoby_hmotny_majetok = dlhodoby_hmotny_majetok * unit_multiplier if dlhodoby_hmotny_majetok is not None else None
        dlhodoby_financny_majetok = dlhodoby_financny_majetok * unit_multiplier if dlhodoby_financny_majetok is not None else None
        dlhodobe_pohladavky = dlhodobe_pohladavky * unit_multiplier if dlhodobe_pohladavky is not None else None
        kratkodoby_financny_majetok = kratkodoby_financny_majetok * unit_multiplier if kratkodoby_financny_majetok is not None else None
        casove_rozlisenie_aktiv = casove_rozlisenie_aktiv * unit_multiplier if casove_rozlisenie_aktiv is not None else None
        # Extended equity composition + reserves
        zakladne_imanie = zakladne_imanie * unit_multiplier if zakladne_imanie is not None else None
        emisione_azio = emisione_azio * unit_multiplier if emisione_azio is not None else None
        ostatne_kapitalove_fondy = ostatne_kapitalove_fondy * unit_multiplier if ostatne_kapitalove_fondy is not None else None
        zakonne_rezervne_fondy = zakonne_rezervne_fondy * unit_multiplier if zakonne_rezervne_fondy is not None else None
        ostatne_fondy_zo_zisku = ostatne_fondy_zo_zisku * unit_multiplier if ostatne_fondy_zo_zisku is not None else None
        vysledok_minuly_rokov = vysledok_minuly_rokov * unit_multiplier if vysledok_minuly_rokov is not None else None
        nerozdeleny_zisk = nerozdeleny_zisk * unit_multiplier if nerozdeleny_zisk is not None else None
        neuhradena_strata = neuhradena_strata * unit_multiplier if neuhradena_strata is not None else None
        vysledok_beziaceho_roka = vysledok_beziaceho_roka * unit_multiplier if vysledok_beziaceho_roka is not None else None
        dlhodobe_rezervy = dlhodobe_rezervy * unit_multiplier if dlhodobe_rezervy is not None else None
        kratkodobe_rezervy = kratkodobe_rezervy * unit_multiplier if kratkodobe_rezervy is not None else None
        bezne_bankove_uvery = bezne_bankove_uvery * unit_multiplier if bezne_bankove_uvery is not None else None
        kratkodobe_financne_vypomoci = kratkodobe_financne_vypomoci * unit_multiplier if kratkodobe_financne_vypomoci is not None else None
        # Extended income statement
        naklady_na_hosp_cinnost = naklady_na_hosp_cinnost * unit_multiplier if naklady_na_hosp_cinnost is not None else None
        spotreba_materialu = spotreba_materialu * unit_multiplier if spotreba_materialu is not None else None
        sluzby = sluzby * unit_multiplier if sluzby is not None else None
        mzdove_naklady = mzdove_naklady * unit_multiplier if mzdove_naklady is not None else None
        dane_a_poplatky = dane_a_poplatky * unit_multiplier if dane_a_poplatky is not None else None
        vysledok_z_fin_cinnosti = vysledok_z_fin_cinnosti * unit_multiplier if vysledok_z_fin_cinnosti is not None else None
        zisk_pred_zdanenim = zisk_pred_zdanenim * unit_multiplier if zisk_pred_zdanenim is not None else None
        dan_z_prijmu_val = dan_z_prijmu_val * unit_multiplier if dan_z_prijmu_val is not None else None
        prevod_podielov_spolocnikom = prevod_podielov_spolocnikom * unit_multiplier if prevod_podielov_spolocnikom is not None else None

    # ── Estimate operating CF (indirect method) using current + previous period ──
    # Previous period values are available in the same závierka JSON (Netto3 / Predchádzajúce columns)
    peniaze_prev = _get_activ_value(ordered, ROW_CASH, current=False)
    zasoby_prev = _get_activ_value(ordered, ROW_INVENTORY, current=False)
    pohladavky_prev = _get_activ_value(ordered, ROW_TRADE_RECEIVABLES, current=False)
    zavazky_obchod_prev = _get_pasiv_value(ordered, ROW_TRADE_PAYABLES, current=False)

    # Apply unit multiplier to prev-period values too
    if unit_multiplier != 1.0:
        zasoby_prev = zasoby_prev * unit_multiplier if zasoby_prev is not None else None
        pohladavky_prev = pohladavky_prev * unit_multiplier if pohladavky_prev is not None else None
        zavazky_obchod_prev = zavazky_obchod_prev * unit_multiplier if zavazky_obchod_prev is not None else None

    estimated_ocf = _estimate_cf(
        net_profit=zisk_po_zdaneni,
        depreciation=odpisy,
        inventory_curr=zasoby,
        inventory_prev=zasoby_prev,
        receivables_curr=pohladavky,
        receivables_prev=pohladavky_prev,
        payables_curr=zavazky_obchod,
        payables_prev=zavazky_obchod_prev,
    )
    if estimated_ocf is not None:
        logger.debug(f"[RUZ_PARSER] IČO {ico} rok {year}: estimated OCF = {estimated_ocf:.0f} (indirect method)")

    # ── Datum zostavenia závierky (forenzný signál) ──
    datum_zostavenia = titulna_strana.get("datumZostavenia") or titulna_strana.get("datumZostaveniaK")
    datum_schvalenia = titulna_strana.get("datumSchvalenia")

    # Build FinancialMetrics
    metrics = FinancialMetrics(
        rok_zavierky=year,
        celkove_aktiva=celkove_aktiva,
        obezny_majetok=obezny_majetok,
        vlastne_imanie_celkom=vlastne_imanie,
        kratkodobe_zavazky=kratkodobe_zavazky,
        dlhodobe_zavazky=dlhodobe_zavazky,
        trzby_z_hlavnej_cinnosti=trzby,
        hruba_marza=hruba_marza,
        zisk_alebo_strata_po_zdaneni=zisk_po_zdaneni,
        peniaze_a_penazne_ekvivalenty_k_31_12=peniaze,
        ciste_penazne_toky_z_prevadzkovej_cinnosti=estimated_ocf,  # Indirect-method estimate
        osobne_naklady=osobne_naklady,
        pohladavky_z_obchodneho_styku=pohladavky,
        zavazky_z_obchodneho_styku=zavazky_obchod,
        zasoby=zasoby,
        odpisy=odpisy,
        investicny_cash_flow=None,
        financny_cash_flow=None,
        uroky=uroky,
        pocet_zamestnancov=pocet_zam_int,
        zavazky_sp=zavazky_sp,
        danove_zavazky=danove_zavazky,
        zavazky_zamestnanci=zavazky_zamestnanci,
        mena="EUR",
        typ_zavierky="SK_GAAP",
        pocet_mesiacov_obdobia=months,
        is_consolidated=konsolidovana,
        # ── Extended fields (template 699 only) ──
        neobezny_majetok=neobezny_majetok,
        dlhodoby_nehmotny_majetok=dlhodoby_nehmotny_majetok,
        dlhodoby_hmotny_majetok=dlhodoby_hmotny_majetok,
        dlhodoby_financny_majetok=dlhodoby_financny_majetok,
        dlhodobe_pohladavky=dlhodobe_pohladavky,
        kratkodoby_financny_majetok=kratkodoby_financny_majetok,
        casove_rozlisenie_aktiv=casove_rozlisenie_aktiv,
        zakladne_imanie=zakladne_imanie,
        emisione_azio=emisione_azio,
        ostatne_kapitalove_fondy=ostatne_kapitalove_fondy,
        zakonne_rezervne_fondy=zakonne_rezervne_fondy,
        ostatne_fondy_zo_zisku=ostatne_fondy_zo_zisku,
        vysledok_minuly_rokov=vysledok_minuly_rokov,
        nerozdeleny_zisk=nerozdeleny_zisk,
        neuhradena_strata=neuhradena_strata,
        vysledok_beziaceho_roka=vysledok_beziaceho_roka,
        dlhodobe_rezervy=dlhodobe_rezervy,
        kratkodobe_rezervy=kratkodobe_rezervy,
        bezne_bankove_uvery=bezne_bankove_uvery,
        kratkodobe_financne_vypomoci=kratkodobe_financne_vypomoci,
        naklady_na_hosp_cinnost=naklady_na_hosp_cinnost,
        spotreba_materialu=spotreba_materialu,
        sluzby=sluzby,
        mzdove_naklady=mzdove_naklady,
        dane_a_poplatky=dane_a_poplatky,
        vysledok_z_fin_cinnosti=vysledok_z_fin_cinnosti,
        zisk_pred_zdanenim=zisk_pred_zdanenim,
        dan_z_prijmu=dan_z_prijmu_val,
        prevod_podielov_spolocnikom=prevod_podielov_spolocnikom,
        datum_zostavenia=datum_zostavenia,
        datum_schvalenia=datum_schvalenia,
    )

    # Sanity checks
    warnings = _sanity_check(metrics, total_liabilities_exact=celkove_cudzie_zdroje)
    if warnings:
        for w in warnings:
            logger.warning(f"[RUZ_PARSER] IČO {ico} rok {year}: {w}")
    else:
        logger.info(f"[RUZ_PARSER] IČO {ico} rok {year}: sanity checks passed")

    return metrics


def _parse_single_vykaz(vykaz: dict, ico: str) -> Optional[FinancialMetrics]:
    """Internal helper: parse a single výkaz JSON into FinancialMetrics.

    Args:
        vykaz: Full výkaz dict from RÚZ API (uctovny-vykaz)
        ico: Company IČO

    Returns:
        FinancialMetrics if parsing succeeds, None otherwise
    """
    obsah = vykaz.get("obsah", {})
    tables = obsah.get("tabulky", [])
    titulna = obsah.get("titulnaStrana", {})
    id_sablony = vykaz.get("idSablony")

    if not tables:
        return None

    return parse_tables_to_metrics(tables, titulna, ico, id_sablony=id_sablony)


def parse_zavierka_to_metrics(
    vykazy: list[dict],
    ico: str,
    titulna_strana: Optional[dict] = None,
) -> Optional[FinancialMetrics]:
    """Parse all výkazy from one závierka into FinancialMetrics.

    Collects tables from all výkazy (Súvaha, Výkaz ziskov a strát, etc.)
    and merges them into a single FinancialMetrics object.

    Args:
        vykazy: List of výkaz dicts from RÚZ API
        ico: Company IČO
        titulna_strana: Optional titulnaStrana dict (if not provided, uses first výkaz)

    Returns:
        FinancialMetrics if parsing succeeds, None otherwise
    """
    all_tables = []
    ts = titulna_strana or {}
    id_sablony: Optional[int] = None

    for vykaz in vykazy:
        obsah = vykaz.get("obsah", {})
        tables = obsah.get("tabulky", [])
        if tables:
            all_tables.extend(tables)
            # Capture idSablony from the first výkaz that has tables
            if id_sablony is None:
                id_sablony = vykaz.get("idSablony")
        if not ts:
            ts = obsah.get("titulnaStrana", {})

    if not all_tables:
        return None

    return parse_tables_to_metrics(all_tables, ts, ico, id_sablony=id_sablony)


def metrics_to_extraction(
    metrics: FinancialMetrics,
    ico: str,
    company_name: str = "",
) -> CompanyFinancialExtraction:
    """Wrap FinancialMetrics in CompanyFinancialExtraction for pipeline compatibility.

    All fields get HIGH confidence since they are deterministically parsed.
    """
    confidence_fields = [
        "celkove_aktiva", "obezny_majetok", "vlastne_imanie_celkom",
        "kratkodobe_zavazky", "dlhodobe_zavazky", "trzby_z_hlavnej_cinnosti",
        "hruba_marza", "zisk_alebo_strata_po_zdaneni",
        "peniaze_a_penazne_ekvivalenty_k_31_12", "osobne_naklady",
        "pohladavky_z_obchodneho_styku", "zavazky_z_obchodneho_styku",
        "zasoby", "odpisy", "uroky", "pocet_zamestnancov",
        "zavazky_sp", "danove_zavazky", "zavazky_zamestnanci",
    ]
    verification_confidence = [
        VerificationConfidenceItem(field=f, confidence="HIGH")
        for f in confidence_fields
        if getattr(metrics, f, None) is not None
    ]

    return CompanyFinancialExtraction(
        ico=ico,
        nazov_spolocnosti=company_name or f"Spoločnosť s IČO {ico}",
        audit=AuditorReportData(
            nazor_auditora="Neznámy",
            going_concern_riziko=False,
            auditor_vyhrady_text=None,
        ),
        metriky=metrics,
        verification_confidence=verification_confidence,
    )


def save_metrics_sidecar(metrics: FinancialMetrics, txt_path: str) -> str:
    """Save FinancialMetrics as a .metrics.json sidecar file next to the .txt file.

    Returns the path to the saved JSON file.
    """
    sidecar_path = Path(txt_path).with_suffix(".metrics.json")
    data = {
        "ico": None,  # Set by caller if needed
        "metriky": metrics.model_dump(),
        "source": "ruz_json_parser",
    }
    with open(sidecar_path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, default=str)
    logger.info(f"[RUZ_PARSER] Saved metrics sidecar → {sidecar_path.name}")
    return str(sidecar_path)


def load_metrics_sidecar(txt_path: str) -> Optional[FinancialMetrics]:
    """Load FinancialMetrics from a .metrics.json sidecar file.

    Returns None if the sidecar doesn't exist or is invalid.
    """
    sidecar_path = Path(txt_path).with_suffix(".metrics.json")
    if not sidecar_path.exists():
        return None
    try:
        with open(sidecar_path, "r", encoding="utf-8") as f:
            data = json.load(f)
        metrics_dict = data.get("metriky", data)
        return FinancialMetrics.model_validate(metrics_dict)
    except Exception as e:
        logger.warning(f"[RUZ_PARSER] Failed to load sidecar {sidecar_path.name}: {e}")
        return None
