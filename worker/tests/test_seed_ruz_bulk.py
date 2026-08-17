"""
Testy pre extrakciu finančných dát v seed_ruz_bulk.py.

Pokrýva:
- Balance sheet equality: NCA + CA ≈ totalAssets, equity + ST + LT ≈ totalAssets
- Gross margin calculation: Tržby - (Spotreba materiálu + Služby), fallback na Pridanú hodnotu
- nonCurrentAssets extraction (row 2)
- materialConsumption + servicesCosts extraction (rows 12, 14)
"""

import pytest
from unittest.mock import AsyncMock, MagicMock, patch
import httpx
import asyncio
import unicodedata


# ── Helpers (reproduces seed_ruz_bulk.py extraction logic) ────────────────────

RUZ_API = "https://www.registeruz.sk/cruz-public/api"

ACTIV_OFFSET = 1
PASIV_OFFSET = 79
INCOME_OFFSET = 1
ACTIV_DATA_COLS = 4
PASIV_DATA_COLS = 2
INCOME_DATA_COLS = 2


def _to_float(val):
    if val is None or val == "" or val == 0:
        return None
    if isinstance(val, (int, float)):
        return float(val)
    try:
        return float(val)
    except (ValueError, TypeError):
        return None


def _get_nazov(t):
    n = t.get("nazov", "")
    if isinstance(n, dict):
        n = n.get("sk", "") or n.get("en", "") or ""
    if not isinstance(n, str):
        return ""
    n = unicodedata.normalize("NFKD", n)
    n = "".join(c for c in n if not unicodedata.combining(c))
    return n.lower()


def _find_table(tables, kind):
    for i, t in enumerate(tables):
        nazov = _get_nazov(t)
        if kind == "aktiv" and ("aktiv" in nazov or "asset" in nazov):
            return i
        elif kind == "pasiv" and ("pasiv" in nazov or "liabilit" in nazov):
            return i
        elif kind == "income" and ("zisk" in nazov or "income" in nazov):
            return i
    return None


def _extract_val(tables, table_idx, cislo_riadku, offset, data_cols, current=True):
    if table_idx is None or table_idx >= len(tables):
        return None
    data = tables[table_idx].get("data", [])
    idx = cislo_riadku - offset
    if not data or idx < 0:
        return None
    first = data[0]
    if not isinstance(first, list) and data_cols > 0:
        start = idx * data_cols
        if start + data_cols <= len(data):
            row = data[start : start + data_cols]
        else:
            return None
    else:
        if idx < len(data):
            row = data[idx]
        else:
            return None
    if row is None:
        return None
    if isinstance(row, list):
        if len(row) == data_cols:
            data_start = 0
        elif len(row) > data_cols:
            data_start = len(row) - data_cols
        else:
            return None
        target = 0 if current else 1
        return _to_float(row[data_start + target])
    return _to_float(row)


def _activ_val(tables, row_num, current=True):
    ti = _find_table(tables, "aktiv")
    return _extract_val(tables, ti, row_num, ACTIV_OFFSET, ACTIV_DATA_COLS, current)

def _pasiv_val(tables, row_num, current=True):
    ti = _find_table(tables, "pasiv")
    return _extract_val(tables, ti, row_num, PASIV_OFFSET, PASIV_DATA_COLS, current)

def _income_val(tables, row_num, current=True):
    ti = _find_table(tables, "income")
    return _extract_val(tables, ti, row_num, INCOME_OFFSET, INCOME_DATA_COLS, current)


def _extract_financials(tables):
    """Reproduces seed_ruz_bulk.py extraction logic."""
    ta = _activ_val(tables, 1)
    nca = _activ_val(tables, 2)
    ca = _activ_val(tables, 33)
    eq = _pasiv_val(tables, 80)
    sl = _pasiv_val(tables, 122)
    ll = _pasiv_val(tables, 102)

    has_income = _find_table(tables, "income") is not None
    trzby = _income_val(tables, 1) if has_income else None
    spotreba = _income_val(tables, 12) if has_income else None
    sluzby = _income_val(tables, 14) if has_income else None
    op_costs = _income_val(tables, 10) if has_income else None

    # Gross margin: Tržby - (Spotreba materiálu + Služby)
    cogs_proxy = None
    if spotreba is not None or sluzby is not None:
        cogs_proxy = (spotreba or 0) + (sluzby or 0)
    hruba_marza = None
    if trzby is not None and cogs_proxy is not None and cogs_proxy > 0:
        hruba_marza = trzby - cogs_proxy
    if hruba_marza is None and has_income:
        hruba_marza = _income_val(tables, 28)

    return {
        "totalAssets": ta,
        "nonCurrentAssets": nca,
        "currentAssets": ca,
        "equity": eq,
        "shortTermLiabilities": sl,
        "longTermLiabilities": ll,
        "mainActivityRevenue": trzby,
        "materialConsumption": spotreba,
        "servicesCosts": sluzby,
        "operatingCosts": op_costs,
        "grossProfit": hruba_marza,
    }


# ── Mock data builders ────────────────────────────────────────────────────────

def _make_flat_aktiv(total_assets=0, non_current_assets=0, current_assets=0):
    """Flat aktív: 78 riadkov × 4 stĺpce [Brutto, Korekcia, Netto2, Netto3]."""
    data = [0] * (78 * 4)
    # Row 1 (AKTIVA SPOLU) → index 0
    data[0] = total_assets
    data[2] = total_assets  # Netto2 (current)
    # Row 2 (Neobežný majetok) → index 1
    data[4] = non_current_assets
    data[6] = non_current_assets
    # Row 33 (Obežný majetok) → index 32
    data[128] = current_assets
    data[130] = current_assets
    return data


def _make_flat_pasiv(equity=0, st_liab=0, lt_liab=0):
    """Flat pasív: 67 riadkov × 2 stĺpce [Bežné, Predchádzajúce]."""
    data = [0] * (67 * 2)
    # Row 80 (Vlastné imanie) → index 1
    data[2] = equity
    # Row 102 (Dlhodobé záväzky) → index 23
    data[46] = lt_liab
    # Row 122 (Krátkodobé záväzky) → index 43
    data[86] = st_liab
    return data


def _make_flat_income(revenue=0, material=0, services=0, operating=0, value_added=0):
    """Flat income: 61 riadkov × 2 stĺpce [Bežné, Predchádzajúce]."""
    data = [0] * (61 * 2)
    # Row 1 (Tržby) → index 0
    data[0] = revenue
    # Row 10 (Náklady na hosp. činnosť) → index 9
    data[18] = operating
    # Row 12 (Spotreba materiálu) → index 11
    data[22] = material
    # Row 14 (Služby) → index 13
    data[26] = services
    # Row 28 (Pridaná hodnota) → index 27
    data[54] = value_added
    return data


def _make_tables(ta=0, nca=0, ca=0, eq=0, st=0, lt=0,
                 revenue=0, material=0, services=0, operating=0, value_added=0):
    return [
        {"nazov": {"sk": "Strana aktív"}, "data": _make_flat_aktiv(ta, nca, ca)},
        {"nazov": {"sk": "Strana pasív"}, "data": _make_flat_pasiv(eq, st, lt)},
        {"nazov": {"sk": "Výkaz ziskov a strát"}, "data": _make_flat_income(revenue, material, services, operating, value_added)},
    ]


# ── Tests ─────────────────────────────────────────────────────────────────────

class TestBalanceSheetEquality:
    """Bilančná rovnica: aktíva = pasíva."""

    def test_assets_equal_liabilities(self):
        """NCA + CA = totalAssets a equity + ST + LT = totalAssets."""
        tables = _make_tables(ta=1_000_000, nca=400_000, ca=600_000,
                              eq=500_000, st=300_000, lt=200_000)
        r = _extract_financials(tables)
        left = (r["nonCurrentAssets"] or 0) + (r["currentAssets"] or 0)
        right = (r["equity"] or 0) + (r["shortTermLiabilities"] or 0) + (r["longTermLiabilities"] or 0)
        assert left == r["totalAssets"]
        assert right == r["totalAssets"]

    def test_assets_equal_with_small_residual(self):
        """Rezervy/úvery spôsobujú malý rozdiel — tolerancia < 5%."""
        tables = _make_tables(ta=1_000_000, nca=400_000, ca=600_000,
                              eq=500_000, st=300_000, lt=180_000)
        r = _extract_financials(tables)
        left = (r["nonCurrentAssets"] or 0) + (r["currentAssets"] or 0)
        right = (r["equity"] or 0) + (r["shortTermLiabilities"] or 0) + (r["longTermLiabilities"] or 0)
        assert left == r["totalAssets"]
        diff_pct = abs(r["totalAssets"] - right) / r["totalAssets"] * 100
        assert diff_pct < 5  # 2% rozdiel — rezervy

    def test_non_current_assets_extracted(self):
        """nonCurrentAssets (row 2) sa správne extrahuje — nie NULL."""
        tables = _make_tables(ta=1_000_000, nca=750_000, ca=250_000,
                              eq=600_000, st=300_000, lt=100_000)
        r = _extract_financials(tables)
        assert r["nonCurrentAssets"] == 750_000
        assert r["nonCurrentAssets"] is not None

    def test_non_current_assets_null_when_missing(self):
        """Ak nonCurrentAssets chýba (row 2 = 0), vráti None."""
        tables = _make_tables(ta=1_000_000, nca=0, ca=1_000_000,
                              eq=600_000, st=300_000, lt=100_000)
        r = _extract_financials(tables)
        # _to_float(0) returns None
        assert r["nonCurrentAssets"] is None

    def test_large_company_balance(self):
        """Veľká firma — bilancia v miliónoch."""
        tables = _make_tables(ta=65_000_000, nca=1_000_000, ca=64_000_000,
                              eq=20_000_000, st=43_000_000, lt=500_000)
        r = _extract_financials(tables)
        left = (r["nonCurrentAssets"] or 0) + (r["currentAssets"] or 0)
        right = (r["equity"] or 0) + (r["shortTermLiabilities"] or 0) + (r["longTermLiabilities"] or 0)
        assert left == r["totalAssets"]
        diff_pct = abs(r["totalAssets"] - right) / r["totalAssets"] * 100
        assert diff_pct < 5  # rezervy/úvery


class TestGrossMarginExtraction:
    """Hrubá marža = Tržby - (Spotreba materiálu + Služby), fallback Pridaná hodnota."""

    def test_gross_margin_from_material_and_services(self):
        tables = _make_tables(ta=1_000_000, nca=400_000, ca=600_000,
                              eq=500_000, st=300_000, lt=200_000,
                              revenue=5_000_000, material=2_000_000, services=1_000_000)
        r = _extract_financials(tables)
        assert r["grossProfit"] == 2_000_000  # 5M - (2M + 1M)

    def test_gross_margin_only_material(self):
        tables = _make_tables(ta=1_000_000, nca=400_000, ca=600_000,
                              eq=500_000, st=300_000, lt=200_000,
                              revenue=5_000_000, material=3_000_000)
        r = _extract_financials(tables)
        assert r["grossProfit"] == 2_000_000  # 5M - 3M

    def test_gross_margin_fallback_to_value_added(self):
        tables = _make_tables(ta=1_000_000, nca=400_000, ca=600_000,
                              eq=500_000, st=300_000, lt=200_000,
                              revenue=5_000_000, value_added=1_500_000)
        r = _extract_financials(tables)
        assert r["grossProfit"] == 1_500_000

    def test_gross_margin_none_when_no_revenue(self):
        tables = _make_tables(ta=1_000_000, nca=400_000, ca=600_000,
                              eq=500_000, st=300_000, lt=200_000,
                              material=100_000, services=50_000)
        r = _extract_financials(tables)
        assert r["grossProfit"] is None

    def test_operating_costs_not_used_as_cogs(self):
        """operatingCosts (r.10) sa NEpoužíva pre hrubú maržu."""
        tables = _make_tables(ta=1_000_000, nca=400_000, ca=600_000,
                              eq=500_000, st=300_000, lt=200_000,
                              revenue=5_000_000, operating=4_000_000)
        r = _extract_financials(tables)
        # Bez material/services → fallback na value_added (0 → None)
        assert r["grossProfit"] is None
        # operatingCosts sa extrahuje samostatne
        assert r["operatingCosts"] == 4_000_000

    def test_material_consumption_extracted(self):
        tables = _make_tables(ta=1_000_000, nca=400_000, ca=600_000,
                              eq=500_000, st=300_000, lt=200_000,
                              revenue=5_000_000, material=2_500_000)
        r = _extract_financials(tables)
        assert r["materialConsumption"] == 2_500_000

    def test_services_costs_extracted(self):
        tables = _make_tables(ta=1_000_000, nca=400_000, ca=600_000,
                              eq=500_000, st=300_000, lt=200_000,
                              revenue=5_000_000, services=800_000)
        r = _extract_financials(tables)
        assert r["servicesCosts"] == 800_000


class TestTableNameParsing:
    """Testy pre názvy tabuliek so slovenskou diakritikou."""

    def test_aktiv_with_diacritics(self):
        """'Strana aktív' (s dĺžňom) sa správne identifikuje."""
        tables = [{"nazov": {"sk": "Strana aktív"}, "data": []}]
        assert _find_table(tables, "aktiv") == 0

    def test_pasiv_with_diacritics(self):
        """'Strana pasív' (s dĺžňom) sa správne identifikuje."""
        tables = [{"nazov": {"sk": "Strana pasív"}, "data": []}]
        assert _find_table(tables, "pasiv") == 0

    def test_income_with_diacritics(self):
        """'Výkaz ziskov a strát' sa správne identifikuje."""
        tables = [{"nazov": {"sk": "Výkaz ziskov a strát"}, "data": []}]
        assert _find_table(tables, "income") == 0

    def test_english_table_names(self):
        """Anglické názvy fungujú ako fallback."""
        tables = [
            {"nazov": {"en": "Assets"}, "data": []},
            {"nazov": {"en": "Liabilities and equity"}, "data": []},
            {"nazov": {"en": "Income statement"}, "data": []},
        ]
        assert _find_table(tables, "aktiv") == 0
        assert _find_table(tables, "pasiv") == 1
        assert _find_table(tables, "income") == 2
