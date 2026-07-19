"""
Unit tests pre RÚZ JSON parser (ruz_parser.py).

Pokrýva:
- _to_float: normalizácia slovenských čísel, zátvorková notácia, edge cases
- _extract_row_value: extrakcia z rôznych formátov riadkov
- _sanity_check: bilančná rovnováha, negatívne tržby/náklady
- parse_tables_to_metrics: kompletný parsing, unit detection, hrubá marža
"""

import pytest
from src.ruz_parser import (
    _to_float,
    _extract_row_value,
    _sanity_check,
    parse_tables_to_metrics,
    ROW_TOTAL_ASSETS,
    ROW_CURRENT_ASSETS,
    ROW_CASH,
    ROW_TOTAL_EQUITY,
    ROW_ST_LIABILITIES,
    ROW_LT_LIABILITIES,
    ROW_NET_REVENUE,
    ROW_COST_OF_GOODS_SOLD,
    ROW_PERSONNEL_COSTS,
    ROW_NET_PROFIT,
    ROW_VALUE_ADDED,
)
from src.agents.shared import FinancialMetrics


# ── _to_float ────────────────────────────────────────────────────────────────

class TestToFloat:
    def test_slovak_thousands_comma_decimal(self):
        assert _to_float("1 234 567,89") == 1234567.89

    def test_us_thousands_dot_decimal(self):
        assert _to_float("1,234,567.89") == 1234567.89

    def test_parentheses_negative_integer(self):
        assert _to_float("(1 234)") == -1234.0

    def test_parentheses_negative_decimal(self):
        assert _to_float("(1234,56)") == -1234.56

    def test_parentheses_negative_with_spaces(self):
        assert _to_float("( 1 234 )") == -1234.0

    def test_plain_integer_string(self):
        assert _to_float("1234") == 1234.0

    def test_plain_float_string(self):
        assert _to_float("1234.56") == 1234.56

    def test_integer_input(self):
        assert _to_float(1234) == 1234.0

    def test_float_input(self):
        assert _to_float(1234.56) == 1234.56

    def test_empty_string(self):
        assert _to_float("") is None

    def test_space_string(self):
        assert _to_float(" ") is None

    def test_none(self):
        assert _to_float(None) is None

    def test_boolean(self):
        assert _to_float(True) is None
        assert _to_float(False) is None

    def test_nbsp_thousand_separator(self):
        assert _to_float("1\xa0234\xa0567,89") == 1234567.89

    def test_multiple_dots(self):
        assert _to_float("1.234.567,89") == 1234567.89

    def test_negative_with_dot(self):
        assert _to_float("-1234.56") == -1234.56

    def test_zero(self):
        assert _to_float("0") == 0.0

    def test_zero_in_parentheses(self):
        assert _to_float("(0)") == 0.0

    def test_garbage_string(self):
        assert _to_float("abc") is None

    def test_mixed_comma_dot(self):
        # "1.234,56" → bodka = tisíc, čiarka = desatinná → 1234.56
        assert _to_float("1.234,56") == 1234.56


# ── _extract_row_value ──────────────────────────────────────────────────────

class TestExtractRowValue:
    def test_aktiv_full_row_current(self):
        # [Označ, Text, Číslo, Brutto, Korekcia, Netto2, Netto3]
        row = ["A", "Dlh. majetok", "10", "100", "0", "100", "50"]
        assert _extract_row_value(row, 4, 2) == 100.0  # Netto2

    def test_aktiv_full_row_preceding(self):
        row = ["A", "Dlh. majetok", "10", "100", "0", "100", "50"]
        assert _extract_row_value(row, 4, 3) == 50.0  # Netto3

    def test_aktiv_data_only_row(self):
        row = ["100", "0", "100", "50"]
        assert _extract_row_value(row, 4, 2) == 100.0

    def test_pasiv_full_row(self):
        # [Označ, Text, Číslo, Bežné, Predchádzajúce]
        row = ["A", "Vlastné imanie", "80", "500000", "450000"]
        assert _extract_row_value(row, 2, 0) == 500000.0
        assert _extract_row_value(row, 2, 1) == 450000.0

    def test_row_too_short(self):
        row = ["A", "Text"]
        assert _extract_row_value(row, 4, 0) is None

    def test_row_none(self):
        assert _extract_row_value(None, 4, 0) is None

    def test_target_col_out_of_range(self):
        row = ["A", "Text", "1", "100"]
        assert _extract_row_value(row, 4, 5) is None

    def test_parentheses_in_row(self):
        row = ["A", "Strata", "61", "(50000)", "(40000)"]
        assert _extract_row_value(row, 2, 0) == -50000.0
        assert _extract_row_value(row, 2, 1) == -40000.0


# ── _sanity_check ────────────────────────────────────────────────────────────

def _make_metrics(**kwargs) -> FinancialMetrics:
    defaults = dict(
        rok_zavierky=2024,
        celkove_aktiva=None,
        obezny_majetok=None,
        vlastne_imanie_celkom=None,
        kratkodobe_zavazky=None,
        dlhodobe_zavazky=None,
        trzby_z_hlavnej_cinnosti=None,
        hruba_marza=None,
        zisk_alebo_strata_po_zdaneni=None,
        peniaze_a_penazne_ekvivalenty_k_31_12=None,
        ciste_penazne_toky_z_prevadzkovej_cinnosti=None,
        osobne_naklady=None,
        pohladavky_z_obchodneho_styku=None,
        zavazky_z_obchodneho_styku=None,
        zasoby=None,
        odpisy=None,
        investicny_cash_flow=None,
        financny_cash_flow=None,
        uroky=None,
        pocet_zamestnancov=None,
        mena="EUR",
        typ_zavierky="SK_GAAP",
        pocet_mesiacov_obdobia=12,
        is_consolidated=False,
    )
    defaults.update(kwargs)
    return FinancialMetrics(**defaults)


class TestSanityCheck:
    def test_balance_sheet_ok(self):
        metrics = _make_metrics(
            celkove_aktiva=100.0,
            vlastne_imanie_celkom=50.0,
            kratkodobe_zavazky=30.0,
            dlhodobe_zavazky=20.0,
        )
        warnings = _sanity_check(metrics)
        assert len(warnings) == 0

    def test_balance_sheet_mismatch(self):
        metrics = _make_metrics(
            celkove_aktiva=100.0,
            vlastne_imanie_celkom=40.0,
            kratkodobe_zavazky=30.0,
            dlhodobe_zavazky=20.0,
        )
        # 40 + 30 + 20 = 90 ≠ 100 → diff=10 > tolerance
        warnings = _sanity_check(metrics)
        assert any("Balance sheet mismatch" in w for w in warnings)

    def test_balance_sheet_within_tolerance(self):
        metrics = _make_metrics(
            celkove_aktiva=100.0,
            vlastne_imanie_celkom=50.0,
            kratkodobe_zavazky=30.0,
            dlhodobe_zavazky=20.5,
        )
        # 50 + 30 + 20.5 = 100.5, diff=0.5 < tolerance (1% of 100 = 1.0)
        warnings = _sanity_check(metrics)
        assert len(warnings) == 0

    def test_negative_revenue(self):
        metrics = _make_metrics(
            trzby_z_hlavnej_cinnosti=-1000.0,
        )
        warnings = _sanity_check(metrics)
        assert any("Revenue is negative" in w for w in warnings)

    def test_negative_personnel_costs(self):
        metrics = _make_metrics(
            osobne_naklady=-500.0,
        )
        warnings = _sanity_check(metrics)
        assert any("Personnel costs are negative" in w for w in warnings)

    def test_no_warnings_when_all_none(self):
        metrics = _make_metrics()
        warnings = _sanity_check(metrics)
        assert len(warnings) == 0


# ── parse_tables_to_metrics ──────────────────────────────────────────────────

def _make_aktiv_row(cislo, text, netto2, netto3="0"):
    return ["Ozn", text, str(cislo), "0", "0", str(netto2), str(netto3)]

def _make_pasiv_row(cislo, text, bezne, predch="0"):
    return ["Ozn", text, str(cislo), str(bezne), str(predch)]

def _make_income_row(cislo, text, bezne, predch="0"):
    return ["Ozn", text, str(cislo), str(bezne), str(predch)]


def _set_row(arr, idx, row, cols=7):
    """Ensure array is large enough, then set row at idx."""
    while len(arr) <= idx:
        arr.append(["", "", str(len(arr) + 1)] + [""] * (cols - 3))
    arr[idx] = row


def _make_tables(assets=None, equity=None, st_liab=None, lt_liab=None,
                 revenue=None, cogs=None, personnel=None, net_profit=None,
                 value_added=None, cash=None, current_assets=None,
                 trade_recv=None, trade_pay=None, inv_liab=None, sp_liab=None,
                 tax_liab=None, emp_liab=None, depreciation=None, interest=None,
                 obdobie_od="2024-01-01", obdobie_do="2024-12-31",
                 pocet_zam=100, konsolidovana=False):
    """Vytvorí mock RÚZ JSON tabuľky pre testovanie."""
    from src.ruz_parser import _ACTIV_OFFSET, _PASIV_OFFSET, _INCOME_OFFSET

    # Aktív: offset=1, rows 1-78 → indices 0-77
    aktiv_data = []
    if assets is not None:
        _set_row(aktiv_data, ROW_TOTAL_ASSETS - _ACTIV_OFFSET,
                 _make_aktiv_row(ROW_TOTAL_ASSETS, "SPOLU AKTÍVA", assets))
    if current_assets is not None:
        _set_row(aktiv_data, ROW_CURRENT_ASSETS - _ACTIV_OFFSET,
                 _make_aktiv_row(ROW_CURRENT_ASSETS, "Obežný majetok", current_assets))
    if cash is not None:
        _set_row(aktiv_data, ROW_CASH - _ACTIV_OFFSET,
                 _make_aktiv_row(ROW_CASH, "Peniaze", cash))
    if trade_recv is not None:
        _set_row(aktiv_data, 54 - _ACTIV_OFFSET,
                 _make_aktiv_row(54, "Pohľadávky z obch. styku", trade_recv))

    # Pasív: offset=79, rows 80-145 → indices 1-66, 5 cols
    pasiv_data = []
    if equity is not None:
        _set_row(pasiv_data, ROW_TOTAL_EQUITY - _PASIV_OFFSET,
                 _make_pasiv_row(ROW_TOTAL_EQUITY, "Vlastné imanie", equity), cols=5)
    if lt_liab is not None:
        _set_row(pasiv_data, ROW_LT_LIABILITIES - _PASIV_OFFSET,
                 _make_pasiv_row(ROW_LT_LIABILITIES, "Dlhodobé záväzky", lt_liab), cols=5)
    if st_liab is not None:
        _set_row(pasiv_data, ROW_ST_LIABILITIES - _PASIV_OFFSET,
                 _make_pasiv_row(ROW_ST_LIABILITIES, "Krátkodobé záväzky", st_liab), cols=5)
    if trade_pay is not None:
        _set_row(pasiv_data, 123 - _PASIV_OFFSET,
                 _make_pasiv_row(123, "Záväzky z obch. styku", trade_pay), cols=5)

    # Income: offset=1, rows 1-61 → indices 0-60, 5 cols
    income_data = []
    if revenue is not None:
        _set_row(income_data, ROW_NET_REVENUE - _INCOME_OFFSET,
                 _make_income_row(ROW_NET_REVENUE, "Čistý obrat", revenue), cols=5)
    if cogs is not None:
        _set_row(income_data, ROW_COST_OF_GOODS_SOLD - _INCOME_OFFSET,
                 _make_income_row(ROW_COST_OF_GOODS_SOLD, "Náklady na predaný tovar", cogs), cols=5)
    if personnel is not None:
        _set_row(income_data, ROW_PERSONNEL_COSTS - _INCOME_OFFSET,
                 _make_income_row(ROW_PERSONNEL_COSTS, "Osobné náklady", personnel), cols=5)
    if depreciation is not None:
        _set_row(income_data, 21 - _INCOME_OFFSET,
                 _make_income_row(21, "Odpisy", depreciation), cols=5)
    if value_added is not None:
        _set_row(income_data, ROW_VALUE_ADDED - _INCOME_OFFSET,
                 _make_income_row(ROW_VALUE_ADDED, "Pridaná hodnota", value_added), cols=5)
    if interest is not None:
        _set_row(income_data, 49 - _INCOME_OFFSET,
                 _make_income_row(49, "Nákladové úroky", interest), cols=5)
    if net_profit is not None:
        _set_row(income_data, ROW_NET_PROFIT - _INCOME_OFFSET,
                 _make_income_row(ROW_NET_PROFIT, "Výsledok po zdanení", net_profit), cols=5)

    tables = [
        {"nazov": {"sk": "Strana aktív"}, "data": aktiv_data},
        {"nazov": {"sk": "Strana pasív"}, "data": pasiv_data},
        {"nazov": {"sk": "Výkaz ziskov a strát"}, "data": income_data},
    ]

    titulna = {
        "obdobieOd": obdobie_od,
        "obdobieDo": obdobie_do,
        "konsolidovana": konsolidovana,
        "pocetZamestnancov": pocet_zam,
    }
    return tables, titulna


class TestParseTablesToMetrics:
    def test_basic_parsing(self):
        tables, titulna = _make_tables(
            assets=1_000_000,
            equity=500_000,
            st_liab=300_000,
            lt_liab=200_000,
            revenue=5_000_000,
            cogs=3_000_000,
            net_profit=200_000,
            pocet_zam=50,
        )
        metrics = parse_tables_to_metrics(tables, titulna, "12345678")
        assert metrics is not None
        assert metrics.rok_zavierky == 2024
        assert metrics.celkove_aktiva == 1_000_000
        assert metrics.vlastne_imanie_celkom == 500_000
        assert metrics.trzby_z_hlavnej_cinnosti == 5_000_000
        assert metrics.zisk_alebo_strata_po_zdaneni == 200_000

    def test_gross_margin_from_cogs(self):
        tables, titulna = _make_tables(
            assets=1_000_000,
            equity=500_000,
            st_liab=300_000,
            lt_liab=200_000,
            revenue=5_000_000,
            cogs=3_000_000,
            pocet_zam=50,
        )
        metrics = parse_tables_to_metrics(tables, titulna, "12345678")
        assert metrics is not None
        # hruba_marza = Tržby - COGS = 5M - 3M = 2M
        assert metrics.hruba_marza == 2_000_000

    def test_gross_margin_fallback_to_value_added(self):
        tables, titulna = _make_tables(
            assets=1_000_000,
            equity=500_000,
            st_liab=300_000,
            lt_liab=200_000,
            revenue=5_000_000,
            cogs=None,  # COGS chýba
            value_added=1_500_000,
            pocet_zam=50,
        )
        metrics = parse_tables_to_metrics(tables, titulna, "12345678")
        assert metrics is not None
        # Fallback na Pridanú hodnotu
        assert metrics.hruba_marza == 1_500_000

    def test_unit_detection_thousands_eur(self):
        """Ak aktíva < 1000 a zamestnancov > 10, deteguj tisíce EUR."""
        tables, titulna = _make_tables(
            assets=500,      # < 1000 → tisíce EUR
            equity=300,
            st_liab=100,
            lt_liab=100,
            revenue=2000,
            cogs=1200,
            pocet_zam=50,    # > 10
        )
        metrics = parse_tables_to_metrics(tables, titulna, "12345678")
        assert metrics is not None
        # Všetky hodnoty by mali byť ×1000
        assert metrics.celkove_aktiva == 500_000
        assert metrics.vlastne_imanie_celkom == 300_000
        assert metrics.trzby_z_hlavnej_cinnosti == 2_000_000
        assert metrics.hruba_marza == 800_000  # (2000 - 1200) * 1000

    def test_unit_detection_eur_normal(self):
        """Ak aktíva >= 1000, nedeteguj tisíce EUR."""
        tables, titulna = _make_tables(
            assets=500_000,
            equity=300_000,
            st_liab=100_000,
            lt_liab=100_000,
            revenue=2_000_000,
            cogs=1_200_000,
            pocet_zam=50,
        )
        metrics = parse_tables_to_metrics(tables, titulna, "12345678")
        assert metrics is not None
        # Žiadny multiplier
        assert metrics.celkove_aktiva == 500_000
        assert metrics.trzby_z_hlavnej_cinnosti == 2_000_000

    def test_unit_detection_small_company_no_multiplier(self):
        """Ak aktíva < 1000 ale zamestnancov <= 10, nedeteguj tisíce EUR."""
        tables, titulna = _make_tables(
            assets=500,
            equity=300,
            st_liab=100,
            lt_liab=100,
            revenue=2000,
            cogs=1200,
            pocet_zam=5,     # <= 10 → malá firma, nie tisíce EUR
        )
        metrics = parse_tables_to_metrics(tables, titulna, "12345678")
        assert metrics is not None
        # Žiadny multiplier
        assert metrics.celkove_aktiva == 500

    def test_parentheses_in_net_profit(self):
        """Strata v zátvorkách by mala byť záporná."""
        tables, titulna = _make_tables(
            assets=1_000_000,
            equity=500_000,
            st_liab=300_000,
            lt_liab=200_000,
            revenue=5_000_000,
            cogs=3_000_000,
            net_profit="(50000)",  # Strata v zátvorkách
            pocet_zam=50,
        )
        metrics = parse_tables_to_metrics(tables, titulna, "12345678")
        assert metrics is not None
        assert metrics.zisk_alebo_strata_po_zdaneni == -50000.0

    def test_missing_tables(self):
        metrics = parse_tables_to_metrics([], {}, "12345678")
        assert metrics is None

    def test_missing_aktiv_pasiv(self):
        tables = [
            {"nazov": {"sk": "Výkaz ziskov a strát"}, "data": []},
        ]
        metrics = parse_tables_to_metrics(tables, {"obdobieDo": "2024-12-31"}, "12345678")
        assert metrics is None

    def test_missing_year(self):
        tables, _ = _make_tables(assets=1000, equity=500, st_liab=500)
        titulna = {"obdobieDo": "", "pocetZamestnancov": 50}
        metrics = parse_tables_to_metrics(tables, titulna, "12345678")
        assert metrics is None

    def test_consolidated_flag(self):
        tables, titulna = _make_tables(
            assets=1_000_000,
            equity=500_000,
            st_liab=300_000,
            lt_liab=200_000,
            konsolidovana=True,
        )
        metrics = parse_tables_to_metrics(tables, titulna, "12345678")
        assert metrics is not None
        assert metrics.is_consolidated is True

    def test_employee_count(self):
        tables, titulna = _make_tables(
            assets=1_000_000,
            equity=500_000,
            st_liab=300_000,
            lt_liab=200_000,
            pocet_zam=1292,
        )
        metrics = parse_tables_to_metrics(tables, titulna, "12345678")
        assert metrics is not None
        assert metrics.pocet_zamestnancov == 1292

    def test_months_computation(self):
        tables, titulna = _make_tables(
            assets=1_000_000,
            equity=500_000,
            st_liab=300_000,
            lt_liab=200_000,
            obdobie_od="2024-01-01",
            obdobie_do="2024-12-31",
        )
        metrics = parse_tables_to_metrics(tables, titulna, "12345678")
        assert metrics is not None
        assert metrics.pocet_mesiacov_obdobia == 12

    def test_months_short_period(self):
        tables, titulna = _make_tables(
            assets=1_000_000,
            equity=500_000,
            st_liab=300_000,
            lt_liab=200_000,
            obdobie_od="2024-07-01",
            obdobie_do="2024-12-31",
        )
        metrics = parse_tables_to_metrics(tables, titulna, "12345678")
        assert metrics is not None
        assert metrics.pocet_mesiacov_obdobia == 6
