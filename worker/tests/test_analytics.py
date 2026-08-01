"""
Unit testy pre finančné výpočty v analytics.py.

Pokrýva:
- _safe_div, _safe_pct: edge cases (zero, negative, None)
- compute_financial_ratios: likvidita, zadlženosť, rentabilita, EBITDA, DSO/DPO
- compute_altman_z_score: bezpečná/šedá/núdzová zóna, chýbajúce dáta
- compute_piotroski_f_score: 8 kritérií, nedostatok dát
- detect_startup_profile: startup vs non-startup
- compute_white_horse_indicator: schránková firma
- sanitize_cash_flow_fields: 0 → None konverzia
- estimate_missing_cash_flow: nepriamy odhad CF
- get_nace_weights: NACE kód → váhy
- compute_vestnik_degradation: časová degradácia
"""

import pytest
from types import SimpleNamespace
from src.analytics import (
    _safe_div,
    _safe_pct,
    _get,
    sanitize_cash_flow_fields,
    estimate_missing_cash_flow,
    compute_financial_ratios,
    compute_altman_z_score,
    compute_piotroski_f_score,
    detect_startup_profile,
    compute_white_horse_indicator,
    get_nace_weights,
    compute_vestnik_degradation,
)


# ── Helpers ───────────────────────────────────────────────────────────────────

def _stmt(**kwargs):
    """Vytvorí mock financial statement ako SimpleNamespace."""
    defaults = dict(
        year=2024,
        totalAssets=None,
        currentAssets=None,
        equity=None,
        netProfitLoss=None,
        shortTermLiabilities=None,
        longTermLiabilities=None,
        cashAndEquivalents=None,
        mainActivityRevenue=None,
        grossProfit=None,
        inventory=None,
        depreciation=None,
        interestExpense=None,
        tradeReceivables=None,
        tradePayables=None,
        operatingCashFlow=None,
        monthsInPeriod=12,
        staffCosts=None,
        statementType="SK_GAAP",
    )
    defaults.update(kwargs)
    return SimpleNamespace(**defaults)


def _stmt_dict(**kwargs):
    """Vytvorí mock financial statement ako dict."""
    return _stmt(**kwargs).__dict__


# ── _safe_div / _safe_pct ─────────────────────────────────────────────────────

class TestSafeDiv:
    def test_normal(self):
        assert _safe_div(10, 2) == 5.0

    def test_zero_denominator(self):
        assert _safe_div(10, 0) is None

    def test_negative_denominator(self):
        assert _safe_div(10, -2) is None

    def test_zero_numerator(self):
        assert _safe_div(0, 5) == 0.0

    def test_decimals(self):
        assert _safe_div(1, 3, decimals=4) == 0.3333


class TestSafePct:
    def test_normal(self):
        assert _safe_pct(50, 200) == 25.0

    def test_zero_denominator(self):
        assert _safe_pct(50, 0) is None

    def test_negative_numerator(self):
        assert _safe_pct(-50, 200) == -25.0

    def test_zero_numerator(self):
        assert _safe_pct(0, 100) == 0.0


# ── sanitize_cash_flow_fields ─────────────────────────────────────────────────

class TestSanitizeCashFlow:
    def test_zero_to_none_dict(self):
        d = {"operatingCashFlow": 0, "investingCashFlow": 100, "financingCashFlow": 0}
        sanitize_cash_flow_fields(d)
        assert d["operatingCashFlow"] is None
        assert d["investingCashFlow"] == 100
        assert d["financingCashFlow"] is None

    def test_zero_to_none_object(self):
        s = _stmt(operatingCashFlow=0, investingCashFlow=50)
        sanitize_cash_flow_fields(s)
        assert s.operatingCashFlow is None
        assert s.investingCashFlow == 50

    def test_nonzero_preserved(self):
        d = {"operatingCashFlow": 1000, "investingCashFlow": -500}
        sanitize_cash_flow_fields(d)
        assert d["operatingCashFlow"] == 1000
        assert d["investingCashFlow"] == -500

    def test_none_preserved(self):
        d = {"operatingCashFlow": None}
        sanitize_cash_flow_fields(d)
        assert d["operatingCashFlow"] is None


# ── compute_financial_ratios ──────────────────────────────────────────────────

class TestComputeFinancialRatios:
    def test_healthy_company(self):
        s = _stmt(
            totalAssets=1_000_000,
            currentAssets=500_000,
            equity=600_000,
            netProfitLoss=100_000,
            shortTermLiabilities=200_000,
            longTermLiabilities=200_000,
            cashAndEquivalents=100_000,
            mainActivityRevenue=2_000_000,
            grossProfit=800_000,
            inventory=100_000,
            depreciation=50_000,
            interestExpense=10_000,
            tradeReceivables=150_000,
            tradePayables=120_000,
            operatingCashFlow=120_000,
        )
        r = compute_financial_ratios(s)
        assert r["current_ratio"] == 2.5  # 500k / 200k
        assert r["cash_ratio"] == 0.5     # 100k / 200k
        assert r["quick_ratio"] == 2.0    # (500k - 100k) / 200k
        assert r["working_capital"] == 300_000  # 500k - 200k
        assert r["debt_to_equity"] is not None
        assert r["net_profit_margin_pct"] == 5.0  # 100k / 2000k * 100
        assert r["roe_pct"] is not None
        assert r["roa_pct"] == 10.0  # 100k / 1000k * 100
        assert r["ebitda"] == 160_000  # 100k + 10k + 50k
        assert r["negative_equity"] is False

    def test_negative_equity(self):
        s = _stmt(
            totalAssets=500_000,
            currentAssets=200_000,
            equity=-100_000,
            netProfitLoss=-50_000,
            shortTermLiabilities=600_000,
            longTermLiabilities=0,
            mainActivityRevenue=100_000,
        )
        r = compute_financial_ratios(s)
        assert r["negative_equity"] is True
        assert r["roe_pct"] is None  # negative equity → None

    def test_zero_revenue(self):
        s = _stmt(
            totalAssets=500_000,
            equity=300_000,
            shortTermLiabilities=200_000,
            netProfitLoss=0,
            mainActivityRevenue=0,
        )
        r = compute_financial_ratios(s)
        assert r["net_profit_margin_pct"] is None  # zero revenue → None
        # roa_pct = _safe_pct(netProfit, totalAssets) = 0/500k = 0.0 (not None)
        assert r["roa_pct"] == 0.0

    def test_dso_dpo(self):
        s = _stmt(
            totalAssets=1_000_000,
            currentAssets=500_000,
            equity=600_000,
            shortTermLiabilities=200_000,
            mainActivityRevenue=3_650_000,
            tradeReceivables=100_000,
            tradePayables=100_000,
            netProfitLoss=50_000,
        )
        r = compute_financial_ratios(s)
        # DSO = (100k / 3650k) * 365 = 10 days
        assert r["dso_days"] == 10.0
        assert r["dpo_days"] == 10.0

    def test_dso_short_period(self):
        """DSO by mal byť anualizovaný pri skrátenom období."""
        s = _stmt(
            totalAssets=1_000_000,
            currentAssets=500_000,
            equity=600_000,
            shortTermLiabilities=200_000,
            mainActivityRevenue=1_000_000,  # 6-month period
            tradeReceivables=100_000,
            netProfitLoss=50_000,
            monthsInPeriod=6,
        )
        r = compute_financial_ratios(s)
        # annualized_revenue = 1M * (12/6) = 2M
        # DSO = (100k / 2M) * 365 = 18.25 → 18
        assert r["dso_days"] == 18.0

    def test_missing_data_returns_empty(self):
        s = _stmt()
        r = compute_financial_ratios(s)
        # With all None, should not crash, returns dict with Nones
        assert isinstance(r, dict)

    def test_gross_profit_margin(self):
        s = _stmt(
            totalAssets=1_000_000,
            equity=500_000,
            shortTermLiabilities=200_000,
            mainActivityRevenue=1_000_000,
            grossProfit=400_000,
            netProfitLoss=100_000,
        )
        r = compute_financial_ratios(s)
        assert r["gross_profit_margin_pct"] == 40.0

    def test_ebitda_margin(self):
        s = _stmt(
            totalAssets=1_000_000,
            equity=500_000,
            shortTermLiabilities=200_000,
            mainActivityRevenue=1_000_000,
            netProfitLoss=200_000,
            depreciation=100_000,
            interestExpense=50_000,
        )
        r = compute_financial_ratios(s)
        # EBITDA = 200k + 50k + 100k = 350k
        assert r["ebitda"] == 350_000
        assert r["ebitda_margin_pct"] == 35.0


# ── compute_altman_z_score ────────────────────────────────────────────────────

class TestAltmanZScore:
    def test_safe_zone(self):
        s = _stmt(
            totalAssets=1_000_000,
            currentAssets=600_000,
            equity=700_000,
            netProfitLoss=200_000,
            shortTermLiabilities=200_000,
            longTermLiabilities=100_000,
        )
        result = compute_altman_z_score(s)
        assert result["z_score"] is not None
        assert result["zone"] == "SAFE"
        assert result["z_score"] > 2.6

    def test_distress_zone(self):
        s = _stmt(
            totalAssets=1_000_000,
            currentAssets=100_000,
            equity=50_000,
            netProfitLoss=-300_000,
            shortTermLiabilities=900_000,
            longTermLiabilities=50_000,
        )
        result = compute_altman_z_score(s)
        assert result["z_score"] is not None
        assert result["zone"] == "DISTRESS"
        assert result["z_score"] < 1.1

    def test_grey_zone(self):
        s = _stmt(
            totalAssets=1_000_000,
            currentAssets=400_000,
            equity=400_000,
            netProfitLoss=50_000,
            shortTermLiabilities=500_000,
            longTermLiabilities=100_000,
        )
        result = compute_altman_z_score(s)
        assert result["z_score"] is not None
        assert result["zone"] == "GREY"
        assert 1.1 <= result["z_score"] <= 2.6

    def test_missing_data(self):
        s = _stmt(totalAssets=None)
        result = compute_altman_z_score(s)
        assert result["z_score"] is None
        assert result["zone"] == "N/A"

    def test_zero_assets(self):
        s = _stmt(
            totalAssets=0,
            equity=100_000,
            netProfitLoss=50_000,
            shortTermLiabilities=50_000,
        )
        result = compute_altman_z_score(s)
        assert result["z_score"] is None

    def test_components_present(self):
        s = _stmt(
            totalAssets=1_000_000,
            currentAssets=500_000,
            equity=600_000,
            netProfitLoss=100_000,
            shortTermLiabilities=200_000,
            longTermLiabilities=200_000,
        )
        result = compute_altman_z_score(s)
        assert "components" in result
        assert "x1_working_capital_ratio" in result["components"]
        assert "x4_equity_to_debt" in result["components"]

    def test_zero_current_assets_uses_zero_not_fallback(self):
        """currentAssets=0 is a legitimate value, not missing data.
        Working capital should be -short_liabilities, not total_assets*0.6 - short_liabilities."""
        s = _stmt(
            totalAssets=1_000_000,
            currentAssets=0,  # legitimately zero
            equity=600_000,
            netProfitLoss=100_000,
            shortTermLiabilities=200_000,
            longTermLiabilities=200_000,
        )
        result = compute_altman_z_score(s)
        assert result["z_score"] is not None
        # x1 = working_capital / total_assets = (0 - 200k) / 1M = -0.2
        assert result["components"]["x1_working_capital_ratio"] == -0.2

    def test_missing_current_assets_uses_fallback(self):
        """currentAssets=None is missing data — should use fallback (total_assets * 0.6)."""
        s = _stmt(
            totalAssets=1_000_000,
            currentAssets=None,  # missing
            equity=600_000,
            netProfitLoss=100_000,
            shortTermLiabilities=200_000,
            longTermLiabilities=200_000,
        )
        result = compute_altman_z_score(s)
        assert result["z_score"] is not None
        # x1 = (1M*0.6 - 200k) / 1M = 400k / 1M = 0.4
        assert result["components"]["x1_working_capital_ratio"] == 0.4


# ── compute_piotroski_f_score ─────────────────────────────────────────────────

class TestPiotroskiFScore:
    def test_high_score(self):
        """Firma so zlepšujúcou sa ziskovosťou, likviditou a maržou."""
        prev = _stmt(year=2023, netProfitLoss=50_000, totalAssets=800_000,
                     longTermLiabilities=300_000, currentAssets=300_000,
                     shortTermLiabilities=200_000, grossProfit=200_000,
                     mainActivityRevenue=1_000_000, operatingCashFlow=80_000)
        curr = _stmt(year=2024, netProfitLoss=150_000, totalAssets=1_000_000,
                     longTermLiabilities=250_000, currentAssets=400_000,
                     shortTermLiabilities=150_000, grossProfit=300_000,
                     mainActivityRevenue=1_200_000, operatingCashFlow=200_000)
        result = compute_piotroski_f_score([prev, curr])
        assert result["score"] is not None
        assert result["score"] >= 6  # should be high

    def test_low_score(self):
        """Firma so zhoršujúcou sa situáciou."""
        prev = _stmt(year=2023, netProfitLoss=100_000, totalAssets=1_000_000,
                     longTermLiabilities=200_000, currentAssets=500_000,
                     shortTermLiabilities=200_000, grossProfit=400_000,
                     mainActivityRevenue=1_000_000, operatingCashFlow=150_000)
        curr = _stmt(year=2024, netProfitLoss=-50_000, totalAssets=900_000,
                     longTermLiabilities=300_000, currentAssets=200_000,
                     shortTermLiabilities=400_000, grossProfit=100_000,
                     mainActivityRevenue=800_000, operatingCashFlow=-30_000)
        result = compute_piotroski_f_score([prev, curr])
        assert result["score"] is not None
        assert result["score"] <= 3  # should be low

    def test_insufficient_data(self):
        result = compute_piotroski_f_score([_stmt(year=2024)])
        assert result["score"] is None

    def test_empty_list(self):
        result = compute_piotroski_f_score([])
        assert result["score"] is None

    def test_max_score_is_8(self):
        result = compute_piotroski_f_score([_stmt(), _stmt()])
        if result["score"] is not None:
            assert result["score"] <= 8


# ── compute_beneish_m_score ───────────────────────────────────────────────────

from src.analytics import compute_beneish_m_score


class TestBeneishMScore:
    def test_insufficient_data(self):
        """Less than 2 years → None."""
        result = compute_beneish_m_score([_stmt(year=2024)])
        assert result["m_score"] is None

    def test_empty_list(self):
        result = compute_beneish_m_score([])
        assert result["m_score"] is None

    def test_zero_revenue(self):
        """Zero revenue → None (can't compute)."""
        prev = _stmt(year=2023, mainActivityRevenue=0, totalAssets=500_000)
        curr = _stmt(year=2024, mainActivityRevenue=0, totalAssets=500_000)
        result = compute_beneish_m_score([prev, curr])
        assert result["m_score"] is None

    def test_missing_cf_uses_neutral_tata(self):
        """When operatingCashFlow is missing, TATA should be neutral (0),
        not (net_profit - 0) / assets which would falsely flag profitable companies."""
        prev = _stmt(year=2023, mainActivityRevenue=1_000_000, totalAssets=500_000,
                     currentAssets=200_000, tradeReceivables=50_000, grossProfit=400_000,
                     depreciation=20_000, shortTermLiabilities=100_000, longTermLiabilities=100_000,
                     operatingCashFlow=100_000)
        curr = _stmt(year=2024, mainActivityRevenue=1_200_000, totalAssets=600_000,
                     currentAssets=250_000, tradeReceivables=60_000, grossProfit=500_000,
                     netProfitLoss=200_000, depreciation=30_000,
                     shortTermLiabilities=120_000, longTermLiabilities=100_000,
                     operatingCashFlow=None)  # Missing CF
        result = compute_beneish_m_score([prev, curr])
        assert result["m_score"] is not None
        # TATA should be 0 (neutral), not (200k - 0) / 600k = 0.333
        assert result["components"]["tata"] == 0.0
        # Should NOT be flagged as manipulator just because CF is missing
        # With neutral TATA, M-score should be well below -1.78 for a healthy company
        # (dsri≈1.2, gmi≈0.8, aqi≈1.0, sgi≈1.2, depi=1.0, sgai=1.0, tata=0, lvgi≈1.0)
        # M ≈ -4.84 + 0.92*1.2 + 0.528*0.8 + 0.404*1.0 + 0.892*1.2 + 0.115*1.0 - 0.172*1.0 + 4.679*0 - 0.327*1.0
        # M ≈ -4.84 + 1.104 + 0.422 + 0.404 + 1.070 + 0.115 - 0.172 + 0 - 0.327 ≈ -2.224
        assert result["is_manipulator"] is False
        # Should include a flag warning that TATA was neutralized
        assert any("TATA neutralizované" in f for f in result["flags"])

    def test_with_cf_computes_real_tata(self):
        """When operatingCashFlow is present, TATA should be computed normally."""
        prev = _stmt(year=2023, mainActivityRevenue=1_000_000, totalAssets=500_000,
                     currentAssets=200_000, tradeReceivables=50_000, grossProfit=400_000,
                     depreciation=20_000, shortTermLiabilities=100_000, longTermLiabilities=100_000,
                     operatingCashFlow=100_000)
        curr = _stmt(year=2024, mainActivityRevenue=1_200_000, totalAssets=600_000,
                     currentAssets=250_000, tradeReceivables=60_000, grossProfit=500_000,
                     netProfitLoss=200_000, depreciation=30_000,
                     shortTermLiabilities=120_000, longTermLiabilities=100_000,
                     operatingCashFlow=50_000)  # Low CF → high accruals
        result = compute_beneish_m_score([prev, curr])
        assert result["m_score"] is not None
        # TATA = (200k - 50k) / 600k = 150k / 600k ≈ 0.25
        assert result["components"]["tata"] == round(150_000 / 600_000, 4)


# ── detect_startup_profile ────────────────────────────────────────────────────

class TestStartupDetection:
    def test_startup_detected(self):
        stmts = [_stmt(year=2024, totalAssets=1_000_000, equity=600_000, mainActivityRevenue=50_000)]
        result = detect_startup_profile(stmts)
        assert result["is_startup"] is True

    def test_not_startup_high_revenue(self):
        stmts = [_stmt(year=2024, totalAssets=1_000_000, equity=600_000, mainActivityRevenue=500_000)]
        result = detect_startup_profile(stmts)
        assert result["is_startup"] is False

    def test_not_startup_low_equity(self):
        stmts = [_stmt(year=2024, totalAssets=1_000_000, equity=100_000, mainActivityRevenue=50_000)]
        result = detect_startup_profile(stmts)
        assert result["is_startup"] is False

    def test_not_startup_too_many_years(self):
        stmts = [_stmt(year=y, totalAssets=1_000_000, equity=600_000, mainActivityRevenue=50_000)
                 for y in [2021, 2022, 2023, 2024]]
        result = detect_startup_profile(stmts)
        assert result["is_startup"] is False

    def test_empty_list(self):
        result = detect_startup_profile([])
        assert result["is_startup"] is False

    def test_zero_assets(self):
        stmts = [_stmt(year=2024, totalAssets=0, equity=600_000, mainActivityRevenue=50_000)]
        result = detect_startup_profile(stmts)
        assert result["is_startup"] is False


# ── compute_white_horse_indicator ─────────────────────────────────────────────

class TestWhiteHorse:
    def test_shell_company_detected(self):
        """Vysoké tržby, 0 mzdových nákladov za 3 roky → schránková firma."""
        stmts = [
            _stmt(year=2022, mainActivityRevenue=500_000, staffCosts=0, totalAssets=200_000),
            _stmt(year=2023, mainActivityRevenue=600_000, staffCosts=0, totalAssets=200_000),
            _stmt(year=2024, mainActivityRevenue=700_000, staffCosts=0, totalAssets=200_000),
        ]
        result = compute_white_horse_indicator(stmts)
        assert result["penalty"] >= 15
        assert any("NULOVÉ" in f for f in result["flags"])

    def test_normal_company_no_penalty(self):
        stmts = [
            _stmt(year=2022, mainActivityRevenue=500_000, staffCosts=200_000, totalAssets=200_000),
            _stmt(year=2023, mainActivityRevenue=600_000, staffCosts=220_000, totalAssets=200_000),
            _stmt(year=2024, mainActivityRevenue=700_000, staffCosts=250_000, totalAssets=200_000),
        ]
        result = compute_white_horse_indicator(stmts)
        assert result["penalty"] == 0

    def test_receivables_dominance(self):
        """Pohľadávky > 90% aktív → riziko."""
        stmts = [_stmt(year=2024, mainActivityRevenue=200_000, staffCosts=50_000,
                       totalAssets=100_000, tradeReceivables=95_000)]
        result = compute_white_horse_indicator(stmts)
        assert result["penalty"] >= 10
        assert any("Pohľadávky" in f for f in result["flags"])

    def test_ifrs_skipped(self):
        """IFRS firmy sa preskakujú pri kontrole mzdových nákladov."""
        stmts = [
            _stmt(year=2022, mainActivityRevenue=500_000, staffCosts=0, totalAssets=200_000, statementType="IFRS"),
            _stmt(year=2023, mainActivityRevenue=600_000, staffCosts=0, totalAssets=200_000, statementType="IFRS"),
            _stmt(year=2024, mainActivityRevenue=700_000, staffCosts=0, totalAssets=200_000, statementType="IFRS"),
        ]
        result = compute_white_horse_indicator(stmts)
        assert result["penalty"] == 0

    def test_empty_list(self):
        result = compute_white_horse_indicator([])
        assert result["penalty"] == 0


# ── estimate_missing_cash_flow ────────────────────────────────────────────────

class TestEstimateCashFlow:
    def test_estimate_from_balance_sheet_changes(self):
        prev = _stmt(year=2023, inventory=100_000, tradeReceivables=50_000,
                     tradePayables=30_000, operatingCashFlow=None)
        curr = _stmt(year=2024, netProfitLoss=200_000, depreciation=50_000,
                     inventory=120_000, tradeReceivables=60_000,
                     tradePayables=40_000, operatingCashFlow=None)
        estimated = estimate_missing_cash_flow([prev, curr])
        assert estimated is True
        # CF = netProfit + depreciation - Δinv - Δrecv + Δpay
        # = 200k + 50k - (120k-100k) - (60k-50k) + (40k-30k)
        # = 200k + 50k - 20k - 10k + 10k = 230k
        assert curr.operatingCashFlow == 230_000

    def test_no_estimate_when_cf_present(self):
        s = _stmt(year=2024, operatingCashFlow=100_000)
        result = estimate_missing_cash_flow([s])
        assert result is False

    def test_no_estimate_without_prev_year(self):
        s = _stmt(year=2024, netProfitLoss=100_000, depreciation=20_000, operatingCashFlow=None)
        result = estimate_missing_cash_flow([s])
        assert result is False

    def test_empty_list(self):
        assert estimate_missing_cash_flow([]) is False


# ── get_nace_weights ──────────────────────────────────────────────────────────

class TestNaceWeights:
    def test_manufacturing(self):
        w = get_nace_weights("20")
        assert w["P1"] == 20
        assert sum(w.values()) == 100

    def test_construction(self):
        w = get_nace_weights("41")
        assert w["P1"] == 25
        assert sum(w.values()) == 100

    def test_it_services(self):
        w = get_nace_weights("62")
        assert w["P3"] == 30

    def test_default(self):
        w = get_nace_weights("99")
        assert w["P1"] == 30
        assert sum(w.values()) == 100

    def test_empty_code(self):
        w = get_nace_weights("")
        assert sum(w.values()) == 100


# ── compute_vestnik_degradation ───────────────────────────────────────────────

class TestVestnikDegradation:
    def test_recent_event(self):
        from datetime import datetime, timezone, timedelta
        event = SimpleNamespace(publishedAt=datetime.now(timezone.utc) - timedelta(days=100))
        assert compute_vestnik_degradation(event) == 1.0

    def test_one_year_old(self):
        from datetime import datetime, timezone, timedelta
        event = SimpleNamespace(publishedAt=datetime.now(timezone.utc) - timedelta(days=400))
        assert compute_vestnik_degradation(event) == 0.7

    def test_three_years_old(self):
        from datetime import datetime, timezone, timedelta
        event = SimpleNamespace(publishedAt=datetime.now(timezone.utc) - timedelta(days=1100))
        assert compute_vestnik_degradation(event) == 0.4

    def test_five_years_old(self):
        from datetime import datetime, timezone, timedelta
        event = SimpleNamespace(publishedAt=datetime.now(timezone.utc) - timedelta(days=2000))
        assert compute_vestnik_degradation(event) == 0.1

    def test_no_date(self):
        event = SimpleNamespace(publishedAt=None)
        assert compute_vestnik_degradation(event) == 1.0
