"""Generate all report charts as PNG files for visual review."""
import base64
from pathlib import Path
from types import SimpleNamespace

OUT = Path("/Users/dusanbaran/Desktop/Projects/scripta/worker/test_results/chart_preview")
OUT.mkdir(parents=True, exist_ok=True)


def save(b64: str, name: str):
    if not b64:
        print(f"  SKIP {name} (empty)")
        return
    (OUT / f"{name}.png").write_bytes(base64.b64decode(b64))
    print(f"  OK   {name}.png")


def make_stmt(year, **overrides):
    base = dict(
        mainActivityRevenue=1_850_000.0,
        grossProfit=720_000.0,
        netProfitLoss=165_000.0,
        staffCosts=280_000.0,
        depreciation=45_000.0,
        interestExpense=12_000.0,
        operatingCashFlow=190_000.0,
        investingCashFlow=-80_000.0,
        financingCashFlow=-40_000.0,
        currentAssets=520_000.0,
        inventory=130_000.0,
        cashAndEquivalents=95_000.0,
        tradeReceivables=210_000.0,
        totalAssets=1_240_000.0,
        equity=640_000.0,
        shortTermLiabilities=310_000.0,
        longTermLiabilities=180_000.0,
        tradePayables=120_000.0,
        year=float(year),
        employeeCount=42,
        monthsInPeriod=12,
        statementType="IFRS",
        isConsolidated=False,
        auditorOpinion=None,
        narrativeRisk=None,
        notesRisk=None,
        _gross_profit_estimated=False,
    )
    base.update(overrides)
    return SimpleNamespace(**base)


# 5 years of trending data
statements = [
    make_stmt(2020, mainActivityRevenue=1_200_000, grossProfit=480_000, netProfitLoss=80_000,
              operatingCashFlow=110_000, currentAssets=380_000, totalAssets=950_000,
              equity=450_000, shortTermLiabilities=280_000, longTermLiabilities=150_000,
              inventory=90_000, cashAndEquivalents=60_000, tradeReceivables=140_000),
    make_stmt(2021, mainActivityRevenue=1_400_000, grossProfit=560_000, netProfitLoss=110_000,
              operatingCashFlow=140_000, currentAssets=420_000, totalAssets=1_050_000,
              equity=510_000, shortTermLiabilities=290_000, longTermLiabilities=160_000,
              inventory=105_000, cashAndEquivalents=70_000, tradeReceivables=165_000),
    make_stmt(2022, mainActivityRevenue=1_550_000, grossProfit=610_000, netProfitLoss=95_000,
              operatingCashFlow=130_000, currentAssets=460_000, totalAssets=1_120_000,
              equity=550_000, shortTermLiabilities=300_000, longTermLiabilities=170_000,
              inventory=115_000, cashAndEquivalents=75_000, tradeReceivables=180_000),
    make_stmt(2023, mainActivityRevenue=1_700_000, grossProfit=670_000, netProfitLoss=140_000,
              operatingCashFlow=165_000, currentAssets=490_000, totalAssets=1_180_000,
              equity=600_000, shortTermLiabilities=305_000, longTermLiabilities=175_000,
              inventory=125_000, cashAndEquivalents=85_000, tradeReceivables=195_000),
    make_stmt(2024),
]

latest = statements[-1]

print("=== infographics.py (Sankey) ===")
from src.infographics import (
    generate_pl_infographic,
    generate_cashflow_waterfall,
    generate_balance_sheet_infographic,
)
save(generate_pl_infographic(latest, lang="sk"), "sankey_pl")
save(generate_cashflow_waterfall(latest, lang="sk"), "sankey_cashflow")
save(generate_balance_sheet_infographic(latest, lang="sk"), "sankey_balance_sheet")

print("=== plotly_charts.py ===")
from src.plotly_charts import (
    generate_financial_chart,
    generate_balance_sheet_chart,
    generate_pnl_chart,
    generate_cashflow_chart,
    generate_liquidity_chart,
    generate_altman_chart,
    generate_ratios_trend_chart,
    generate_radar_chart,
    generate_debt_donut,
)
save(generate_financial_chart(statements, lang="sk"), "line_revenue_profit")
save(generate_balance_sheet_chart(statements, lang="sk"), "line_balance_structure")
save(generate_pnl_chart(statements, lang="sk"), "bar_pnl")
save(generate_cashflow_chart(statements, lang="sk"), "bar_cashflow")
save(generate_liquidity_chart(statements, lang="sk"), "liquidity")

altman = [
    {"year": 2020, "z_score": 2.1},
    {"year": 2021, "z_score": 2.4},
    {"year": 2022, "z_score": 1.9},
    {"year": 2023, "z_score": 2.7},
    {"year": 2024, "z_score": 3.1},
]
save(generate_altman_chart(altman, lang="sk"), "altman_zscore")

ratios = [
    {"year": 2020, "roa_pct": 8.4, "roe_pct": 17.8, "net_profit_margin_pct": 6.7},
    {"year": 2021, "roa_pct": 10.5, "roe_pct": 21.6, "net_profit_margin_pct": 7.9},
    {"year": 2022, "roa_pct": 8.5, "roe_pct": 17.3, "net_profit_margin_pct": 6.1},
    {"year": 2023, "roa_pct": 11.9, "roe_pct": 23.3, "net_profit_margin_pct": 8.2},
    {"year": 2024, "roa_pct": 13.3, "roe_pct": 25.8, "net_profit_margin_pct": 8.9},
]
save(generate_ratios_trend_chart(ratios, lang="sk"), "ratios_trend")

pillars = [
    {"name": "Platobná schopnosť & Exekúcie", "score": 18, "max_score": 20},
    {"name": "Finančné zdravie", "score": 14, "max_score": 20},
    {"name": "Ziskovosť, Stabilita a Cash Flow", "score": 12, "max_score": 20},
    {"name": "Rast & Trendová sila", "score": 15, "max_score": 20},
    {"name": "Právna bezúhonnosť", "score": 19, "max_score": 20},
    {"name": "Forenzný indikátor: Biely Kôň", "score": -3, "max_score": 0},
]
save(generate_radar_chart(pillars, lang="sk"), "radar_pillars")
save(generate_debt_donut(latest, lang="sk"), "donut_debt")

print(f"\nDone. Files in {OUT}")
