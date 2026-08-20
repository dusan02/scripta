"""
Golden fixture builder for RÚZ financial-data ingestion regression tests.

Generates realistic, anonymized RÚZ API responses for templates 687 and 699,
source-gap conditions, partial-data cases, and malformed responses.

All values are deliberately distinct to detect cross-row / cross-column
contamination — the historical bug caused values from neighbouring rows to
be interpreted as totalAssets.

Fixture categories (18 total):
  - 5 × template 687 (micro-firm, full balance sheet + income)
  - 5 × template 699 (standard SK GAAP, full balance sheet + income)
  - 3 × SOURCE_GAP (template exists, tables have 0 rows)
  - 3 × partial-data (some fields present, some missing)
  - 2 × malformed/unexpected API responses

Each fixture is a dict with:
  {
    "name": str,
    "category": str,  # "687" | "699" | "source_gap" | "partial" | "malformed"
    "vykaz": dict,    # RÚZ uctovny-vykaz response
    "expected": dict, # expected parsed metrics + dataQualityStatus
  }
"""
from __future__ import annotations

from src.ruz_parser import (
    ROW_TOTAL_ASSETS, ROW_NON_CURRENT_ASSETS, ROW_CURRENT_ASSETS,
    ROW_INVENTORY, ROW_CASH, ROW_TRADE_RECEIVABLES, ROW_TOTAL_EQUITY,
    ROW_LT_LIABILITIES, ROW_ST_LIABILITIES, ROW_TRADE_PAYABLES,
    ROW_NET_REVENUE, ROW_OPERATING_COSTS, ROW_MATERIAL_CONSUMPTION,
    ROW_SERVICES, ROW_PERSONNEL_COSTS, ROW_DEPRECIATION,
    ROW_INTEREST_EXPENSE, ROW_NET_PROFIT, ROW_VALUE_ADDED,
    ROW_PROFIT_BEFORE_TAX, ROW_INCOME_TAX, ROW_FINANCIAL_RESULT,
    ROW_MICRO_TOTAL_ASSETS, ROW_MICRO_NON_CURRENT_ASSETS,
    ROW_MICRO_CURRENT_ASSETS, ROW_MICRO_INVENTORY,
    ROW_MICRO_TRADE_RECEIVABLES, ROW_MICRO_CASH, ROW_MICRO_FINANCIAL_ASSETS,
    ROW_MICRO_TOTAL_EQUITY, ROW_MICRO_TOTAL_EQUITY_LIAB,
    ROW_MICRO_TOTAL_LIABILITIES,
    ROW_MICRO_LT_LIABILITIES, ROW_MICRO_ST_LIABILITIES,
    ROW_MICRO_TRADE_PAYABLES, ROW_MICRO_SHARE_CAPITAL,
    ROW_MICRO_NET_PROFIT, ROW_MICRO_OPERATING_COSTS,
    ROW_MICRO_MATERIAL_CONSUMPTION, ROW_MICRO_SERVICES,
    ROW_MICRO_PERSONNEL_COSTS, ROW_MICRO_DEPRECIATION,
    ROW_MICRO_INTEREST_EXPENSE, ROW_MICRO_FINANCIAL_RESULT,
    ROW_MICRO_PROFIT_BEFORE_TAX, ROW_MICRO_INCOME_TAX,
    ROW_MICRO_PROFIT_TRANSFER, ROW_MICRO_OPERATING_PROFIT,
    ROW_MICRO_VALUE_ADDED,
    _ACTIV_OFFSET, _PASIV_OFFSET, _INCOME_OFFSET,
    compute_data_quality_status,
)


# ── Helpers ──────────────────────────────────────────────────────────────────

def _aktiv_row_699(cislo: int, text: str, netto2, netto3="0"):
    """699 aktív row: [Ozn, Text, Cislo, Brutto, Korekcia, Netto2, Netto3]"""
    return ["Ozn", text, str(cislo), str(netto2), "0", str(netto2), str(netto3)]


def _pasiv_row_699(cislo: int, text: str, bezne, predch="0"):
    """699 pasív row: [Ozn, Text, Cislo, Bežné, Predchádzajúce]"""
    return ["Ozn", text, str(cislo), str(bezne), str(predch)]


def _income_row_699(cislo: int, text: str, bezne, predch="0"):
    """699 income row: [Ozn, Text, Cislo, Bežné, Predchádzajúce]"""
    return ["Ozn", text, str(cislo), str(bezne), str(predch)]


def _set_row(arr, idx, row, cols=7):
    """Ensure array is large enough, then set row at idx."""
    while len(arr) <= idx:
        arr.append(["", "", str(len(arr) + 1)] + [""] * (cols - 3))
    arr[idx] = row


def _make_687_aktiv_flat(total_assets, non_current, current, inventory,
                         trade_recv, cash, financial_assets=None):
    """687 aktív: 23 rows × 2 cols = 46 flat values [current, previous].

    All values deliberately distinct to detect cross-row contamination.
    """
    data = []
    for i in range(23):
        cur = prev = ""
        r = i + 1  # cisloRiadku = index + 1
        if r == ROW_MICRO_TOTAL_ASSETS:          # r.1
            cur, prev = str(total_assets), str(int(total_assets * 0.9))
        elif r == ROW_MICRO_NON_CURRENT_ASSETS:  # r.2
            cur, prev = str(non_current), str(int(non_current * 0.9))
        elif r == ROW_MICRO_CURRENT_ASSETS:      # r.14
            cur, prev = str(current), str(int(current * 0.9))
        elif r == ROW_MICRO_INVENTORY:           # r.15
            cur, prev = str(inventory), str(int(inventory * 0.9))
        elif r == 17:                            # r.17 = Krátkodobé pohľadávky súčet
            cur, prev = str(trade_recv + 500), str(int((trade_recv + 500) * 0.9))
        elif r == ROW_MICRO_TRADE_RECEIVABLES:   # r.18
            cur, prev = str(trade_recv), str(int(trade_recv * 0.9))
        elif r == ROW_MICRO_FINANCIAL_ASSETS:    # r.21
            cur, prev = str(financial_assets or cash), str(int((financial_assets or cash) * 0.9))
        elif r == ROW_MICRO_CASH:                # r.22
            cur, prev = str(cash), str(int(cash * 0.9))
        data.extend([cur, prev])
    return data


def _make_687_pasiv_flat(equity, share_capital, total_liab,
                         lt_liab, st_liab, trade_pay):
    """687 pasív: 22 rows × 2 cols = 44 flat values [current, previous]."""
    data = []
    for i in range(22):
        cur = prev = ""
        r = i + 24  # pasív starts at r.24
        if r == ROW_MICRO_TOTAL_EQUITY_LIAB:      # r.24
            cur, prev = str(equity + total_liab), str(int((equity + total_liab) * 0.9))
        elif r == ROW_MICRO_TOTAL_EQUITY:         # r.25
            cur, prev = str(equity), str(int(equity * 0.9))
        elif r == ROW_MICRO_SHARE_CAPITAL:        # r.26
            cur, prev = str(share_capital), str(share_capital)
        elif r == ROW_MICRO_TOTAL_LIABILITIES:    # r.34
            cur, prev = str(total_liab), str(int(total_liab * 0.9))
        elif r == ROW_MICRO_LT_LIABILITIES:       # r.35
            cur, prev = str(lt_liab), str(int(lt_liab * 0.9))
        elif r == ROW_MICRO_ST_LIABILITIES:       # r.38
            cur, prev = str(st_liab), str(int(st_liab * 0.9))
        elif r == ROW_MICRO_TRADE_PAYABLES:       # r.39
            cur, prev = str(trade_pay), str(int(trade_pay * 0.9))
        data.extend([cur, prev])
    return data


def _make_687_income_flat(revenue, operating_costs, material, services,
                          personnel, depreciation, operating_profit,
                          value_added, interest, fin_result,
                          profit_before_tax, income_tax, net_profit):
    """687 income: 38 rows × 2 cols = 76 flat values [current, previous]."""
    data = []
    for i in range(38):
        cur = prev = ""
        r = i + 1  # cisloRiadku = index + 1
        if r == 1:   cur, prev = str(revenue), str(int(revenue * 0.9))
        elif r == 3: cur, prev = str(int(revenue * 0.8)), str(int(revenue * 0.7))
        elif r == ROW_MICRO_OPERATING_COSTS:  cur, prev = str(operating_costs), str(int(operating_costs * 0.9))
        elif r == ROW_MICRO_MATERIAL_CONSUMPTION: cur, prev = str(material), str(int(material * 0.9))
        elif r == ROW_MICRO_SERVICES: cur, prev = str(services), str(int(services * 0.9))
        elif r == ROW_MICRO_PERSONNEL_COSTS: cur, prev = str(personnel), str(int(personnel * 0.9))
        elif r == ROW_MICRO_DEPRECIATION: cur, prev = str(depreciation), str(int(depreciation * 0.9))
        elif r == ROW_MICRO_OPERATING_PROFIT: cur, prev = str(operating_profit), str(int(operating_profit * 0.9))
        elif r == ROW_MICRO_VALUE_ADDED: cur, prev = str(value_added), str(int(value_added * 0.9))
        elif r == ROW_MICRO_INTEREST_EXPENSE: cur, prev = str(interest), str(int(interest * 0.9))
        elif r == ROW_MICRO_FINANCIAL_RESULT: cur, prev = str(fin_result), str(int(fin_result * 0.9))
        elif r == ROW_MICRO_PROFIT_BEFORE_TAX: cur, prev = str(profit_before_tax), str(int(profit_before_tax * 0.9))
        elif r == ROW_MICRO_INCOME_TAX: cur, prev = str(income_tax), str(int(income_tax * 0.9))
        elif r == ROW_MICRO_PROFIT_TRANSFER: cur, prev = "0", "0"
        elif r == ROW_MICRO_NET_PROFIT: cur, prev = str(net_profit), str(int(net_profit * 0.9))
        data.extend([cur, prev])
    return data


def _make_699_tables(assets, non_current, current, inventory, trade_recv, cash,
                     equity, share_capital, lt_liab, st_liab, trade_pay,
                     revenue, operating_costs, material, services, personnel,
                     depreciation, net_profit, profit_before_tax=None,
                     income_tax=None, interest=None, fin_result=None,
                     value_added=None, obdobie_do="2023-12-31",
                     pocet_zam=100):
    """Build complete 699 tables (list-of-lists format) with distinct values."""
    aktiv_data = []
    _set_row(aktiv_data, ROW_TOTAL_ASSETS - _ACTIV_OFFSET,
             _aktiv_row_699(ROW_TOTAL_ASSETS, "SPOLU AKTÍVA", assets))
    _set_row(aktiv_data, ROW_NON_CURRENT_ASSETS - _ACTIV_OFFSET,
             _aktiv_row_699(ROW_NON_CURRENT_ASSETS, "Neobežný majetok", non_current))
    _set_row(aktiv_data, ROW_CURRENT_ASSETS - _ACTIV_OFFSET,
             _aktiv_row_699(ROW_CURRENT_ASSETS, "Obežný majetok", current))
    _set_row(aktiv_data, ROW_INVENTORY - _ACTIV_OFFSET,
             _aktiv_row_699(ROW_INVENTORY, "Zásoby", inventory))
    _set_row(aktiv_data, ROW_TRADE_RECEIVABLES - _ACTIV_OFFSET,
             _aktiv_row_699(ROW_TRADE_RECEIVABLES, "Pohľadávky z obch. styku", trade_recv))
    _set_row(aktiv_data, ROW_CASH - _ACTIV_OFFSET,
             _aktiv_row_699(ROW_CASH, "Peniaze", cash))

    pasiv_data = []
    _set_row(pasiv_data, ROW_TOTAL_EQUITY - _PASIV_OFFSET,
             _pasiv_row_699(ROW_TOTAL_EQUITY, "Vlastné imanie", equity), cols=5)
    _set_row(pasiv_data, 81 - _PASIV_OFFSET,
             _pasiv_row_699(81, "Základné imanie", share_capital), cols=5)
    _set_row(pasiv_data, ROW_LT_LIABILITIES - _PASIV_OFFSET,
             _pasiv_row_699(ROW_LT_LIABILITIES, "Dlhodobé záväzky", lt_liab), cols=5)
    _set_row(pasiv_data, ROW_ST_LIABILITIES - _PASIV_OFFSET,
             _pasiv_row_699(ROW_ST_LIABILITIES, "Krátkodobé záväzky", st_liab), cols=5)
    _set_row(pasiv_data, ROW_TRADE_PAYABLES - _PASIV_OFFSET,
             _pasiv_row_699(ROW_TRADE_PAYABLES, "Záväzky z obch. styku", trade_pay), cols=5)

    income_data = []
    _set_row(income_data, ROW_NET_REVENUE - _INCOME_OFFSET,
             _income_row_699(ROW_NET_REVENUE, "Čistý obrat", revenue), cols=5)
    _set_row(income_data, ROW_OPERATING_COSTS - _INCOME_OFFSET,
             _income_row_699(ROW_OPERATING_COSTS, "Náklady na hosp. činnosť", operating_costs), cols=5)
    _set_row(income_data, ROW_MATERIAL_CONSUMPTION - _INCOME_OFFSET,
             _income_row_699(ROW_MATERIAL_CONSUMPTION, "Spotreba materiálu", material), cols=5)
    _set_row(income_data, ROW_SERVICES - _INCOME_OFFSET,
             _income_row_699(ROW_SERVICES, "Služby", services), cols=5)
    _set_row(income_data, ROW_PERSONNEL_COSTS - _INCOME_OFFSET,
             _income_row_699(ROW_PERSONNEL_COSTS, "Osobné náklady", personnel), cols=5)
    _set_row(income_data, ROW_DEPRECIATION - _INCOME_OFFSET,
             _income_row_699(ROW_DEPRECIATION, "Odpisy", depreciation), cols=5)
    if value_added is not None:
        _set_row(income_data, ROW_VALUE_ADDED - _INCOME_OFFSET,
                 _income_row_699(ROW_VALUE_ADDED, "Pridaná hodnota", value_added), cols=5)
    if interest is not None:
        _set_row(income_data, 49 - _INCOME_OFFSET,
                 _income_row_699(49, "Nákladové úroky", interest), cols=5)
    if fin_result is not None:
        _set_row(income_data, ROW_FINANCIAL_RESULT - _INCOME_OFFSET,
                 _income_row_699(ROW_FINANCIAL_RESULT, "Výsledok z fin. činnosti", fin_result), cols=5)
    if profit_before_tax is not None:
        _set_row(income_data, ROW_PROFIT_BEFORE_TAX - _INCOME_OFFSET,
                 _income_row_699(ROW_PROFIT_BEFORE_TAX, "Výsledok pred zdanením", profit_before_tax), cols=5)
    if income_tax is not None:
        _set_row(income_data, ROW_INCOME_TAX - _INCOME_OFFSET,
                 _income_row_699(ROW_INCOME_TAX, "Daň z príjmov", income_tax), cols=5)
    _set_row(income_data, ROW_NET_PROFIT - _INCOME_OFFSET,
             _income_row_699(ROW_NET_PROFIT, "Výsledok po zdanení", net_profit), cols=5)

    tables = [
        {"nazov": {"sk": "Strana aktív"}, "data": aktiv_data},
        {"nazov": {"sk": "Strana pasív"}, "data": pasiv_data},
        {"nazov": {"sk": "Výkaz ziskov a strát"}, "data": income_data},
    ]
    titulna = {
        "obdobieOd": "2023-01-01",
        "obdobieDo": obdobie_do,
        "pocetZamestnancov": pocet_zam,
        "konsolidovana": False,
    }
    return tables, titulna


def _make_687_vykaz(total_assets, non_current, current, inventory,
                    trade_recv, cash, equity, share_capital,
                    total_liab, lt_liab, st_liab, trade_pay,
                    revenue, operating_costs, material, services,
                    personnel, depreciation, operating_profit,
                    value_added, interest, fin_result,
                    profit_before_tax, income_tax, net_profit,
                    obdobie_do="2021-12-31", pocet_zam=0):
    """Build complete 687 vykaz response (flat data format)."""
    aktiv = _make_687_aktiv_flat(total_assets, non_current, current, inventory,
                                  trade_recv, cash)
    pasiv = _make_687_pasiv_flat(equity, share_capital, total_liab,
                                  lt_liab, st_liab, trade_pay)
    income = _make_687_income_flat(revenue, operating_costs, material, services,
                                    personnel, depreciation, operating_profit,
                                    value_added, interest, fin_result,
                                    profit_before_tax, income_tax, net_profit)
    tables = [
        {"nazov": {"sk": "Strana aktív"}, "data": aktiv},
        {"nazov": {"sk": "Strana pasív"}, "data": pasiv},
        {"nazov": {"sk": "Výkaz ziskov a strát"}, "data": income},
    ]
    return {
        "id": 9999999,
        "idSablony": 687,
        "obsah": {
            "tabulky": tables,
            "titulnaStrana": {
                "obdobieOd": "2021-01-01",
                "obdobieDo": obdobie_do,
                "pocetZamestnancov": pocet_zam,
                "konsolidovana": False,
            },
        },
    }


def _make_699_vykaz(**kwargs):
    """Build complete 699 vykaz response (list-of-lists format)."""
    tables, titulna = _make_699_tables(**kwargs)
    return {
        "id": 8888888,
        "idSablony": 699,
        "obsah": {
            "tabulky": tables,
            "titulnaStrana": titulna,
        },
    }


# ── GOLDEN FIXTURES ──────────────────────────────────────────────────────────
# All values deliberately distinct to detect cross-row contamination.
# The historical bug caused totalAssets to contain nonCurrentAssets values.

GOLDEN_FIXTURES = []


# ── 5 × template 687 ─────────────────────────────────────────────────────────

GOLDEN_FIXTURES.append({
    "name": "687_full_01",
    "category": "687",
    "vykaz": _make_687_vykaz(
        total_assets=57062, non_current=7671, current=49391,
        inventory=1000, trade_recv=1500, cash=47467,
        equity=42987, share_capital=5000,
        total_liab=14075, lt_liab=2000, st_liab=11785, trade_pay=9036,
        revenue=120000, operating_costs=90000, material=30000,
        services=20000, personnel=15000, depreciation=5000,
        operating_profit=30000, value_added=35000,
        interest=2000, fin_result=-2000,
        profit_before_tax=28000, income_tax=5600, net_profit=22400,
    ),
    "expected": {
        "dataQualityStatus": "AVAILABLE",
        "celkove_aktiva": 57062.0,
        "obezny_majetok": 49391.0,
        "vlastne_imanie_celkom": 42987.0,
        "kratkodobe_zavazky": 11785.0,
        "peniaze_a_penazne_ekvivalenty_k_31_12": 47467.0,
        "pohladavky_z_obchodneho_styku": 1500.0,
        "zavazky_z_obchodneho_styku": 9036.0,
        "zasoby": 1000.0,
        "trzby_z_hlavnej_cinnosti": 120000.0,
        "zisk_alebo_strata_po_zdaneni": 22400.0,
    },
})

GOLDEN_FIXTURES.append({
    "name": "687_full_02",
    "category": "687",
    "vykaz": _make_687_vykaz(
        total_assets=100000, non_current=30000, current=70000,
        inventory=5000, trade_recv=20000, cash=45000,
        equity=60000, share_capital=10000,
        total_liab=40000, lt_liab=10000, st_liab=30000, trade_pay=15000,
        revenue=500000, operating_costs=400000, material=150000,
        services=100000, personnel=80000, depreciation=20000,
        operating_profit=100000, value_added=120000,
        interest=5000, fin_result=-5000,
        profit_before_tax=95000, income_tax=19000, net_profit=76000,
    ),
    "expected": {
        "dataQualityStatus": "AVAILABLE",
        "celkove_aktiva": 100000.0,
        "obezny_majetok": 70000.0,
        "vlastne_imanie_celkom": 60000.0,
        "kratkodobe_zavazky": 30000.0,
        "peniaze_a_penazne_ekvivalenty_k_31_12": 45000.0,
        "pohladavky_z_obchodneho_styku": 20000.0,
        "zavazky_z_obchodneho_styku": 15000.0,
        "zasoby": 5000.0,
        "trzby_z_hlavnej_cinnosti": 500000.0,
        "zisk_alebo_strata_po_zdaneni": 76000.0,
    },
})

GOLDEN_FIXTURES.append({
    "name": "687_full_03_loss",
    "category": "687",
    "vykaz": _make_687_vykaz(
        total_assets=30000, non_current=10000, current=20000,
        inventory=2000, trade_recv=8000, cash=10000,
        equity=15000, share_capital=5000,
        total_liab=15000, lt_liab=5000, st_liab=10000, trade_pay=6000,
        revenue=80000, operating_costs=95000, material=40000,
        services=30000, personnel=20000, depreciation=5000,
        operating_profit=-15000, value_added=-10000,
        interest=3000, fin_result=-3000,
        profit_before_tax=-18000, income_tax=0, net_profit=-18000,
    ),
    "expected": {
        "dataQualityStatus": "AVAILABLE",
        "celkove_aktiva": 30000.0,
        "obezny_majetok": 20000.0,
        "vlastne_imanie_celkom": 15000.0,
        "kratkodobe_zavazky": 10000.0,
        "peniaze_a_penazne_ekvivalenty_k_31_12": 10000.0,
        "pohladavky_z_obchodneho_styku": 8000.0,
        "zavazky_z_obchodneho_styku": 6000.0,
        "zasoby": 2000.0,
        "trzby_z_hlavnej_cinnosti": 80000.0,
        "zisk_alebo_strata_po_zdaneni": -18000.0,
    },
})

GOLDEN_FIXTURES.append({
    "name": "687_full_04_minimal",
    "category": "687",
    "vykaz": _make_687_vykaz(
        total_assets=1000, non_current=200, current=800,
        inventory=0, trade_recv=100, cash=700,
        equity=600, share_capital=500,
        total_liab=400, lt_liab=0, st_liab=400, trade_pay=300,
        revenue=5000, operating_costs=4000, material=1000,
        services=500, personnel=2000, depreciation=500,
        operating_profit=1000, value_added=1500,
        interest=100, fin_result=-100,
        profit_before_tax=900, income_tax=180, net_profit=720,
    ),
    "expected": {
        "dataQualityStatus": "AVAILABLE",
        "celkove_aktiva": 1000.0,
        "obezny_majetok": 800.0,
        "vlastne_imanie_celkom": 600.0,
        "kratkodobe_zavazky": 400.0,
        "peniaze_a_penazne_ekvivalenty_k_31_12": 700.0,
        "pohladavky_z_obchodneho_styku": 100.0,
        "zavazky_z_obchodneho_styku": 300.0,
        "zasoby": 0.0,
        "trzby_z_hlavnej_cinnosti": 5000.0,
        "zisk_alebo_strata_po_zdaneni": 720.0,
    },
})

GOLDEN_FIXTURES.append({
    "name": "687_full_05_large",
    "category": "687",
    "vykaz": _make_687_vykaz(
        total_assets=2000000, non_current=800000, current=1200000,
        inventory=200000, trade_recv=400000, cash=600000,
        equity=1200000, share_capital=200000,
        total_liab=800000, lt_liab=300000, st_liab=500000, trade_pay=250000,
        revenue=10000000, operating_costs=8000000, material=3000000,
        services=2000000, personnel=1500000, depreciation=500000,
        operating_profit=2000000, value_added=2500000,
        interest=100000, fin_result=-100000,
        profit_before_tax=1900000, income_tax=380000, net_profit=1520000,
    ),
    "expected": {
        "dataQualityStatus": "AVAILABLE",
        "celkove_aktiva": 2000000.0,
        "obezny_majetok": 1200000.0,
        "vlastne_imanie_celkom": 1200000.0,
        "kratkodobe_zavazky": 500000.0,
        "peniaze_a_penazne_ekvivalenty_k_31_12": 600000.0,
        "pohladavky_z_obchodneho_styku": 400000.0,
        "zavazky_z_obchodneho_styku": 250000.0,
        "zasoby": 200000.0,
        "trzby_z_hlavnej_cinnosti": 10000000.0,
        "zisk_alebo_strata_po_zdaneni": 1520000.0,
    },
})


# ── 5 × template 699 ─────────────────────────────────────────────────────────

GOLDEN_FIXTURES.append({
    "name": "699_full_01",
    "category": "699",
    "vykaz": _make_699_vykaz(
        assets=1000000, non_current=400000, current=600000,
        inventory=100000, trade_recv=200000, cash=350000,
        equity=500000, share_capital=100000,
        lt_liab=250000, st_liab=300000, trade_pay=150000,
        revenue=5000000, operating_costs=3000000,
        material=1000000, services=500000, personnel=800000,
        depreciation=200000, net_profit=200000,
        profit_before_tax=250000, income_tax=50000,
        interest=30000, fin_result=-30000,
        value_added=1500000,
    ),
    "expected": {
        "dataQualityStatus": "AVAILABLE",
        "celkove_aktiva": 1000000.0,
        "obezny_majetok": 600000.0,
        "vlastne_imanie_celkom": 500000.0,
        "kratkodobe_zavazky": 300000.0,
        "dlhodobe_zavazky": 250000.0,
        "peniaze_a_penazne_ekvivalenty_k_31_12": 350000.0,
        "pohladavky_z_obchodneho_styku": 200000.0,
        "zavazky_z_obchodneho_styku": 150000.0,
        "zasoby": 100000.0,
        "trzby_z_hlavnej_cinnosti": 5000000.0,
        "zisk_alebo_strata_po_zdaneni": 200000.0,
        "neobezny_majetok": 400000.0,
        "zakladne_imanie": 100000.0,
    },
})

GOLDEN_FIXTURES.append({
    "name": "699_full_02",
    "category": "699",
    "vykaz": _make_699_vykaz(
        assets=5000000, non_current=2000000, current=3000000,
        inventory=500000, trade_recv=1000000, cash=1500000,
        equity=2500000, share_capital=500000,
        lt_liab=1000000, st_liab=1500000, trade_pay=800000,
        revenue=20000000, operating_costs=12000000,
        material=4000000, services=2000000, personnel=3000000,
        depreciation=800000, net_profit=800000,
        profit_before_tax=1000000, income_tax=200000,
        interest=100000, fin_result=-100000,
        value_added=6000000,
    ),
    "expected": {
        "dataQualityStatus": "AVAILABLE",
        "celkove_aktiva": 5000000.0,
        "obezny_majetok": 3000000.0,
        "vlastne_imanie_celkom": 2500000.0,
        "kratkodobe_zavazky": 1500000.0,
        "dlhodobe_zavazky": 1000000.0,
        "peniaze_a_penazne_ekvivalenty_k_31_12": 1500000.0,
        "pohladavky_z_obchodneho_styku": 1000000.0,
        "zavazky_z_obchodneho_styku": 800000.0,
        "zasoby": 500000.0,
        "trzby_z_hlavnej_cinnosti": 20000000.0,
        "zisk_alebo_strata_po_zdaneni": 800000.0,
        "neobezny_majetok": 2000000.0,
        "zakladne_imanie": 500000.0,
    },
})

GOLDEN_FIXTURES.append({
    "name": "699_full_03_loss",
    "category": "699",
    "vykaz": _make_699_vykaz(
        assets=500000, non_current=200000, current=300000,
        inventory=50000, trade_recv=100000, cash=150000,
        equity=200000, share_capital=100000,
        lt_liab=100000, st_liab=200000, trade_pay=120000,
        revenue=1000000, operating_costs=1200000,
        material=400000, services=300000, personnel=400000,
        depreciation=100000, net_profit=-300000,
        profit_before_tax=-300000, income_tax=0,
        interest=50000, fin_result=-50000,
        value_added=-200000,
    ),
    "expected": {
        "dataQualityStatus": "AVAILABLE",
        "celkove_aktiva": 500000.0,
        "obezny_majetok": 300000.0,
        "vlastne_imanie_celkom": 200000.0,
        "kratkodobe_zavazky": 200000.0,
        "dlhodobe_zavazky": 100000.0,
        "peniaze_a_penazne_ekvivalenty_k_31_12": 150000.0,
        "pohladavky_z_obchodneho_styku": 100000.0,
        "zavazky_z_obchodneho_styku": 120000.0,
        "zasoby": 50000.0,
        "trzby_z_hlavnej_cinnosti": 1000000.0,
        "zisk_alebo_strata_po_zdaneni": -300000.0,
        "neobezny_majetok": 200000.0,
        "zakladne_imanie": 100000.0,
    },
})

GOLDEN_FIXTURES.append({
    "name": "699_full_04_small",
    "category": "699",
    "vykaz": _make_699_vykaz(
        assets=50000, non_current=20000, current=30000,
        inventory=5000, trade_recv=10000, cash=15000,
        equity=25000, share_capital=10000,
        lt_liab=10000, st_liab=15000, trade_pay=8000,
        revenue=200000, operating_costs=150000,
        material=50000, services=30000, personnel=40000,
        depreciation=10000, net_profit=20000,
        profit_before_tax=25000, income_tax=5000,
        interest=2000, fin_result=-2000,
        value_added=60000,
    ),
    "expected": {
        "dataQualityStatus": "AVAILABLE",
        "celkove_aktiva": 50000.0,
        "obezny_majetok": 30000.0,
        "vlastne_imanie_celkom": 25000.0,
        "kratkodobe_zavazky": 15000.0,
        "dlhodobe_zavazky": 10000.0,
        "peniaze_a_penazne_ekvivalenty_k_31_12": 15000.0,
        "pohladavky_z_obchodneho_styku": 10000.0,
        "zavazky_z_obchodneho_styku": 8000.0,
        "zasoby": 5000.0,
        "trzby_z_hlavnej_cinnosti": 200000.0,
        "zisk_alebo_strata_po_zdaneni": 20000.0,
        "neobezny_majetok": 20000.0,
        "zakladne_imanie": 10000.0,
    },
})

GOLDEN_FIXTURES.append({
    "name": "699_full_05_zero_cash",
    "category": "699",
    "vykaz": _make_699_vykaz(
        assets=800000, non_current=500000, current=300000,
        inventory=100000, trade_recv=150000, cash=0,
        equity=400000, share_capital=200000,
        lt_liab=200000, st_liab=200000, trade_pay=100000,
        revenue=3000000, operating_costs=2500000,
        material=1000000, services=500000, personnel=600000,
        depreciation=150000, net_profit=100000,
        profit_before_tax=120000, income_tax=20000,
        interest=15000, fin_result=-15000,
        value_added=800000,
    ),
    "expected": {
        "dataQualityStatus": "AVAILABLE",
        "celkove_aktiva": 800000.0,
        "obezny_majetok": 300000.0,
        "vlastne_imanie_celkom": 400000.0,
        "kratkodobe_zavazky": 200000.0,
        "dlhodobe_zavazky": 200000.0,
        # cash=0 → fallback to r.71 or r.66, both 0 here → stays 0
        "peniaze_a_penazne_ekvivalenty_k_31_12": 0.0,
        "pohladavky_z_obchodneho_styku": 150000.0,
        "zavazky_z_obchodneho_styku": 100000.0,
        "zasoby": 100000.0,
        "trzby_z_hlavnej_cinnosti": 3000000.0,
        "zisk_alebo_strata_po_zdaneni": 100000.0,
        "neobezny_majetok": 500000.0,
        "zakladne_imanie": 200000.0,
    },
})


# ── 3 × SOURCE_GAP ───────────────────────────────────────────────────────────
# RÚZ returns vykaz with metadata but tables have 0 rows.

GOLDEN_FIXTURES.append({
    "name": "source_gap_01_empty_tables",
    "category": "source_gap",
    "vykaz": {
        "id": 1111111,
        "idSablony": 687,
        "obsah": {
            "tabulky": [
                {"nazov": {"sk": "Strana aktív"}, "data": []},
                {"nazov": {"sk": "Strana pasív"}, "data": []},
                {"nazov": {"sk": "Výkaz ziskov a strát"}, "data": []},
            ],
            "titulnaStrana": {
                "obdobieOd": "2021-01-01",
                "obdobieDo": "2021-12-31",
                "pocetZamestnancov": 0,
                "konsolidovana": False,
            },
        },
    },
    "expected": {
        "dataQualityStatus": "SOURCE_GAP",
        "metrics_is_none": True,
    },
})

GOLDEN_FIXTURES.append({
    "name": "source_gap_02_no_tables_key",
    "category": "source_gap",
    "vykaz": {
        "id": 2222222,
        "idSablony": 687,
        "obsah": {
            "titulnaStrana": {
                "obdobieOd": "2022-01-01",
                "obdobieDo": "2022-12-31",
                "pocetZamestnancov": 0,
            },
        },
    },
    "expected": {
        "dataQualityStatus": "SOURCE_GAP",
        "metrics_is_none": True,
    },
})

GOLDEN_FIXTURES.append({
    "name": "source_gap_03_699_empty",
    "category": "source_gap",
    "vykaz": {
        "id": 3333333,
        "idSablony": 699,
        "obsah": {
            "tabulky": [
                {"nazov": {"sk": "Strana aktív"}, "data": []},
                {"nazov": {"sk": "Strana pasív"}, "data": []},
            ],
            "titulnaStrana": {
                "obdobieOd": "2023-01-01",
                "obdobieDo": "2023-12-31",
                "pocetZamestnancov": 5,
            },
        },
    },
    "expected": {
        "dataQualityStatus": "SOURCE_GAP",
        "metrics_is_none": True,
    },
})


# ── 3 × partial-data ─────────────────────────────────────────────────────────

# Partial 01: 687 with totalAssets + equity but NO currentAssets
GOLDEN_FIXTURES.append({
    "name": "partial_01_687_no_current",
    "category": "partial",
    "vykaz": _make_687_vykaz(
        total_assets=50000, non_current=50000, current=0,
        inventory=0, trade_recv=0, cash=0,
        equity=30000, share_capital=5000,
        total_liab=20000, lt_liab=20000, st_liab=0, trade_pay=0,
        revenue=100000, operating_costs=80000, material=30000,
        services=20000, personnel=20000, depreciation=10000,
        operating_profit=20000, value_added=25000,
        interest=1000, fin_result=-1000,
        profit_before_tax=19000, income_tax=3800, net_profit=15200,
    ),
    "expected": {
        "dataQualityStatus": "AVAILABLE",
        "celkove_aktiva": 50000.0,
        "obezny_majetok": 0.0,
        "vlastne_imanie_celkom": 30000.0,
        "kratkodobe_zavazky": 0.0,
        "zisk_alebo_strata_po_zdaneni": 15200.0,
    },
})

# Partial 02: 699 with totalAssets + equity but missing liabilities
GOLDEN_FIXTURES.append({
    "name": "partial_02_699_no_liabilities",
    "category": "partial",
    "vykaz": _make_699_vykaz(
        assets=200000, non_current=100000, current=100000,
        inventory=20000, trade_recv=40000, cash=40000,
        equity=200000, share_capital=50000,
        lt_liab=None, st_liab=None, trade_pay=None,
        revenue=500000, operating_costs=400000,
        material=150000, services=100000, personnel=100000,
        depreciation=20000, net_profit=30000,
        profit_before_tax=40000, income_tax=10000,
        interest=5000, fin_result=-5000,
        value_added=100000,
    ),
    "expected": {
        "dataQualityStatus": "AVAILABLE",
        "celkove_aktiva": 200000.0,
        "obezny_majetok": 100000.0,
        "vlastne_imanie_celkom": 200000.0,
        "dlhodobe_zavazky": None,
        "kratkodobe_zavazky": None,
        "zavazky_z_obchodneho_styku": None,
        "zisk_alebo_strata_po_zdaneni": 30000.0,
    },
})

# Partial 03: 699 with only equity (Pattern A — totalAssets NULL, equity present)
GOLDEN_FIXTURES.append({
    "name": "partial_03_699_pattern_a",
    "category": "partial",
    "vykaz": _make_699_vykaz(
        assets=None, non_current=None, current=None,
        inventory=None, trade_recv=None, cash=None,
        equity=100000, share_capital=50000,
        lt_liab=None, st_liab=None, trade_pay=None,
        revenue=300000, operating_costs=250000,
        material=100000, services=50000, personnel=60000,
        depreciation=10000, net_profit=10000,
        profit_before_tax=15000, income_tax=3000,
        interest=2000, fin_result=-2000,
        value_added=50000,
    ),
    "expected": {
        "dataQualityStatus": "SOURCE_GAP",
        "celkove_aktiva": None,
        "obezny_majetok": None,
        "vlastne_imanie_celkom": 100000.0,
        "trzby_z_hlavnej_cinnosti": 300000.0,
        "zisk_alebo_strata_po_zdaneni": 10000.0,
    },
})


# ── 2 × malformed/unexpected ─────────────────────────────────────────────────

# Malformed 01: Unknown template (not 687, not 699)
GOLDEN_FIXTURES.append({
    "name": "malformed_01_unknown_template",
    "category": "malformed",
    "vykaz": {
        "id": 5555555,
        "idSablony": 1181,
        "obsah": {
            "tabulky": [
                {"nazov": {"sk": "Strana aktív"}, "data": [["100", "0", "100", "50"]]},
                {"nazov": {"sk": "Strana pasív"}, "data": [["", "", "60", "55"]]},
            ],
            "titulnaStrana": {
                "obdobieOd": "2021-01-01",
                "obdobieDo": "2021-12-31",
                "pocetZamestnancov": 1,
            },
        },
    },
    "expected": {
        "dataQualityStatus": "SOURCE_GAP",
        # Unknown template → extended fields skipped, basic fields may parse
        # but row mapping is wrong → likely None for most
        "metrics_may_be_none": True,
    },
})

# Malformed 02: Missing titulnaStrana (no obdobieDo → no year → None)
GOLDEN_FIXTURES.append({
    "name": "malformed_02_no_titulna",
    "category": "malformed",
    "vykaz": {
        "id": 6666666,
        "idSablony": 699,
        "obsah": {
            "tabulky": [
                {"nazov": {"sk": "Strana aktív"}, "data": [["100", "0", "100", "50"]]},
                {"nazov": {"sk": "Strana pasív"}, "data": [["", "", "60", "55"]]},
            ],
        },
    },
    "expected": {
        "dataQualityStatus": "SOURCE_GAP",
        "metrics_is_none": True,
    },
})


# ── Helper: classify dataQualityStatus from parsed metrics ───────────────────

def classify_data_quality(metrics) -> str:
    """Classify dataQualityStatus from parsed FinancialMetrics.

    Thin wrapper (kept for backward-compat naming in the test suite) around
    the real production classifier — src.ruz_parser.compute_data_quality_status.
    This ensures the regression/hardening tests exercise the same code path
    that db_repository.py uses when writing to the DB, instead of a separate
    reimplementation that could silently drift from production behavior.
    """
    return compute_data_quality_status(metrics)


def get_fixtures_by_category(category: str) -> list[dict]:
    """Return all golden fixtures of a given category."""
    return [f for f in GOLDEN_FIXTURES if f["category"] == category]


def get_fixture_by_name(name: str) -> dict:
    """Return a specific golden fixture by name."""
    for f in GOLDEN_FIXTURES:
        if f["name"] == name:
            return f
    raise KeyError(f"Fixture not found: {name}")
