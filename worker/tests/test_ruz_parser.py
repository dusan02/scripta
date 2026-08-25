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
    ROW_OPERATING_COSTS,
    ROW_MATERIAL_CONSUMPTION,
    ROW_SERVICES,
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
                 revenue=None, cogs=None, material_consumption=None, services=None,
                 personnel=None, net_profit=None,
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
        _set_row(income_data, ROW_OPERATING_COSTS - _INCOME_OFFSET,
                 _make_income_row(ROW_OPERATING_COSTS, "Náklady na hosp. činnosť", cogs), cols=5)
    if material_consumption is not None:
        _set_row(income_data, ROW_MATERIAL_CONSUMPTION - _INCOME_OFFSET,
                 _make_income_row(ROW_MATERIAL_CONSUMPTION, "Spotreba materiálu", material_consumption), cols=5)
    if services is not None:
        _set_row(income_data, ROW_SERVICES - _INCOME_OFFSET,
                 _make_income_row(ROW_SERVICES, "Služby", services), cols=5)
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

    def test_gross_margin_from_material_and_services(self):
        """Hrubá marža = Tržby - (Spotreba materiálu + Služby). NIE operating_costs (r.10)."""
        tables, titulna = _make_tables(
            assets=1_000_000,
            equity=500_000,
            st_liab=300_000,
            lt_liab=200_000,
            revenue=5_000_000,
            material_consumption=2_000_000,
            services=1_000_000,
            pocet_zam=50,
        )
        metrics = parse_tables_to_metrics(tables, titulna, "12345678")
        assert metrics is not None
        # hruba_marza = Tržby - (Spotreba + Služby) = 5M - (2M + 1M) = 2M
        assert metrics.hruba_marza == 2_000_000

    def test_gross_margin_only_material(self):
        """Hrubá marža keď chýbajú služby — Tržby - Spotreba materiálu."""
        tables, titulna = _make_tables(
            assets=1_000_000,
            equity=500_000,
            st_liab=300_000,
            lt_liab=200_000,
            revenue=5_000_000,
            material_consumption=3_000_000,
            pocet_zam=50,
        )
        metrics = parse_tables_to_metrics(tables, titulna, "12345678")
        assert metrics is not None
        # hruba_marza = 5M - 3M = 2M
        assert metrics.hruba_marza == 2_000_000

    def test_gross_margin_ignores_operating_costs(self):
        """Riadok 10 (operating_costs) sa NEpoužíva pre hrubú maržu — zahŕňa mzdy, odpisy."""
        tables, titulna = _make_tables(
            assets=1_000_000,
            equity=500_000,
            st_liab=300_000,
            lt_liab=200_000,
            revenue=5_000_000,
            cogs=4_000_000,  # operating_costs (r.10) — should NOT be used as COGS
            pocet_zam=50,
        )
        metrics = parse_tables_to_metrics(tables, titulna, "12345678")
        assert metrics is not None
        # Bez spotreba/services → fallback na Pridanú hodnotu (None tu) → hruba_marza = None
        assert metrics.hruba_marza is None

    def test_gross_margin_no_cogs_returns_none(self):
        """Bez spotreba/services → hruba_marza = None (pridaná hodnota je NEvhodný proxy)."""
        tables, titulna = _make_tables(
            assets=1_000_000,
            equity=500_000,
            st_liab=300_000,
            lt_liab=200_000,
            revenue=5_000_000,
            value_added=1_500_000,
            pocet_zam=50,
        )
        metrics = parse_tables_to_metrics(tables, titulna, "12345678")
        assert metrics is not None
        # Bez COGS dát nie je hrubá marža spoľahlivo vypočítateľná
        assert metrics.hruba_marza is None

    def test_unit_detection_thousands_eur(self):
        """Ak aktíva < 5000 a zamestnancov > 5, deteguj tisíce EUR."""
        tables, titulna = _make_tables(
            assets=500,      # < 5000 → tisíce EUR
            equity=300,
            st_liab=100,
            lt_liab=100,
            revenue=2000,
            material_consumption=800,
            services=400,
            pocet_zam=50,    # > 5
        )
        metrics = parse_tables_to_metrics(tables, titulna, "12345678")
        assert metrics is not None
        # Všetky hodnoty by mali byť ×1000
        assert metrics.celkove_aktiva == 500_000
        assert metrics.vlastne_imanie_celkom == 300_000
        assert metrics.trzby_z_hlavnej_cinnosti == 2_000_000
        assert metrics.hruba_marza == 800_000  # (2000 - (800+400)) * 1000

    def test_unit_detection_eur_normal(self):
        """Ak aktíva >= 5000, nedeteguj tisíce EUR."""
        tables, titulna = _make_tables(
            assets=500_000,
            equity=300_000,
            st_liab=100_000,
            lt_liab=100_000,
            revenue=2_000_000,
            material_consumption=800_000,
            services=400_000,
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
            material_consumption=800,
            services=400,
            pocet_zam=4,     # <= 5 → malá firma, nie tisíce EUR
        )
        metrics = parse_tables_to_metrics(tables, titulna, "12345678")
        assert metrics is not None
        # Žiadny multiplier
        assert metrics.celkove_aktiva == 500
        assert metrics.hruba_marza == 800  # 2000 - (800+400)

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


# ── Regression: data_cols dynamic detection (balance-sheet parser bug fix) ──

class TestActivDataColsDynamic:
    """Regression tests pre dynamic data_cols detection v _get_activ_value.

    Bug: parser hard-coded data_cols=4 pre aktív tabuľku. Ak šablóna mala
    pocetDatovychStlpcov=2 (zjednodušený formát), extrakcia zlyhala →
    totalAssets/currentAssets boli NULL aj keď dáta existovali.
    Fix: _get_activ_value číta pocetDatovychStlpcov z tabuľky metadata.
    """

    def _make_aktiv_2col_lol(self, total_assets: float, current_assets: float = 0):
        """Aktív tabuľka s 2 dátovými stĺpcami (zjednodušený formát), list-of-lists."""
        data = []
        for i in range(78):
            current = total_assets if i == 0 else (current_assets if i == 32 else 0)
            prev = total_assets * 0.9 if i == 0 else (current_assets * 0.9 if i == 32 else 0)
            data.append([str(current), str(prev)])
        return data

    def _make_pasiv_2col_lol(self, equity: float):
        """Pasív tabuľka s 2 dátovými stĺpcami, list-of-lists."""
        data = []
        for i in range(67):
            current = equity if i == 1 else 0  # row 80 = idx 1 (offset 79)
            prev = equity * 0.9 if i == 1 else 0
            data.append([str(current), str(prev)])
        return data

    def test_aktiv_2col_extracts_total_assets(self):
        """Aktív s pocetDatovychStlpcov=2 by mal extrahovať totalAssets z col 0."""
        from src.ruz_parser import _get_activ_value
        tables = [
            {"nazov": {"sk": "Strana aktív"}, "pocetDatovychStlpcov": 2, "data": self._make_aktiv_2col_lol(500_000)},
        ]
        val = _get_activ_value(tables, ROW_TOTAL_ASSETS, current=True)
        assert val == 500_000.0

    def test_aktiv_2col_extracts_current_assets(self):
        """Aktív s pocetDatovychStlpcov=2 by mal extrahovať currentAssets z col 0."""
        from src.ruz_parser import _get_activ_value
        tables = [
            {"nazov": {"sk": "Strana aktív"}, "pocetDatovychStlpcov": 2, "data": self._make_aktiv_2col_lol(500_000, 200_000)},
        ]
        val = _get_activ_value(tables, ROW_CURRENT_ASSETS, current=True)
        assert val == 200_000.0

    def test_aktiv_4col_still_works(self):
        """Aktív s pocetDatovychStlpcov=4 (štandard) by mal naďalej fungovať."""
        from src.ruz_parser import _get_activ_value
        # Standard 4-col LOL: [Brutto, Korekcia, Netto2, Netto3]
        data = []
        for i in range(78):
            netto2 = 500_000 if i == 0 else 0
            netto3 = 450_000 if i == 0 else 0
            data.append(["100", "0", str(netto2), str(netto3)])
        tables = [
            {"nazov": {"sk": "Strana aktív"}, "pocetDatovychStlpcov": 4, "data": data},
        ]
        val = _get_activ_value(tables, ROW_TOTAL_ASSETS, current=True)
        assert val == 500_000.0

    def test_aktiv_default_4col_when_metadata_missing(self):
        """Ak pocetDatovychStlpcov chýba, default=4 (backwards compat)."""
        from src.ruz_parser import _get_activ_value
        data = []
        for i in range(78):
            netto2 = 500_000 if i == 0 else 0
            netto3 = 450_000 if i == 0 else 0
            data.append(["100", "0", str(netto2), str(netto3)])
        tables = [
            {"nazov": {"sk": "Strana aktív"}, "data": data},  # no pocetDatovychStlpcov
        ]
        val = _get_activ_value(tables, ROW_TOTAL_ASSETS, current=True)
        assert val == 500_000.0

    def test_aktiv_2col_preceding_period(self):
        """Aktív s 2 col: preceding period = col 1."""
        from src.ruz_parser import _get_activ_value
        tables = [
            {"nazov": {"sk": "Strana aktív"}, "pocetDatovychStlpcov": 2, "data": self._make_aktiv_2col_lol(500_000)},
        ]
        val = _get_activ_value(tables, ROW_TOTAL_ASSETS, current=False)
        assert val == 450_000.0  # 500_000 * 0.9

    def test_full_parse_2col_balance_sheet(self):
        """Kompletný parse_tables_to_metrics s 2-col aktív tabuľkou."""
        aktiv = self._make_aktiv_2col_lol(1_000_000, 400_000)
        pasiv = self._make_pasiv_2col_lol(600_000)
        tables = [
            {"nazov": {"sk": "Strana aktív"}, "pocetDatovychStlpcov": 2, "data": aktiv},
            {"nazov": {"sk": "Strana pasív"}, "pocetDatovychStlpcov": 2, "data": pasiv},
        ]
        titulna = {
            "obdobieOd": "2023-01-01",
            "obdobieDo": "2023-12-31",
            "pocetZamestnancov": 10,
            "konsolidovana": False,
        }
        metrics = parse_tables_to_metrics(tables, titulna, "12345678", id_sablony=699)
        assert metrics is not None
        assert metrics.celkove_aktiva == 1_000_000
        assert metrics.obezny_majetok == 400_000
        assert metrics.vlastne_imanie_celkom == 600_000

    def test_aktiv_empty_tables(self):
        """_get_activ_value s prázdnymi tables by mal vrátiť None, nie crash."""
        from src.ruz_parser import _get_activ_value
        assert _get_activ_value([], ROW_TOTAL_ASSETS) is None
        assert _get_activ_value(None, ROW_TOTAL_ASSETS) is None


# ── Regression: template 687 balance-sheet row mapping ──

class TestTemplate687BalanceSheet:
    """Regression tests pre template 687 (micro-firm) balance sheet parsing.

    Bug: parser used 699 row mapping (r.33=currentAssets) + data_cols=4 for ALL templates.
    687 has different row mapping (r.14=currentAssets) + data_cols=2.
    Result: totalAssets was actually nonCurrentAssets, currentAssets was always NULL.
    Fix: detect id_sablony=687 and use 687 row mapping + data_cols=2.
    """

    def _make_687_aktiv_flat(self, total_assets=57062, non_current=7671, current=49391, cash=47467):
        """687 aktív: 23 rows × 2 cols = 46 flat values [current, previous]."""
        data = []
        for i in range(23):
            cur = prev = ""
            if i == 0:   cur, prev = str(total_assets), str(int(total_assets * 0.9))
            elif i == 1: cur, prev = str(non_current), str(int(non_current * 0.9))
            elif i == 13: cur, prev = str(current), str(int(current * 0.9))  # r.14 = Obežný
            elif i == 14: cur, prev = "1000", "900"  # r.15 = Zásoby
            elif i == 16: cur, prev = "2000", "1800"  # r.17 = Krátkodobé pohľadávky
            elif i == 17: cur, prev = "1500", "1400"  # r.18 = Pohľadávky z obch.styku
            elif i == 20: cur, prev = str(cash), str(int(cash * 0.9))  # r.21 = Fin.majetok
            elif i == 21: cur, prev = str(cash), str(int(cash * 0.9))  # r.22 = Peniaze
            data.extend([cur, prev])
        return data

    def _make_687_pasiv_flat(self, equity=42987, total_liab=14075, st_liab=11785, trade_pay=9036):
        """687 pasív: 22 rows × 2 cols = 44 flat values [current, previous]."""
        data = []
        for i in range(22):
            cur = prev = ""
            if i == 1:   cur, prev = str(equity), str(int(equity * 0.9))      # r.25 = Vlastné imanie
            elif i == 2: cur, prev = "5000", "5000"                            # r.26 = Základné imanie
            elif i == 10: cur, prev = str(total_liab), str(int(total_liab * 0.9))  # r.34 = Záväzky
            elif i == 11: cur, prev = "2000", "1800"                           # r.35 = Dlhodobé
            elif i == 14: cur, prev = str(st_liab), str(int(st_liab * 0.9))   # r.38 = Krátkodobé
            elif i == 15: cur, prev = str(trade_pay), str(int(trade_pay * 0.9))  # r.39 = Obchodné
            data.extend([cur, prev])
        return data

    def test_687_total_assets_correct(self):
        """687: totalAssets by mal byť r.1 (SPOLU MAJETOK), nie r.2 (Neobežný)."""
        from src.ruz_parser import _get_activ_value, ROW_MICRO_TOTAL_ASSETS
        tables = [{"nazov": {"sk": "Strana aktív"}, "data": self._make_687_aktiv_flat(total_assets=57062)}]
        val = _get_activ_value(tables, ROW_MICRO_TOTAL_ASSETS, id_sablony=687)
        assert val == 57062.0  # NOT 7671 (which is nonCurrentAssets)

    def test_687_current_assets_correct(self):
        """687: currentAssets = r.14 (Obežný majetok), nie r.33 (out of range)."""
        from src.ruz_parser import _get_activ_value, ROW_MICRO_CURRENT_ASSETS
        tables = [{"nazov": {"sk": "Strana aktív"}, "data": self._make_687_aktiv_flat(current=49391)}]
        val = _get_activ_value(tables, ROW_MICRO_CURRENT_ASSETS, id_sablony=687)
        assert val == 49391.0

    def test_687_cash_correct(self):
        """687: cash = r.22 (Peniaze)."""
        from src.ruz_parser import _get_activ_value, ROW_MICRO_CASH
        tables = [{"nazov": {"sk": "Strana aktív"}, "data": self._make_687_aktiv_flat(cash=47467)}]
        val = _get_activ_value(tables, ROW_MICRO_CASH, id_sablony=687)
        assert val == 47467.0

    def test_687_equity_correct(self):
        """687: equity = r.25 (Vlastné imanie)."""
        from src.ruz_parser import _get_pasiv_value, ROW_MICRO_TOTAL_EQUITY
        tables = [
            {"nazov": {"sk": "Strana aktív"}, "data": self._make_687_aktiv_flat()},
            {"nazov": {"sk": "Strana pasív"}, "data": self._make_687_pasiv_flat(equity=42987)},
        ]
        val = _get_pasiv_value(tables, ROW_MICRO_TOTAL_EQUITY, id_sablony=687)
        assert val == 42987.0

    def test_687_short_term_liabilities_correct(self):
        """687: shortTermLiabilities = r.38."""
        from src.ruz_parser import _get_pasiv_value, ROW_MICRO_ST_LIABILITIES
        tables = [
            {"nazov": {"sk": "Strana aktív"}, "data": self._make_687_aktiv_flat()},
            {"nazov": {"sk": "Strana pasív"}, "data": self._make_687_pasiv_flat(st_liab=11785)},
        ]
        val = _get_pasiv_value(tables, ROW_MICRO_ST_LIABILITIES, id_sablony=687)
        assert val == 11785.0

    def test_687_full_parse_balance_sheet(self):
        """Kompletný parse 687 balance sheet — overuje všetky polia."""
        aktiv = self._make_687_aktiv_flat(total_assets=57062, non_current=7671, current=49391, cash=47467)
        pasiv = self._make_687_pasiv_flat(equity=42987, total_liab=14075, st_liab=11785, trade_pay=9036)
        tables = [
            {"nazov": {"sk": "Strana aktív"}, "data": aktiv},
            {"nazov": {"sk": "Strana pasív"}, "data": pasiv},
        ]
        titulna = {
            "obdobieOd": "2021-01-01",
            "obdobieDo": "2021-12-31",
            "pocetZamestnancov": 0,
            "konsolidovana": False,
        }
        metrics = parse_tables_to_metrics(tables, titulna, "46958819", id_sablony=687)
        assert metrics is not None
        assert metrics.celkove_aktiva == 57062.0   # NOT 7671!
        assert metrics.obezny_majetok == 49391.0   # NOT NULL!
        assert metrics.peniaze_a_penazne_ekvivalenty_k_31_12 == 47467.0
        assert metrics.vlastne_imanie_celkom == 42987.0
        assert metrics.kratkodobe_zavazky == 11785.0  # NOT NULL!
        assert metrics.zavazky_z_obchodneho_styku == 9036.0

    def test_687_vs_699_total_assets_different(self):
        """Rovnaké dáta interpretované ako 687 vs 699 dávajú rôzny totalAssets."""
        from src.ruz_parser import _get_activ_value, ROW_MICRO_TOTAL_ASSETS, ROW_TOTAL_ASSETS
        data = self._make_687_aktiv_flat(total_assets=57062, non_current=7671)
        tables = [{"nazov": {"sk": "Strana aktív"}, "data": data}]

        # 687: r.1, data_cols=2, target=0 → 57062
        val_687 = _get_activ_value(tables, ROW_MICRO_TOTAL_ASSETS, id_sablony=687)
        assert val_687 == 57062.0

        # 699: r.1, data_cols=4, target=2 → 7671 (WRONG — that's nonCurrentAssets)
        val_699 = _get_activ_value(tables, ROW_TOTAL_ASSETS, id_sablony=699)
        assert val_699 == 7671.0  # This is the bug — 699 mapping on 687 data gives wrong value
