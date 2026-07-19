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
ROW_CURRENT_ASSETS = 33
ROW_INVENTORY = 34
ROW_TRADE_RECEIVABLES_TOTAL = 53  # Krátkodobé pohľadávky súčet
ROW_TRADE_RECEIVABLES = 54        # Pohľadávky z obchodného styku súčet
ROW_FINANCIAL_ACCOUNTS = 71       # Finančné účty
ROW_CASH = 72                     # Peniaze

# Strana pasív (table 1)
ROW_TOTAL_EQUITY = 80
ROW_TOTAL_LIABILITIES = 101
ROW_LT_LIABILITIES = 102
ROW_LT_BANK_LOANS = 121
ROW_ST_LIABILITIES = 122
ROW_TRADE_PAYABLES = 123
ROW_EMPLOYEE_LIAB = 131
ROW_SOCIAL_INS_LIAB = 132
ROW_TAX_LIAB = 133
ROW_ST_BANK_LOANS = 139

# Výkaz ziskov a strát (table 2)
ROW_NET_REVENUE = 1
ROW_OPERATING_INCOME = 2
ROW_OPERATING_EXPENSES = 10
ROW_PERSONNEL_COSTS = 15
ROW_DEPRECIATION = 21
ROW_OPERATING_PROFIT = 27
ROW_VALUE_ADDED = 28
ROW_FINANCIAL_INCOME = 29
ROW_FINANCIAL_EXPENSES = 45
ROW_INTEREST_EXPENSE = 49
ROW_PROFIT_BEFORE_TAX = 56
ROW_INCOME_TAX = 57
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

    Handles Slovak formatting: spaces/nbsp as thousand separators,
    comma as decimal separator. Returns None for empty/non-numeric values.
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
        # Remove thousand separators (spaces/nbsp), keep last comma/dot as decimal
        cleaned = re.sub(r'[\s\xa0]', '', cleaned)
        if ',' in cleaned and '.' in cleaned:
            # Mixed: assume dot is thousand, comma is decimal
            cleaned = cleaned.replace('.', '').replace(',', '.')
        elif ',' in cleaned:
            # Only comma: assume decimal separator
            cleaned = cleaned.replace(',', '.')
        # If multiple dots remain (e.g. "1.234.567"), remove all but last
        if cleaned.count('.') > 1:
            parts = cleaned.split('.')
            cleaned = ''.join(parts[:-1]) + '.' + parts[-1]
        try:
            return float(cleaned) if cleaned else None
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


def _get_row(tables: list, table_idx: int, cislo_riadku: int, offset: int) -> Optional[list]:
    """Get a data row by cisloRiadku from a specific table."""
    if table_idx >= len(tables):
        return None
    data = tables[table_idx].get("data", [])
    idx = cislo_riadku - offset
    if 0 <= idx < len(data):
        return data[idx]
    return None


def _get_activ_value(tables: list, cislo_riadku: int, current: bool = True) -> Optional[float]:
    """Extract current or preceding period value from Strana aktív.

    Aktív has 4 data columns: [Brutto, Korekcia, Netto2 (current), Netto3 (preceding)].
    We use Netto (column index 2) for current period.
    """
    row = _get_row(tables, 0, cislo_riadku, _ACTIV_OFFSET)
    if row is None:
        return None
    target = 2 if current else 3  # Netto2 / Netto3
    return _extract_row_value(row, 4, target)


def _get_pasiv_value(tables: list, cislo_riadku: int, current: bool = True) -> Optional[float]:
    """Extract current or preceding period value from Strana pasív."""
    row = _get_row(tables, 1, cislo_riadku, _PASIV_OFFSET)
    if row is None:
        return None
    target = 0 if current else 1
    return _extract_row_value(row, 2, target)


def _get_income_value(tables: list, cislo_riadku: int, current: bool = True) -> Optional[float]:
    """Extract current or preceding period value from Výkaz ziskov a strát."""
    row = _get_row(tables, 2, cislo_riadku, _INCOME_OFFSET)
    if row is None:
        return None
    target = 0 if current else 1
    return _extract_row_value(row, 2, target)


def _identify_tables(tables: list) -> dict[str, int]:
    """Identify table indices by their Slovak names.

    Returns a dict mapping 'aktiv', 'pasiv', 'income' to table indices.
    """
    result = {}
    for i, tab in enumerate(tables):
        nazov = tab.get("nazov", {}).get("sk", "").lower()
        if "strana akt" in nazov or "aktív" in nazov:
            result["aktiv"] = i
        elif "strana pas" in nazov or "pasív" in nazov:
            result["pasiv"] = i
        elif "ziskov a str" in nazov or "profit and loss" in nazov.lower():
            result["income"] = i
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

def _sanity_check(metrics: FinancialMetrics) -> list[str]:
    """Validate financial consistency. Returns list of warning messages."""
    warnings = []

    # Check 1: assets == equity + total liabilities (short + long term)
    assets = metrics.celkove_aktiva
    equity = metrics.vlastne_imanie_celkom
    total_liab = (metrics.dlhodobe_zavazky or 0) + (metrics.kratkodobe_zavazky or 0)

    if assets is not None and equity is not None:
        expected_assets = equity + total_liab
        diff = abs(assets - expected_assets)
        tolerance = max(abs(assets) * 0.01, 1.0)  # 1% or 1 EUR
        if diff > tolerance:
            warnings.append(
                f"Balance sheet mismatch: assets={assets} vs equity+liabilities={expected_assets} "
                f"(diff={diff:.2f})"
            )

    # Check 2: revenue should be non-negative
    if metrics.trzby_z_hlavnej_cinnosti is not None and metrics.trzby_z_hlavnej_cinnosti < 0:
        warnings.append(f"Revenue is negative: {metrics.trzby_z_hlavnej_cinnosti}")

    # Check 3: personnel costs should be non-negative
    if metrics.osobne_naklady is not None and metrics.osobne_naklady < 0:
        warnings.append(f"Personnel costs are negative: {metrics.osobne_naklady}")

    return warnings


# ── Main parser ───────────────────────────────────────────────────────────────

def parse_tables_to_metrics(
    tables: list[dict],
    titulna_strana: dict,
    ico: str,
) -> Optional[FinancialMetrics]:
    """Parse RÚZ JSON tables into FinancialMetrics.

    Args:
        tables: List of table dicts from obsah.tabulky (across all výkazy for one závierka)
        titulna_strana: obsah.titulnaStrana dict
        ico: Company IČO

    Returns:
        FinancialMetrics if parsing succeeds, None otherwise
    """
    if not tables:
        return None

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

    # Extract year from obdobieDo (ISO or Slovak date string)
    year = None
    if obdobie_do:
        m = re.search(r'(20\d{2})', str(obdobie_do))
        if m:
            try:
                year = int(m.group(1))
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

    # Balance sheet — pasív
    vlastne_imanie = _get_pasiv_value(ordered, ROW_TOTAL_EQUITY)
    dlhodobe_zavazky = _get_pasiv_value(ordered, ROW_LT_LIABILITIES)
    kratkodobe_zavazky = _get_pasiv_value(ordered, ROW_ST_LIABILITIES)
    zavazky_obchod = _get_pasiv_value(ordered, ROW_TRADE_PAYABLES)
    zavazky_zamestnanci = _get_pasiv_value(ordered, ROW_EMPLOYEE_LIAB)
    zavazky_sp = _get_pasiv_value(ordered, ROW_SOCIAL_INS_LIAB)
    danove_zavazky = _get_pasiv_value(ordered, ROW_TAX_LIAB)

    # Income statement
    trzby = _get_income_value(ordered, ROW_NET_REVENUE) if has_income else None
    hruba_marza = _get_income_value(ordered, ROW_VALUE_ADDED) if has_income else None
    osobne_naklady = _get_income_value(ordered, ROW_PERSONNEL_COSTS) if has_income else None
    odpisy = _get_income_value(ordered, ROW_DEPRECIATION) if has_income else None
    uroky = _get_income_value(ordered, ROW_INTEREST_EXPENSE) if has_income else None
    zisk_po_zdaneni = _get_income_value(ordered, ROW_NET_PROFIT) if has_income else None

    # If revenue is None, try operating income total as fallback
    if trzby is None and has_income:
        trzby = _get_income_value(ordered, ROW_OPERATING_INCOME)

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
        ciste_penazne_toky_z_prevadzkovej_cinnosti=None,  # Not in Súvaha/Výkaz — needs cash flow statement
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
    )

    # Sanity checks
    warnings = _sanity_check(metrics)
    if warnings:
        for w in warnings:
            logger.warning(f"[RUZ_PARSER] IČO {ico} rok {year}: {w}")
    else:
        logger.info(f"[RUZ_PARSER] IČO {ico} rok {year}: sanity checks passed")

    return metrics


def parse_vykaz_to_metrics(vykaz: dict, ico: str) -> Optional[FinancialMetrics]:
    """Parse a single výkaz JSON into FinancialMetrics.

    Args:
        vykaz: Full výkaz dict from RÚZ API (uctovny-vykaz)
        ico: Company IČO

    Returns:
        FinancialMetrics if parsing succeeds, None otherwise
    """
    obsah = vykaz.get("obsah", {})
    tables = obsah.get("tabulky", [])
    titulna = obsah.get("titulnaStrana", {})

    if not tables:
        return None

    return parse_tables_to_metrics(tables, titulna, ico)


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

    for vykaz in vykazy:
        obsah = vykaz.get("obsah", {})
        tables = obsah.get("tabulky", [])
        if tables:
            all_tables.extend(tables)
        if not ts:
            ts = obsah.get("titulnaStrana", {})

    if not all_tables:
        return None

    return parse_tables_to_metrics(all_tables, ts, ico)


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
