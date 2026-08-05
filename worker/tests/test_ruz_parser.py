"""
Unit tests pre RÚZ JSON parser (ruz_parser.py).

Pokrýva:
- _to_float: normalizácia slovenských čísel, zátvorková notácia, edge cases
- _extract_row_value: extrakcia z rôznych formátov riadkov
- _sanity_check: bilančná rovnováha (2-tier tolerancia), negatívne tržby/náklady
- _estimate_cf: nepriamy odhad operating cash flow
- _identify_tables: detekcia tabuliek podľa názvu, logging pri zlyhaní
- parse_tables_to_metrics: kompletný parsing, unit detection, hrubá marža,
  year validation, estimated OCF
"""

import pytest
from datetime import datetime
from src.ruz_parser import (
    _to_float,
    _extract_row_value,
    _sanity_check,
    _estimate_cf,
    _identify_tables,
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
    ROW_TRADE_RECEIVABLES,
    ROW_TRADE_PAYABLES,
    ROW_INVENTORY,
    ROW_DEPRECIATION,
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

    def test_mixed_comma_dot_slovak(self):
        # "1.234,56" → bodka = tisíc, čiarka = desatinná → 1234.56
        assert _to_float("1.234,56") == 1234.56

    def test_mixed_comma_dot_english(self):
        # "1,234.56" → čiarka = tisíc, bodka = desatinná → 1234.56
        assert _to_float("1,234.56") == 1234.56


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

    def test_balance_sheet_minor_gap_under_5pct(self):
        """Rozdiel < 5 % — žiadny warning (môžu byť iné pasíva)."""
        metrics = _make_metrics(
            celkove_aktiva=100_000.0,
            vlastne_imanie_celkom=50_000.0,
            kratkodobe_zavazky=30_000.0,
            dlhodobe_zavazky=17_000.0,  # suma = 97 000, diff = 3 000 = 3 %
        )
        warnings = _sanity_check(metrics)
        assert len(warnings) == 0

    def test_balance_sheet_minor_warning_5_to_15pct(self):
        """Rozdiel 5-15 % — soft warning (minor gap)."""
        metrics = _make_metrics(
            celkove_aktiva=100_000.0,
            vlastne_imanie_celkom=50_000.0,
            kratkodobe_zavazky=30_000.0,
            dlhodobe_zavazky=10_000.0,  # suma = 90 000, diff = 10 000 = 10 %
        )
        warnings = _sanity_check(metrics)
        assert len(warnings) == 1
        assert "minor gap" in warnings[0].lower() or "mismatch" in warnings[0].lower()

    def test_balance_sheet_large_mismatch_over_15pct(self):
        """Rozdiel > 15 % — error-level warning."""
        metrics = _make_metrics(
            celkove_aktiva=100.0,
            vlastne_imanie_celkom=40.0,
            kratkodobe_zavazky=30.0,
            dlhodobe_zavazky=10.0,  # suma = 80, diff = 20 = 20 %
        )
        warnings = _sanity_check(metrics)
        assert len(warnings) == 1
        assert "mismatch" in warnings[0].lower() or "large" in warnings[0].lower()

    def test_balance_sheet_within_tolerance(self):
        """Rozdiel < 1 EUR pri malých sumách — žiadny warning."""
        metrics = _make_metrics(
            celkove_aktiva=100.0,
            vlastne_imanie_celkom=50.0,
            kratkodobe_zavazky=30.0,
            dlhodobe_zavazky=20.5,
        )
        # 50 + 30 + 20.5 = 100.5, diff = 0.5 = 0.5 % → pod 5 %
        warnings = _sanity_check(metrics)
        assert len(warnings) == 0

    def test_negative_revenue(self):
        metrics = _make_metrics(trzby_z_hlavnej_cinnosti=-1000.0)
        warnings = _sanity_check(metrics)
        assert any("Revenue is negative" in w for w in warnings)

    def test_negative_personnel_costs(self):
        metrics = _make_metrics(osobne_naklady=-500.0)
        warnings = _sanity_check(metrics)
        assert any("Personnel costs are negative" in w for w in warnings)

    def test_no_warnings_when_all_none(self):
        metrics = _make_metrics()
        warnings = _sanity_check(metrics)
        assert len(warnings) == 0


# ── _estimate_cf ─────────────────────────────────────────────────────────────

class TestEstimateCf:
    def test_basic_no_working_capital(self):
        """Bez zmeny pracovného kapitálu: CF = Zisk + Odpisy."""
        cf = _estimate_cf(
            net_profit=100_000,
            depreciation=20_000,
            inventory_curr=None,
            inventory_prev=None,
            receivables_curr=None,
            receivables_prev=None,
            payables_curr=None,
            payables_prev=None,
        )
        assert cf == 120_000.0

    def test_with_working_capital_changes(self):
        """CF = Zisk + Odpisy - ΔZásoby - ΔPohľadávky + ΔZáväzky."""
        cf = _estimate_cf(
            net_profit=100_000,
            depreciation=20_000,
            inventory_curr=50_000,
            inventory_prev=40_000,   # Zásoby rástli → CF klesá
            receivables_curr=80_000,
            receivables_prev=60_000, # Pohľadávky rástli → CF klesá
            payables_curr=70_000,
            payables_prev=50_000,    # Záväzky rástli → CF rastie
        )
        # 100k + 20k - (50k-40k) - (80k-60k) + (70k-50k) = 110k
        assert cf == 110_000.0

    def test_missing_depreciation_returns_none(self):
        cf = _estimate_cf(
            net_profit=100_000,
            depreciation=None,
            inventory_curr=None,
            inventory_prev=None,
            receivables_curr=None,
            receivables_prev=None,
            payables_curr=None,
            payables_prev=None,
        )
        assert cf is None

    def test_missing_net_profit_returns_none(self):
        cf = _estimate_cf(
            net_profit=None,
            depreciation=20_000,
            inventory_curr=None,
            inventory_prev=None,
            receivables_curr=None,
            receivables_prev=None,
            payables_curr=None,
            payables_prev=None,
        )
        assert cf is None

    def test_partial_wc_data_uses_available(self):
        """Ak je k dispozícii len časť WC dát, použije dostupné."""
        cf = _estimate_cf(
            net_profit=100_000,
            depreciation=20_000,
            inventory_curr=50_000,
            inventory_prev=40_000,   # dostupné
            receivables_curr=None,   # chýba → ignoruje
            receivables_prev=None,
            payables_curr=None,      # chýba → ignoruje
            payables_prev=None,
        )
        # 100k + 20k - (50k-40k) = 110k
        assert cf == 110_000.0

    def test_negative_profit_loss(self):
        """Strata → záporné CF (ak odpisy nestačia pokryť)."""
        cf = _estimate_cf(
            net_profit=-200_000,
            depreciation=50_000,
            inventory_curr=None,
            inventory_prev=None,
            receivables_curr=None,
            receivables_prev=None,
            payables_curr=None,
            payables_prev=None,
        )
        assert cf == -150_000.0


# ── _identify_tables ─────────────────────────────────────────────────────────

class TestIdentifyTables:
    def test_standard_names(self):
        tables = [
            {"nazov": {"sk": "Strana aktív"}},
            {"nazov": {"sk": "Strana pasív"}},
            {"nazov": {"sk": "Výkaz ziskov a strát"}},
        ]
        result = _identify_tables(tables)
        assert result == {"aktiv": 0, "pasiv": 1, "income": 2}

    def test_reordered_tables(self):
        tables = [
            {"nazov": {"sk": "Výkaz ziskov a strát"}},
            {"nazov": {"sk": "Strana pasív"}},
            {"nazov": {"sk": "Strana aktív"}},
        ]
        result = _identify_tables(tables)
        assert result["aktiv"] == 2
        assert result["pasiv"] == 1
        assert result["income"] == 0

    def test_missing_income_table(self):
        tables = [
            {"nazov": {"sk": "Strana aktív"}},
            {"nazov": {"sk": "Strana pasív"}},
        ]
        result = _identify_tables(tables)
        assert "aktiv" in result
        assert "pasiv" in result
        assert "income" not in result

    def test_logs_warning_on_missing_tables(self, caplog):
        """Ak aktív/pasív chýba, musí sa zalogovat warning s dostupnými názvami."""
        import logging
        tables = [
            {"nazov": {"sk": "Neznáma tabuľka"}},
        ]
        with caplog.at_level(logging.WARNING, logger="src.ruz_parser"):
            result = _identify_tables(tables)
        assert "aktiv" not in result
        assert len(caplog.records) >= 1
        assert "Available table names" in caplog.records[-1].message or \
               "Required tables" in caplog.records[-1].message

    def test_empty_tables(self):
        result = _identify_tables([])
        assert result == {}


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
                 inventory=None,
                 # Previous period values (for OCF estimation)
                 prev_trade_recv=None, prev_trade_pay=None, prev_inventory=None,
                 prev_cash=None,
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
                 _make_aktiv_row(ROW_CASH, "Peniaze", cash,
                                 netto3=str(prev_cash) if prev_cash is not None else "0"))
    if trade_recv is not None:
        _set_row(aktiv_data, ROW_TRADE_RECEIVABLES - _ACTIV_OFFSET,
                 _make_aktiv_row(ROW_TRADE_RECEIVABLES, "Pohľadávky z obch. styku",
                                 trade_recv,
                                 netto3=str(prev_trade_recv) if prev_trade_recv is not None else "0"))
    if inventory is not None:
        _set_row(aktiv_data, ROW_INVENTORY - _ACTIV_OFFSET,
                 _make_aktiv_row(ROW_INVENTORY, "Zásoby", inventory,
                                 netto3=str(prev_inventory) if prev_inventory is not None else "0"))

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
        _set_row(pasiv_data, ROW_TRADE_PAYABLES - _PASIV_OFFSET,
                 _make_pasiv_row(ROW_TRADE_PAYABLES, "Záväzky z obch. styku", trade_pay,
                                 predch=str(prev_trade_pay) if prev_trade_pay is not None else "0"), cols=5)

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
        _set_row(income_data, ROW_DEPRECIATION - _INCOME_OFFSET,
                 _make_income_row(ROW_DEPRECIATION, "Odpisy", depreciation), cols=5)
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
        """Ak aktíva < 5000 a zamestnancov > 5, deteguj tisíce EUR."""
        tables, titulna = _make_tables(
            assets=500,      # < 5000 → tisíce EUR
            equity=300,
            st_liab=100,
            lt_liab=100,
            revenue=2000,
            cogs=1200,
            pocet_zam=50,    # > 5
        )
        metrics = parse_tables_to_metrics(tables, titulna, "12345678")
        assert metrics is not None
        # Všetky hodnoty by mali byť ×1000
        assert metrics.celkove_aktiva == 500_000
        assert metrics.vlastne_imanie_celkom == 300_000
        assert metrics.trzby_z_hlavnej_cinnosti == 2_000_000
        assert metrics.hruba_marza == 800_000  # (2000 - 1200) * 1000

    def test_unit_detection_eur_normal(self):
        """Ak aktíva >= 5000, nedeteguj tisíce EUR."""
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
        """Ak aktíva < 5000 ale zamestnancov <= 5, nedeteguj tisíce EUR."""
        tables, titulna = _make_tables(
            assets=500,
            equity=300,
            st_liab=100,
            lt_liab=100,
            revenue=2000,
            cogs=1200,
            pocet_zam=4,     # <= 5 → malá firma, nie tisíce EUR
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

    def test_future_year_rejected(self):
        """Rok z budúcnosti (> current_year + 1) musí byť odmietnutý."""
        tables, titulna = _make_tables(assets=1_000_000, equity=500_000,
                                        st_liab=300_000, lt_liab=200_000)
        titulna["obdobieDo"] = "2099-12-31"
        metrics = parse_tables_to_metrics(tables, titulna, "12345678")
        assert metrics is None

    def test_current_year_accepted(self):
        """Aktuálny rok musí byť akceptovaný."""
        current_year = datetime.now().year
        tables, titulna = _make_tables(assets=1_000_000, equity=500_000,
                                        st_liab=300_000, lt_liab=200_000)
        titulna["obdobieDo"] = f"{current_year}-12-31"
        metrics = parse_tables_to_metrics(tables, titulna, "12345678")
        assert metrics is not None
        assert metrics.rok_zavierky == current_year

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

    def test_estimated_ocf_no_wc(self):
        """OCF odhadnutý z Zisk + Odpisy keď WC dáta chýbajú."""
        tables, titulna = _make_tables(
            assets=1_000_000,
            equity=500_000,
            st_liab=300_000,
            lt_liab=200_000,
            revenue=5_000_000,
            net_profit=200_000,
            depreciation=50_000,
            pocet_zam=50,
        )
        metrics = parse_tables_to_metrics(tables, titulna, "12345678")
        assert metrics is not None
        # OCF = 200k + 50k = 250k (bez WC dát)
        assert metrics.ciste_penazne_toky_z_prevadzkovej_cinnosti == 250_000.0

    def test_estimated_ocf_with_wc(self):
        """OCF odhadnutý s plnými WC dátami (prev period v Netto3 stĺpci)."""
        tables, titulna = _make_tables(
            assets=1_000_000,
            equity=500_000,
            st_liab=300_000,
            lt_liab=200_000,
            revenue=5_000_000,
            net_profit=200_000,
            depreciation=50_000,
            inventory=100_000,       # curr
            prev_inventory=80_000,   # prev (Netto3)
            trade_recv=200_000,      # curr
            prev_trade_recv=150_000, # prev
            trade_pay=120_000,       # curr
            prev_trade_pay=100_000,  # prev
            pocet_zam=50,
        )
        metrics = parse_tables_to_metrics(tables, titulna, "12345678")
        assert metrics is not None
        # OCF = 200k + 50k - (100k-80k) - (200k-150k) + (120k-100k)
        #      = 250k - 20k - 50k + 20k = 200k
        assert metrics.ciste_penazne_toky_z_prevadzkovej_cinnosti == 200_000.0

    def test_no_ocf_when_profit_missing(self):
        """Ak chýba zisk a odpisy, OCF musí byť None."""
        tables, titulna = _make_tables(
            assets=1_000_000,
            equity=500_000,
            st_liab=300_000,
            lt_liab=200_000,
            # net_profit a depreciation nie sú zadané
            pocet_zam=50,
        )
        metrics = parse_tables_to_metrics(tables, titulna, "12345678")
        assert metrics is not None
        assert metrics.ciste_penazne_toky_z_prevadzkovej_cinnosti is None


# ── Flat data format (2025+) ─────────────────────────────────────────────────

class TestFlatDataFormat:
    """Testy pre RÚZ flat array formát (od roku 2025)."""

    def _make_flat_aktiv(self, total_assets_netto2):
        """Vytvorí flat aktív data: 78 riadkov × 4 stĺpce [Brutto, Korekcia, Netto2, Netto3]."""
        data = [0] * (78 * 4)
        # ROW_TOTAL_ASSETS = 1, offset 1 → index 0 × 4 cols = [0:4]
        data[0] = total_assets_netto2  # Brutto
        data[1] = 0                    # Korekcia
        data[2] = total_assets_netto2  # Netto2 (current)
        data[3] = 0                    # Netto3 (prev)
        return data

    def _make_flat_pasiv(self, equity_value):
        """Vytvorí flat pasív data: 67 riadkov × 2 stĺpce [Bežné, Predchádzajúce]."""
        data = [0] * (67 * 2)
        # ROW_TOTAL_EQUITY = 80, offset 79 → index 1 × 2 cols = [2:4]
        data[2] = equity_value  # Bežné (current)
        data[3] = 0             # Predchádzajúce
        return data

    def test_flat_aktiv_parsing(self):
        """Parser správne číta flat aktív formát."""
        aktiv_flat = self._make_flat_aktiv(1_000_000)
        pasiv_flat = self._make_flat_pasiv(600_000)

        tables = [
            {"nazov": {"sk": "Strana aktív"}, "data": aktiv_flat},
            {"nazov": {"sk": "Strana pasív"}, "data": pasiv_flat},
        ]
        titulna = {
            "obdobieOd": "2025-01-01",
            "obdobieDo": "2025-12-31",
            "pocetZamestnancov": 100,
            "konsolidovana": False,
        }
        metrics = parse_tables_to_metrics(tables, titulna, "12345678")
        assert metrics is not None
        assert metrics.celkove_aktiva == 1_000_000
        assert metrics.vlastne_imanie_celkom == 600_000


# ── Extended fields extraction (template 699) ──────────────────────────────────

class TestExtendedFieldsExtraction:
    """Testy pre extrakciu nových polí z template 699 pomocou reálneho fixture."""

    @pytest.fixture
    def meggle_metrics(self):
        """Načíta Meggle fixture a parsne ho do FinancialMetrics."""
        import json
        from pathlib import Path
        from src.ruz_parser import _parse_single_vykaz

        fixture_path = Path(__file__).parent / "fixtures" / "meggle_31329519_2023_vykaz_9178640.json"
        if not fixture_path.exists():
            pytest.skip(f"Fixture not found: {fixture_path}")
        with open(fixture_path, "r", encoding="utf-8") as f:
            vykaz = json.load(f)
        return _parse_single_vykaz(vykaz, "31329519")

    def test_meggle_basic_fields(self, meggle_metrics):
        """Základné polia sa správne extrahovali."""
        assert meggle_metrics is not None
        assert meggle_metrics.rok_zavierky == 2023
        assert meggle_metrics.celkove_aktiva == 117_814_205
        assert meggle_metrics.vlastne_imanie_celkom == 64_757_795
        assert meggle_metrics.trzby_z_hlavnej_cinnosti == 266_277_331

    def test_meggle_asset_composition(self, meggle_metrics):
        """Štruktúra aktív — neobežný, nehmotný, hmotný majetok."""
        assert meggle_metrics.neobezny_majetok == 63_560_154
        assert meggle_metrics.dlhodoby_nehmotny_majetok == 402_792
        assert meggle_metrics.dlhodoby_hmotny_majetok == 62_544_245
        assert meggle_metrics.dlhodoby_financny_majetok == 613_117
        assert meggle_metrics.obezny_majetok == 53_890_486
        assert meggle_metrics.casove_rozlisenie_aktiv == 363_565

    def test_meggle_asset_composition_sum(self, meggle_metrics):
        """Súčet komponentov aktív = celkové aktíva (bilančná rovnica aktív)."""
        total = (
            (meggle_metrics.neobezny_majetok or 0) +
            (meggle_metrics.obezny_majetok or 0) +
            (meggle_metrics.casove_rozlisenie_aktiv or 0)
        )
        assert total == meggle_metrics.celkove_aktiva

    def test_meggle_equity_composition(self, meggle_metrics):
        """Štruktúra vlastného imania — základné imanie, fondy, nerozdelený zisk."""
        assert meggle_metrics.zakladne_imanie == 30_748_000
        assert meggle_metrics.ostatne_kapitalove_fondy == 81_636
        assert meggle_metrics.zakonne_rezervne_fondy == 2_791_230
        assert meggle_metrics.ostatne_fondy_zo_zisku == 17_591
        assert meggle_metrics.vysledok_minuly_rokov == 15_479_825
        assert meggle_metrics.nerozdeleny_zisk == 15_479_825
        assert meggle_metrics.vysledok_beziaceho_roka == 15_639_513

    def test_meggle_equity_composition_sum(self, meggle_metrics):
        """Súčet komponentov vlastného imania = celkové vlastné imanie."""
        total = (
            (meggle_metrics.zakladne_imanie or 0) +
            (meggle_metrics.emisione_azio or 0) +
            (meggle_metrics.ostatne_kapitalove_fondy or 0) +
            (meggle_metrics.zakonne_rezervne_fondy or 0) +
            (meggle_metrics.ostatne_fondy_zo_zisku or 0) +
            (meggle_metrics.vysledok_minuly_rokov or 0) +
            (meggle_metrics.vysledok_beziaceho_roka or 0)
        )
        assert total == meggle_metrics.vlastne_imanie_celkom

    def test_meggle_reserves(self, meggle_metrics):
        """Dlhodobé a krátkodobé rezervy."""
        assert meggle_metrics.dlhodobe_rezervy == 1_623_907
        assert meggle_metrics.kratkodobe_rezervy == 4_297_350

    def test_meggle_income_statement_detail(self, meggle_metrics):
        """Detail výsledovky — náklady, spotreba, služby, mzdy, dane."""
        assert meggle_metrics.naklady_na_hosp_cinnost == 246_492_614
        assert meggle_metrics.spotreba_materialu == 167_768_087
        assert meggle_metrics.sluzby == 26_443_694
        assert meggle_metrics.mzdove_naklady == 11_913_567
        assert meggle_metrics.dane_a_poplatky == 228_285
        assert meggle_metrics.odpisy == 4_652_556

    def test_meggle_profit_chain(self, meggle_metrics):
        """Reťazec zisku: fin. výsledok → pred zdanením → daň → po zdanení."""
        assert meggle_metrics.vysledok_z_fin_cinnosti == -908_697
        assert meggle_metrics.zisk_pred_zdanenim == 19_964_177
        assert meggle_metrics.dan_z_prijmu == 4_324_664
        assert meggle_metrics.zisk_alebo_strata_po_zdaneni == 15_639_513
        # Matematická kontrola: pred zdanením - daň = po zdanení
        assert meggle_metrics.zisk_pred_zdanenim - meggle_metrics.dan_z_prijmu == meggle_metrics.zisk_alebo_strata_po_zdaneni

    def test_meggle_forensic_signals(self, meggle_metrics):
        """Forenzné signály — dátum zostavenia a schválenia závierky."""
        assert meggle_metrics.datum_zostavenia == "2024-05-13"
        assert meggle_metrics.datum_schvalenia == "2024-05-16"

    def test_meggle_none_fields(self, meggle_metrics):
        """Polia, ktoré Meggle nemá, by mali byť None (nie 0)."""
        assert meggle_metrics.emisione_azio is None
        assert meggle_metrics.neuhradena_strata is None
        assert meggle_metrics.dlhodobe_pohladavky is None
        assert meggle_metrics.bezne_bankove_uvery is None
        assert meggle_metrics.prevod_podielov_spolocnikom is None


# ── Template 699 guard ─────────────────────────────────────────────────────────

class TestTemplate699Guard:
    """Testy pre template 699 guard — non-699 templates preskakujú extended polia."""

    def _make_flat_aktiv(self, total_assets):
        """Flat aktív: 74 riadkov × 4 stĺpce [Brutto, Korekcia, Netto2, Netto3]."""
        data = [0] * (74 * 4)
        # ROW_TOTAL_ASSETS = 1, offset 0 → index 0 × 4 cols
        data[0] = total_assets  # Brutto
        data[2] = total_assets  # Netto2 (current)
        return data

    def _make_flat_pasiv(self, equity_value):
        """Flat pasív: 67 riadkov × 2 stĺpce [Bežné, Predchádzajúce]."""
        data = [0] * (67 * 2)
        # ROW_TOTAL_EQUITY = 80, offset 79 → index 1 × 2 cols = [2:4]
        data[2] = equity_value
        return data

    def test_template_699_processes_normally(self):
        """Template 699 by mala byť spracovaná normálne s extended poliami."""
        aktiv_flat = self._make_flat_aktiv(1_000_000)
        pasiv_flat = self._make_flat_pasiv(600_000)
        tables = [
            {"nazov": {"sk": "Strana aktív"}, "data": aktiv_flat},
            {"nazov": {"sk": "Strana pasív"}, "data": pasiv_flat},
        ]
        titulna = {
            "obdobieOd": "2023-01-01",
            "obdobieDo": "2023-12-31",
            "pocetZamestnancov": 100,
            "konsolidovana": False,
        }
        metrics = parse_tables_to_metrics(tables, titulna, "12345678", id_sablony=699)
        assert metrics is not None
        assert metrics.celkove_aktiva == 1_000_000
        assert metrics.vlastne_imanie_celkom == 600_000

    def test_template_684_skips_extended_fields(self):
        """Konsolidovaná závierka (template 684) — základné polia OK, extended = None."""
        aktiv_flat = self._make_flat_aktiv(1_000_000)
        pasiv_flat = self._make_flat_pasiv(600_000)
        tables = [
            {"nazov": {"sk": "Strana aktív"}, "data": aktiv_flat},
            {"nazov": {"sk": "Strana pasív"}, "data": pasiv_flat},
        ]
        titulna = {
            "obdobieOd": "2023-01-01",
            "obdobieDo": "2023-12-31",
            "pocetZamestnancov": 100,
            "konsolidovana": True,
        }
        metrics = parse_tables_to_metrics(tables, titulna, "12345678", id_sablony=684)
        # Parser nevracia None — základné polia sa spracujú
        assert metrics is not None
        assert metrics.celkove_aktiva == 1_000_000
        # Extended polia by mali byť None (guard ich preskočil)
        assert metrics.neobezny_majetok is None
        assert metrics.zakladne_imanie is None
        assert metrics.naklady_na_hosp_cinnost is None

    def test_no_template_id_processes_normally(self):
        """Ak idSablony chýba (None), parser by mal fungovať (backwards compat)."""
        aktiv_flat = self._make_flat_aktiv(1_000_000)
        pasiv_flat = self._make_flat_pasiv(600_000)
        tables = [
            {"nazov": {"sk": "Strana aktív"}, "data": aktiv_flat},
            {"nazov": {"sk": "Strana pasív"}, "data": pasiv_flat},
        ]
        titulna = {
            "obdobieOd": "2023-01-01",
            "obdobieDo": "2023-12-31",
            "pocetZamestnancov": 100,
            "konsolidovana": False,
        }
        metrics = parse_tables_to_metrics(tables, titulna, "12345678", id_sablony=None)
        assert metrics is not None
        assert metrics.celkove_aktiva == 1_000_000
