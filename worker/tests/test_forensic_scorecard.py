"""
Unit testy pre compute_forensic_scorecard — 5-pilierový scoring model.

Pokrýva:
- HARD STOP: konkurz / likvidácia / reštrukturalizácia → score 0, risk C
- PILIER 1: Platobná schopnosť (current ratio, equity, vestník events)
- PILIER 2: Finančné zdravie (Altman Z'', Piotroski, startup, data void)
- PILIER 3: Ziskovosť & CF (profitable years, margins, CF/Rev, consecutive losses)
- PILIER 4: Rast & trendy (CAGR, equity trend, revenue decline)
- PILIER 5: Právna bezúhonnosť (vestník severity, auditor opinion)
- DQ multiplier (počet výkazov, audit, startup)
- White horse penalty
- ORSR forensic penalty (statutory changes, virtual seat, foreign statutory)
- _risk_category: AAA / A / B / C
- compute_financial_trends: CAGR, consecutive losses, YoY
- compute_state_liabilities_alert: SP/tax/employee liabilities + registry cross-ref
- compute_revenue_per_employee_alert: reported vs estimated, extreme ratios
- compute_yoy_summary_table: headers, rows, flags
"""

import pytest
from types import SimpleNamespace
from datetime import datetime, timezone, timedelta
from src.analytics import (
    compute_forensic_scorecard,
    compute_financial_trends,
    compute_state_liabilities_alert,
    compute_revenue_per_employee_alert,
    compute_yoy_summary_table,
    _risk_category,
    ScorecardResult,
    ScorecardPillar,
)


# ── Helpers ───────────────────────────────────────────────────────────────────

def _stmt(**kwargs):
    defaults = dict(
        year=2024,
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
        monthsInPeriod=12,
        staffCosts=200_000,
        statementType="SK_GAAP",
        employeeCount=10,
        auditorOpinion=None,
    )
    defaults.update(kwargs)
    return SimpleNamespace(**defaults)


def _healthy_company_dict(stmts=None, nace="62"):
    """Standard healthy company for scorecard tests."""
    if stmts is None:
        stmts = [_stmt(year=2023), _stmt(year=2024)]
    return {
        "financialStatements": stmts,
        "vestnikEvents": [],
        "companyEvents": [],
        "naceCode": nace,
    }


def _healthy_trends(stmts=None):
    """Trends dict matching healthy company."""
    if stmts is None:
        stmts = [_stmt(year=2023), _stmt(year=2024)]
    return compute_financial_trends(stmts)


def _vestnik_event(event_type="Zmena v predmete činnosti", severity="LOW", days_ago=100):
    return {
        "eventType": event_type,
        "severityLevel": severity,
        "publishedAt": datetime.now(timezone.utc) - timedelta(days=days_ago),
    }


# ── _risk_category ────────────────────────────────────────────────────────────

class TestRiskCategory:
    def test_aaa(self):
        assert _risk_category(95) == "AAA"

    def test_aaa_boundary(self):
        assert _risk_category(90) == "AAA"

    def test_a(self):
        assert _risk_category(75) == "A"

    def test_a_boundary(self):
        assert _risk_category(70) == "A"

    def test_b(self):
        assert _risk_category(50) == "B"

    def test_b_boundary(self):
        assert _risk_category(40) == "B"

    def test_c(self):
        assert _risk_category(30) == "C"

    def test_c_zero(self):
        assert _risk_category(0) == "C"


# ── HARD STOP: Konkurz / Likvidácia ───────────────────────────────────────────

class TestHardStop:
    def test_konkurz_hard_stop(self):
        company = _healthy_company_dict()
        company["vestnikEvents"] = [_vestnik_event(event_type="Konkurz", severity="CRITICAL")]
        trends = _healthy_trends()
        result = compute_forensic_scorecard(company, trends)
        assert result.hard_stop is True
        assert result.total_score == 0
        assert result.risk_category == "C"
        assert len(result.pillars) == 1
        assert "HARD STOP" in result.pillars[0].detail

    def test_likvidacia_hard_stop(self):
        company = _healthy_company_dict()
        company["vestnikEvents"] = [_vestnik_event(event_type="Zápis o likvidácii", severity="CRITICAL")]
        result = compute_forensic_scorecard(company, _healthy_trends())
        assert result.hard_stop is True
        assert result.total_score == 0

    def test_restrukturalizacia_hard_stop(self):
        company = _healthy_company_dict()
        company["vestnikEvents"] = [_vestnik_event(event_type="Reštrukturalizácia", severity="CRITICAL")]
        result = compute_forensic_scorecard(company, _healthy_trends())
        assert result.hard_stop is True

    def test_non_critical_event_no_hard_stop(self):
        company = _healthy_company_dict()
        company["vestnikEvents"] = [_vestnik_event(event_type="Zmena sídla", severity="LOW")]
        result = compute_forensic_scorecard(company, _healthy_trends())
        assert result.hard_stop is False
        assert result.total_score > 0


# ── PILIER 1: Platobná schopnosť ──────────────────────────────────────────────

class TestPillar1:
    def test_healthy_company_pillar1(self):
        company = _healthy_company_dict()
        trends = _healthy_trends()
        result = compute_forensic_scorecard(company, trends)
        p1 = [p for p in result.pillars if "Platobná" in p.name]
        assert len(p1) == 1
        assert p1[0].score > 0

    def test_no_data_pillar1(self):
        """Keď nie sú žiadne ratios, P1 dostáva N/A body."""
        stmts = [_stmt(year=2024, totalAssets=None, equity=None, netProfitLoss=None,
                       shortTermLiabilities=None, mainActivityRevenue=None)]
        company = _healthy_company_dict(stmts=stmts)
        trends = {"ratios_by_year": [{}], "altman_z_scores": [{}], "consecutive_losses": 0}
        result = compute_forensic_scorecard(company, trends)
        p1 = [p for p in result.pillars if "Platobná" in p.name][0]
        # N/A current ratio → 6, N/A equity → 6, no vestník → 6 = 18 raw
        assert p1.score > 0

    def test_critical_vestnik_events_reduce_p1(self):
        company = _healthy_company_dict()
        company["vestnikEvents"] = [_vestnik_event(event_type="Exekúcia", severity="CRITICAL", days_ago=10)]
        trends = _healthy_trends()
        result = compute_forensic_scorecard(company, trends)
        p1 = [p for p in result.pillars if "Platobná" in p.name][0]
        # Critical event → no +6 for clean vestník
        assert any("kritické" in f.lower() or "penalizácia" in f.lower() for f in p1.flags)


# ── PILIER 2: Finančné zdravie ────────────────────────────────────────────────

class TestPillar2:
    def test_healthy_company_pillar2(self):
        company = _healthy_company_dict()
        trends = _healthy_trends()
        result = compute_forensic_scorecard(company, trends)
        p2 = [p for p in result.pillars if "Finančné zdravie" in p.name]
        assert len(p2) == 1
        assert p2[0].score > 0

    def test_startup_profile_pillar2(self):
        """Startup dostáva 15 raw bodov v P2."""
        stmts = [_stmt(year=2024, totalAssets=1_000_000, equity=600_000, mainActivityRevenue=50_000)]
        company = _healthy_company_dict(stmts=stmts)
        trends = _healthy_trends(stmts)
        result = compute_forensic_scorecard(company, trends)
        p2 = [p for p in result.pillars if "Finančné zdravie" in p.name][0]
        assert any("STARTUP" in f for f in p2.flags)

    def test_data_void_pillar2(self):
        """Data void → P2 = 0."""
        stmts = [_stmt(year=2024, totalAssets=None, equity=None, netProfitLoss=None,
                       shortTermLiabilities=None, mainActivityRevenue=None)]
        company = _healthy_company_dict(stmts=stmts)
        trends = {"ratios_by_year": [{}], "altman_z_scores": [{}], "consecutive_losses": 0}
        result = compute_forensic_scorecard(company, trends)
        p2 = [p for p in result.pillars if "Finančné zdravie" in p.name][0]
        assert p2.score == 0
        assert any("DATA VOID" in f for f in p2.flags)


# ── PILIER 3: Ziskovosť & CF ──────────────────────────────────────────────────

class TestPillar3:
    def test_profitable_company_pillar3(self):
        company = _healthy_company_dict()
        trends = _healthy_trends()
        result = compute_forensic_scorecard(company, trends)
        p3 = [p for p in result.pillars if "Ziskovosť" in p.name]
        assert len(p3) == 1
        assert p3[0].score > 0

    def test_consecutive_losses_penalty(self):
        stmts = [
            _stmt(year=2021, netProfitLoss=100_000),
            _stmt(year=2022, netProfitLoss=-50_000),
            _stmt(year=2023, netProfitLoss=-80_000),
            _stmt(year=2024, netProfitLoss=-120_000),
        ]
        company = _healthy_company_dict(stmts=stmts)
        trends = compute_financial_trends(stmts)
        result = compute_forensic_scorecard(company, trends)
        p3 = [p for p in result.pillars if "Ziskovosť" in p.name][0]
        assert any("strata" in f.lower() or "penaliz" in f.lower() for f in p3.flags)

    def test_no_statements_pillar3(self):
        company = _healthy_company_dict(stmts=[])
        trends = {"ratios_by_year": [{}], "altman_z_scores": [{}], "consecutive_losses": 0}
        result = compute_forensic_scorecard(company, trends)
        p3 = [p for p in result.pillars if "Ziskovosť" in p.name][0]
        # No stmts → data_availability_pct = 0.0 < 0.3 → data_void = True → score 0
        assert p3.score == 0
        assert any("DATA VOID" in f for f in p3.flags)

    def test_strong_cash_flow(self):
        """CF/Rev > 10% → +8 bonus."""
        stmts = [_stmt(year=2023), _stmt(year=2024, operatingCashFlow=500_000, mainActivityRevenue=2_000_000)]
        company = _healthy_company_dict(stmts=stmts)
        trends = compute_financial_trends(stmts)
        result = compute_forensic_scorecard(company, trends)
        p3 = [p for p in result.pillars if "Ziskovosť" in p.name][0]
        assert any("Silný" in f for f in p3.flags)

    def test_negative_cash_flow(self):
        stmts = [_stmt(year=2023), _stmt(year=2024, operatingCashFlow=-100_000)]
        company = _healthy_company_dict(stmts=stmts)
        trends = compute_financial_trends(stmts)
        result = compute_forensic_scorecard(company, trends)
        p3 = [p for p in result.pillars if "Ziskovosť" in p.name][0]
        assert any("Záporný" in f for f in p3.flags)


# ── PILIER 4: Rast & trendy ───────────────────────────────────────────────────

class TestPillar4:
    def test_healthy_growth_pillar4(self):
        stmts = [
            _stmt(year=2020, mainActivityRevenue=1_000_000),
            _stmt(year=2021, mainActivityRevenue=1_200_000),
            _stmt(year=2022, mainActivityRevenue=1_500_000),
            _stmt(year=2023, mainActivityRevenue=1_800_000),
            _stmt(year=2024, mainActivityRevenue=2_200_000),
        ]
        company = _healthy_company_dict(stmts=stmts)
        trends = compute_financial_trends(stmts)
        result = compute_forensic_scorecard(company, trends)
        p4 = [p for p in result.pillars if "Rast" in p.name]
        assert len(p4) == 1
        assert p4[0].score > 0

    def test_declining_revenue_penalty(self):
        stmts = [
            _stmt(year=2022, mainActivityRevenue=3_000_000),
            _stmt(year=2023, mainActivityRevenue=2_500_000),
            _stmt(year=2024, mainActivityRevenue=2_000_000),
        ]
        company = _healthy_company_dict(stmts=stmts)
        trends = compute_financial_trends(stmts)
        result = compute_forensic_scorecard(company, trends)
        p4 = [p for p in result.pillars if "Rast" in p.name][0]
        assert any("klesajú" in f.lower() or "pokles" in f.lower() for f in p4.flags)

    def test_no_cagr_data(self):
        stmts = [_stmt(year=2024)]
        company = _healthy_company_dict(stmts=stmts)
        trends = compute_financial_trends(stmts)
        result = compute_forensic_scorecard(company, trends)
        p4 = [p for p in result.pillars if "Rast" in p.name][0]
        assert any("N/A" in f for f in p4.flags)


# ── PILIER 5: Právna bezúhonnosť ──────────────────────────────────────────────

class TestPillar5:
    def test_clean_company_pillar5(self):
        company = _healthy_company_dict()
        trends = _healthy_trends()
        result = compute_forensic_scorecard(company, trends)
        p5 = [p for p in result.pillars if "Právna" in p.name]
        assert len(p5) == 1
        assert p5[0].score > 0
        assert any("Bez záznamu" in f for f in p5[0].flags)

    def test_critical_vestnik_zero_p5(self):
        company = _healthy_company_dict()
        company["vestnikEvents"] = [_vestnik_event(event_type="Trestné stíhanie", severity="CRITICAL", days_ago=10)]
        trends = _healthy_trends()
        result = compute_forensic_scorecard(company, trends)
        p5 = [p for p in result.pillars if "Právna" in p.name][0]
        assert p5.score == 0

    def test_medium_vestnik_reduces_p5(self):
        company = _healthy_company_dict()
        company["vestnikEvents"] = [_vestnik_event(event_type="Pokuta", severity="MEDIUM", days_ago=100)]
        trends = _healthy_trends()
        result = compute_forensic_scorecard(company, trends)
        p5 = [p for p in result.pillars if "Právna" in p.name][0]
        assert p5.score < 10  # not full marks

    def test_low_vestnik_minor_penalty(self):
        company = _healthy_company_dict()
        company["vestnikEvents"] = [_vestnik_event(event_type="Zmena sídla", severity="LOW")]
        trends = _healthy_trends()
        result = compute_forensic_scorecard(company, trends)
        p5 = [p for p in result.pillars if "Právna" in p.name][0]
        assert any("nízko" in f.lower() for f in p5.flags)

    def test_auditor_unqualified_bonus(self):
        stmts = [_stmt(year=2024, auditorOpinion=SimpleNamespace(opinionType="Bez výhrad"))]
        company = _healthy_company_dict(stmts=stmts)
        trends = _healthy_trends(stmts)
        result = compute_forensic_scorecard(company, trends)
        p5 = [p for p in result.pillars if "Právna" in p.name][0]
        assert any("bez výhrad" in f.lower() for f in p5.flags)

    def test_auditor_qualified_penalty(self):
        stmts = [_stmt(year=2024, auditorOpinion=SimpleNamespace(opinionType="S výhradou"))]
        company = _healthy_company_dict(stmts=stmts)
        trends = _healthy_trends(stmts)
        result = compute_forensic_scorecard(company, trends)
        p5 = [p for p in result.pillars if "Právna" in p.name][0]
        assert any("výhrad" in f.lower() for f in p5.flags)


# ── DQ Multiplier ─────────────────────────────────────────────────────────────

class TestDataQualityMultiplier:
    def test_dq_5_plus_statements_no_audit(self):
        """5+ stmts → DQ 1.0, but no audit → *0.85 → penalty applies."""
        stmts = [_stmt(year=y) for y in range(2020, 2025)]
        company = _healthy_company_dict(stmts=stmts)
        trends = compute_financial_trends(stmts)
        result = compute_forensic_scorecard(company, trends)
        dq = [p for p in result.pillars if "Data Quality" in p.name]
        # 5 stmts → 1.0, no audit → *0.85 = 0.85 < 1.0 → penalty
        assert len(dq) == 1
        assert dq[0].score < 0

    def test_dq_5_plus_statements_with_audit(self):
        """5+ stmts with audit → DQ 1.0, no penalty."""
        stmts = [_stmt(year=y, auditorOpinion=SimpleNamespace(opinionType="Bez výhrad")) for y in range(2020, 2025)]
        company = _healthy_company_dict(stmts=stmts)
        trends = compute_financial_trends(stmts)
        result = compute_forensic_scorecard(company, trends)
        dq = [p for p in result.pillars if "Data Quality" in p.name]
        assert len(dq) == 0

    def test_dq_few_statements(self):
        stmts = [_stmt(year=2024)]
        company = _healthy_company_dict(stmts=stmts)
        trends = compute_financial_trends(stmts)
        result = compute_forensic_scorecard(company, trends)
        dq = [p for p in result.pillars if "Data Quality" in p.name]
        # 1 stmt → 0.7 DQ, no audit → *0.85 = 0.595 → penalty applies
        assert len(dq) == 1
        assert dq[0].score < 0  # negative adjustment

    def test_dq_no_audit_penalty(self):
        stmts = [_stmt(year=2023), _stmt(year=2024)]  # 2 stmts, no audit
        company = _healthy_company_dict(stmts=stmts)
        trends = compute_financial_trends(stmts)
        result = compute_forensic_scorecard(company, trends)
        dq = [p for p in result.pillars if "Data Quality" in p.name]
        # 2 stmts → 0.7, no audit → *0.85 = 0.595
        assert len(dq) == 1

    def test_dq_with_audit_no_penalty(self):
        stmts = [
            _stmt(year=2023, auditorOpinion=SimpleNamespace(opinionType="Bez výhrad")),
            _stmt(year=2024, auditorOpinion=SimpleNamespace(opinionType="Bez výhrad")),
            _stmt(year=2025, auditorOpinion=SimpleNamespace(opinionType="Bez výhrad")),
        ]
        company = _healthy_company_dict(stmts=stmts)
        trends = compute_financial_trends(stmts)
        result = compute_forensic_scorecard(company, trends)
        dq = [p for p in result.pillars if "Data Quality" in p.name]
        # 3 stmts → 0.9, has audit → no *0.85 → 0.9 < 1.0 → still penalty
        assert len(dq) == 1


# ── White Horse Penalty ───────────────────────────────────────────────────────

class TestWhiteHorsePenalty:
    def test_shell_company_penalized(self):
        stmts = [
            _stmt(year=2022, mainActivityRevenue=500_000, staffCosts=0, totalAssets=200_000),
            _stmt(year=2023, mainActivityRevenue=600_000, staffCosts=0, totalAssets=200_000),
            _stmt(year=2024, mainActivityRevenue=700_000, staffCosts=0, totalAssets=200_000),
        ]
        company = _healthy_company_dict(stmts=stmts)
        trends = compute_financial_trends(stmts)
        result = compute_forensic_scorecard(company, trends)
        wh = [p for p in result.pillars if "Biely Kôň" in p.name]
        assert len(wh) == 1
        assert wh[0].score < 0  # negative penalty

    def test_normal_company_no_white_horse(self):
        company = _healthy_company_dict()
        trends = _healthy_trends()
        result = compute_forensic_scorecard(company, trends)
        wh = [p for p in result.pillars if "Biely Kôň" in p.name]
        assert len(wh) == 0


# ── ORSR Forensic Penalty ─────────────────────────────────────────────────────

class TestOrsrForensicPenalty:
    def test_critical_orsr_forensic(self):
        company = _healthy_company_dict()
        company["companyEvents"] = [{
            "source": "ORSR",
            "eventType": "FORENSIC_ANALYSIS",
            "severity": "CRITICAL",
            "metadata": {"statutory_changes_count": 15, "high_turnover_risk": True},
            "createdAt": "2024-01-01T00:00:00Z",
        }]
        trends = _healthy_trends()
        result = compute_forensic_scorecard(company, trends)
        orsr = [p for p in result.pillars if "ORSR" in p.name]
        assert len(orsr) == 1
        assert orsr[0].score < 0

    def test_high_orsr_forensic(self):
        company = _healthy_company_dict()
        company["companyEvents"] = [{
            "source": "ORSR",
            "eventType": "FORENSIC_ANALYSIS",
            "severity": "HIGH",
            "metadata": {"statutory_changes_count": 5},
            "createdAt": "2024-01-01T00:00:00Z",
        }]
        trends = _healthy_trends()
        result = compute_forensic_scorecard(company, trends)
        orsr = [p for p in result.pillars if "ORSR" in p.name]
        assert len(orsr) == 1
        assert orsr[0].score < 0

    def test_no_orsr_events(self):
        company = _healthy_company_dict()
        trends = _healthy_trends()
        result = compute_forensic_scorecard(company, trends)
        orsr = [p for p in result.pillars if "ORSR" in p.name]
        assert len(orsr) == 0

    def test_many_statutory_changes(self):
        company = _healthy_company_dict()
        company["companyEvents"] = [{
            "source": "ORSR",
            "eventType": "FORENSIC_ANALYSIS",
            "severity": "INFO",
            "metadata": {"statutory_changes_count": 60},
            "createdAt": "2024-01-01T00:00:00Z",
        }]
        trends = _healthy_trends()
        result = compute_forensic_scorecard(company, trends)
        orsr = [p for p in result.pillars if "ORSR" in p.name]
        # >50 changes → +2 penalty even with INFO severity
        assert len(orsr) == 1
        assert any("60" in f for f in orsr[0].flags)

    def test_virtual_seat_and_foreign_statutory(self):
        company = _healthy_company_dict()
        company["companyEvents"] = [{
            "source": "ORSR",
            "eventType": "FORENSIC_ANALYSIS",
            "severity": "INFO",
            "metadata": {
                "statutory_changes_count": 3,
                "has_virtual_seat": True,
                "has_foreign_statutory": True,
            },
            "createdAt": "2024-01-01T00:00:00Z",
        }]
        trends = _healthy_trends()
        result = compute_forensic_scorecard(company, trends)
        orsr = [p for p in result.pillars if "ORSR" in p.name]
        assert len(orsr) == 1
        assert any("Virtuálne" in f for f in orsr[0].flags)

    def test_big_corp_downgrades_severity(self):
        """Big corp (>10M revenue) with statutory changes → severity downgraded."""
        stmts = [_stmt(year=2024, mainActivityRevenue=15_000_000)]
        company = _healthy_company_dict(stmts=stmts)
        company["companyEvents"] = [{
            "source": "ORSR",
            "eventType": "FORENSIC_ANALYSIS",
            "severity": "CRITICAL",
            "metadata": {"statutory_changes_count": 3},
            "createdAt": "2024-01-01T00:00:00Z",
        }]
        trends = compute_financial_trends(stmts)
        result = compute_forensic_scorecard(company, trends)
        orsr = [p for p in result.pillars if "ORSR" in p.name]
        # Big corp → CRITICAL downgraded to INFO → no -3 penalty
        # But 3 changes < 50, no virtual/foreign → no penalty
        assert len(orsr) == 0

    def test_penalty_capped_at_5(self):
        company = _healthy_company_dict()
        company["companyEvents"] = [{
            "source": "ORSR",
            "eventType": "FORENSIC_ANALYSIS",
            "severity": "CRITICAL",
            "metadata": {
                "statutory_changes_count": 100,
                "has_virtual_seat": True,
                "has_foreign_statutory": True,
            },
            "createdAt": "2024-01-01T00:00:00Z",
        }]
        trends = _healthy_trends()
        result = compute_forensic_scorecard(company, trends)
        orsr = [p for p in result.pillars if "ORSR" in p.name][0]
        # CRITICAL(3) + >50 changes(2) + virtual+foreign(1) = 6, capped at 5
        assert orsr.score == -5


# ── ScorecardResult structure ─────────────────────────────────────────────────

class TestScorecardResult:
    def test_has_5_core_pillars(self):
        company = _healthy_company_dict()
        trends = _healthy_trends()
        result = compute_forensic_scorecard(company, trends)
        core_names = ["Platobná", "Finančné zdravie", "Ziskovosť", "Rast", "Právna"]
        for name in core_names:
            assert any(name in p.name for p in result.pillars), f"Missing pillar: {name}"

    def test_total_score_in_range(self):
        company = _healthy_company_dict()
        trends = _healthy_trends()
        result = compute_forensic_scorecard(company, trends)
        assert 0 <= result.total_score <= 100

    def test_score_version(self):
        company = _healthy_company_dict()
        trends = _healthy_trends()
        result = compute_forensic_scorecard(company, trends)
        assert result.score_version == "v2"

    def test_pillar_scores_within_max(self):
        company = _healthy_company_dict()
        trends = _healthy_trends()
        result = compute_forensic_scorecard(company, trends)
        for p in result.pillars:
            if p.max_score > 0:
                assert p.score <= p.max_score, f"{p.name}: score {p.score} > max {p.max_score}"

    def test_risk_category_matches_score(self):
        company = _healthy_company_dict()
        trends = _healthy_trends()
        result = compute_forensic_scorecard(company, trends)
        assert result.risk_category == _risk_category(result.total_score)


# ── compute_financial_trends ──────────────────────────────────────────────────

class TestComputeFinancialTrends:
    def test_empty_statements(self):
        result = compute_financial_trends([])
        assert "error" in result

    def test_cagr_calculation(self):
        stmts = [
            _stmt(year=2020, mainActivityRevenue=1_000_000),
            _stmt(year=2024, mainActivityRevenue=2_000_000),
        ]
        trends = compute_financial_trends(stmts)
        # CAGR = (2M/1M)^(1/4) - 1 = 0.1892 → 18.92%
        assert trends["cagr_revenue"] is not None
        assert 18 < trends["cagr_revenue"] < 19

    def test_consecutive_losses(self):
        stmts = [
            _stmt(year=2022, netProfitLoss=100_000),
            _stmt(year=2023, netProfitLoss=-50_000),
            _stmt(year=2024, netProfitLoss=-80_000),
        ]
        trends = compute_financial_trends(stmts)
        assert trends["consecutive_losses"] == 2

    def test_no_losses(self):
        stmts = [_stmt(year=2023, netProfitLoss=100_000), _stmt(year=2024, netProfitLoss=200_000)]
        trends = compute_financial_trends(stmts)
        assert trends["consecutive_losses"] == 0

    def test_altman_z_scores_computed(self):
        stmts = [_stmt(year=2023), _stmt(year=2024)]
        trends = compute_financial_trends(stmts)
        assert len(trends["altman_z_scores"]) == 2
        assert "z_score" in trends["altman_z_scores"][0]

    def test_ratios_by_year_computed(self):
        stmts = [_stmt(year=2023), _stmt(year=2024)]
        trends = compute_financial_trends(stmts)
        assert len(trends["ratios_by_year"]) == 2
        assert "current_ratio" in trends["ratios_by_year"][0]

    def test_revenue_trend_yoy(self):
        stmts = [
            _stmt(year=2023, mainActivityRevenue=1_000_000),
            _stmt(year=2024, mainActivityRevenue=1_500_000),
        ]
        trends = compute_financial_trends(stmts)
        assert len(trends["revenue_trend"]) == 1
        assert trends["revenue_trend"][0]["growth_percent"] == 50.0

    def test_bankruptcy_risk_negative_equity(self):
        stmts = [_stmt(year=2024, equity=-100_000)]
        trends = compute_financial_trends(stmts)
        assert any("záporné" in r.lower() for r in trends["bankruptcy_risk_indicators"])

    def test_short_period_anualization(self):
        stmts = [
            _stmt(year=2023, mainActivityRevenue=1_000_000, monthsInPeriod=12),
            _stmt(year=2024, mainActivityRevenue=600_000, monthsInPeriod=6),
        ]
        trends = compute_financial_trends(stmts)
        # ann_curr = 600k * 12/6 = 1.2M, ann_prev = 1M
        # growth = (1.2M - 1M) / 1M * 100 = 20%
        assert trends["revenue_trend"][0]["growth_percent"] == 20.0


# ── compute_state_liabilities_alert ───────────────────────────────────────────

class TestStateLiabilitiesAlert:
    def test_empty_statements(self):
        result = compute_state_liabilities_alert([])
        assert result["alerts"] == []
        assert result["has_critical"] is False

    def test_sp_critical_with_registry(self):
        stmts = [_stmt(year=2024, socialInsuranceLiabilities=25_000)]
        result = compute_state_liabilities_alert(stmts, {"SP_DLZNICI": {"has_record": True}})
        assert result["has_critical"] is True
        assert any(a["severity"] == "CRITICAL" for a in result["alerts"])

    def test_sp_high_without_registry(self):
        stmts = [_stmt(year=2024, socialInsuranceLiabilities=25_000)]
        result = compute_state_liabilities_alert(stmts, {"SP_DLZNICI": {"has_record": False}})
        assert result["has_critical"] is False
        assert all(a["severity"] != "CRITICAL" for a in result["alerts"])

    def test_tax_critical_with_registry(self):
        stmts = [_stmt(year=2024, taxLiabilities=60_000)]
        result = compute_state_liabilities_alert(stmts, {"FINANCNA_SPRAVA": {"has_record": True}})
        assert result["has_critical"] is True

    def test_employee_liabilities_warning(self):
        stmts = [_stmt(year=2024, employeeLiabilities=15_000)]
        result = compute_state_liabilities_alert(stmts)
        assert any(a["severity"] == "WARNING" and "zamestnancom" in a["message"].lower() for a in result["alerts"])

    def test_no_alerts_for_zero_values(self):
        stmts = [_stmt(year=2024, socialInsuranceLiabilities=0, taxLiabilities=0, employeeLiabilities=0)]
        result = compute_state_liabilities_alert(stmts)
        assert result["alerts"] == []

    def test_sp_warning_threshold(self):
        stmts = [_stmt(year=2024, socialInsuranceLiabilities=7_000)]
        result = compute_state_liabilities_alert(stmts, {"SP_DLZNICI": {"has_record": True}})
        assert any(a["severity"] == "WARNING" for a in result["alerts"])


# ── compute_revenue_per_employee_alert ────────────────────────────────────────

class TestRevenuePerEmployee:
    def test_empty_statements(self):
        result = compute_revenue_per_employee_alert([])
        assert result["revenue_per_employee"] is None

    def test_reported_employee_count(self):
        stmts = [_stmt(year=2024, mainActivityRevenue=1_000_000, employeeCount=10)]
        result = compute_revenue_per_employee_alert(stmts)
        assert result["source"] == "reported"
        assert result["employee_count"] == 10
        assert result["revenue_per_employee"] == 100_000

    def test_estimated_employee_count(self):
        stmts = [_stmt(year=2024, mainActivityRevenue=1_000_000, employeeCount=None, staffCosts=180_000)]
        result = compute_revenue_per_employee_alert(stmts)
        assert result["source"] == "estimated"
        assert result["employee_count"] == 10  # 180k / 18k = 10

    def test_critical_alert_one_employee(self):
        stmts = [_stmt(year=2024, mainActivityRevenue=600_000, employeeCount=1)]
        result = compute_revenue_per_employee_alert(stmts)
        assert result["alert"] is not None
        assert result["alert"]["severity"] == "CRITICAL"

    def test_warning_high_rpe(self):
        stmts = [_stmt(year=2024, mainActivityRevenue=5_000_000, employeeCount=2)]
        result = compute_revenue_per_employee_alert(stmts)
        # RPE = 2.5M > 2M → WARNING
        assert result["alert"] is not None
        assert result["alert"]["severity"] == "WARNING"

    def test_no_alert_normal_rpe(self):
        stmts = [_stmt(year=2024, mainActivityRevenue=800_000, employeeCount=10)]
        result = compute_revenue_per_employee_alert(stmts)
        assert result["alert"] is None

    def test_zero_revenue(self):
        stmts = [_stmt(year=2024, mainActivityRevenue=0, employeeCount=10)]
        result = compute_revenue_per_employee_alert(stmts)
        assert result["revenue_per_employee"] is None


# ── compute_yoy_summary_table ─────────────────────────────────────────────────

class TestYoySummaryTable:
    def test_empty_statements(self):
        result = compute_yoy_summary_table([])
        assert result["headers"] == []
        assert result["rows"] == []

    def test_headers_format(self):
        stmts = [_stmt(year=2023), _stmt(year=2024)]
        result = compute_yoy_summary_table(stmts)
        assert result["headers"][0] == "Ukazovateľ"
        assert "2023" in result["headers"]
        assert "2024" in result["headers"]
        assert "Δ%" in result["headers"][-1]

    def test_rows_contain_key_metrics(self):
        stmts = [_stmt(year=2023), _stmt(year=2024)]
        i18n = {
            "yoy_revenue": "Tržby",
            "yoy_net_profit": "Čistý zisk",
            "yoy_total_assets": "Celkové aktíva",
            "yoy_equity": "Vlastné imanie",
            "yoy_short_liab": "Krátkodobé záväzky",
            "yoy_staff_costs": "Osobné náklady",
            "yoy_depreciation": "Odpisy",
            "yoy_interest_expense": "Náklady na úroky",
            "yoy_income_tax": "Daň z príjmu",
        }
        result = compute_yoy_summary_table(stmts, i18n_strings=i18n)
        labels = [r["label"] for r in result["rows"]]
        assert "Tržby" in labels
        assert "Čistý zisk" in labels
        assert "Celkové aktíva" in labels

    def test_all_none_row_skipped(self):
        stmts = [_stmt(year=2024, socialInsuranceLiabilities=None, taxLiabilities=None)]
        result = compute_yoy_summary_table(stmts)
        labels = [r["label"] for r in result["rows"]]
        # SP and tax liabilities are None → should be skipped
        sp_rows = [r for r in result["rows"] if r["field"] == "socialInsuranceLiabilities"]
        assert len(sp_rows) == 0

    def test_revenue_decline_red_flag(self):
        stmts = [
            _stmt(year=2023, mainActivityRevenue=1_000_000),
            _stmt(year=2024, mainActivityRevenue=700_000),  # -30%
        ]
        result = compute_yoy_summary_table(stmts)
        rev_row = [r for r in result["rows"] if r["field"] == "mainActivityRevenue"][0]
        assert rev_row["flag"] == "🔴"

    def test_revenue_growth_green_flag(self):
        stmts = [
            _stmt(year=2023, mainActivityRevenue=1_000_000),
            _stmt(year=2024, mainActivityRevenue=1_500_000),  # +50%
        ]
        result = compute_yoy_summary_table(stmts)
        rev_row = [r for r in result["rows"] if r["field"] == "mainActivityRevenue"][0]
        assert rev_row["flag"] == "🟢"

    def test_liabilities_growth_red_flag(self):
        stmts = [
            _stmt(year=2023, shortTermLiabilities=100_000),
            _stmt(year=2024, shortTermLiabilities=200_000),  # +100%
        ]
        result = compute_yoy_summary_table(stmts)
        liab_row = [r for r in result["rows"] if r["field"] == "shortTermLiabilities"][0]
        assert liab_row["flag"] == "🔴"
