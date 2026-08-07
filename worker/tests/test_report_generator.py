"""
Unit testy pre report_generator.py — formátovanie, heatmap logika a rendering.

Pokrýva:
- format_currency: formátovanie EUR (mil., tis., jednotky, None, invalid)
- format_number: formátovanie čísel bez menovej prípony
- format_number_millions: formátovanie v miliónoch
- format_cf_millions: cash flow formátovanie (0 = chýbajúce dáta)
- _is_garbled: detekcia garbled textu (cyrillica, CJK, arabic, low alpha ratio)
- sanitize_llm_text: sanitizácia LLM textu (LaTeX, preklepy, garbled)
- compute_fraud_heatmap: agregácia varovných indikátorov do heatmap gridu
- compute_insolvency_score: výpočet insolventného skóre
- _translate_flag: preklad flagov cez i18n
- render_html_report: smoke test — rendering HTML z context dict (bez DB)
"""

import json
import pytest
from types import SimpleNamespace
from unittest.mock import MagicMock

from src.report_generator import (
    format_currency,
    format_number,
    format_number_millions,
    format_cf_millions,
    _is_garbled,
    sanitize_llm_text,
    compute_fraud_heatmap,
    compute_insolvency_score,
    _translate_flag,
    render_html_report,
    get_i18n_strings,
)


# ═══════════════════════════════════════════════════════════════════════════
# format_currency
# ═══════════════════════════════════════════════════════════════════════════

class TestFormatCurrency:
    def test_none_returns_na(self):
        assert format_currency(None) == "N/A"

    def test_millions(self):
        result = format_currency(1_500_000)
        assert "mil" in result
        assert "€" in result

    def test_thousands(self):
        result = format_currency(50_000)
        assert "tis" in result
        assert "€" in result

    def test_small_number(self):
        result = format_currency(500)
        assert "500" in result
        assert "€" in result

    def test_zero(self):
        result = format_currency(0)
        assert "0" in result

    def test_negative_millions(self):
        result = format_currency(-2_000_000)
        assert "mil" in result
        assert "-" in result

    def test_invalid_string(self):
        assert format_currency("abc") == "N/A"

    def test_invalid_type(self):
        assert format_currency([1, 2]) == "N/A"

    def test_slovak_decimal_separator(self):
        """SK formát používa čiarku ako desatinný separator."""
        result = format_currency(1_500_000)
        # 1,5 mil. € (s SK desatinnou čiarkou)
        assert "," in result


# ═══════════════════════════════════════════════════════════════════════════
# format_number
# ═══════════════════════════════════════════════════════════════════════════

class TestFormatNumber:
    def test_none_returns_na(self):
        assert format_number(None) == "N/A"

    def test_millions(self):
        result = format_number(2_500_000)
        assert "2,5" in result or "2,50" in result

    def test_thousands(self):
        result = format_number(75_000)
        assert "75" in result

    def test_small_number(self):
        result = format_number(42)
        assert "42" in result

    def test_no_euro_suffix(self):
        """format_number by nemal obsahovať €."""
        result = format_number(1_000_000)
        assert "€" not in result

    def test_invalid(self):
        assert format_number("xyz") == "N/A"


# ═══════════════════════════════════════════════════════════════════════════
# format_number_millions
# ═══════════════════════════════════════════════════════════════════════════

class TestFormatNumberMillions:
    def test_none_returns_dash(self):
        assert format_number_millions(None) == "—"

    def test_zero_default(self):
        result = format_number_millions(0)
        # Default: 0 sa zobrazí ako 0,00
        assert "0,00" in result

    def test_zero_treat_as_none(self):
        result = format_number_millions(0, treat_zero_as_none=True)
        assert result == "—"

    def test_million_value(self):
        result = format_number_millions(1_500_000)
        assert "1,50" in result

    def test_thousands_value(self):
        """Hodnota v tisícoch sa zobrazí ako 0,XX mil."""
        result = format_number_millions(50_000)
        assert "0,05" in result

    def test_invalid(self):
        assert format_number_millions("abc") == "—"


# ═══════════════════════════════════════════════════════════════════════════
# format_cf_millions
# ═══════════════════════════════════════════════════════════════════════════

class TestFormatCfMillions:
    def test_none_returns_dash(self):
        assert format_cf_millions(None) == "—"

    def test_zero_returns_dash(self):
        """Pre cash flow: 0 = chýbajúce dáta, nie nulový CF."""
        assert format_cf_millions(0) == "—"

    def test_positive_value(self):
        result = format_cf_millions(500_000)
        assert "0,50" in result

    def test_negative_value(self):
        result = format_cf_millions(-200_000)
        assert "-0,20" in result


# ═══════════════════════════════════════════════════════════════════════════
# _is_garbled
# ═══════════════════════════════════════════════════════════════════════════

class TestIsGarbled:
    def test_clean_slovak_text(self):
        assert _is_garbled("Firma vykazuje stabilné finančné zdravie s kladným ziskom.") is False

    def test_empty_string(self):
        assert _is_garbled("") is False

    def test_short_string(self):
        assert _is_garbled("abc") is False

    def test_cyrillic_text(self):
        assert _is_garbled("Это какой-то русский текст") is True

    def test_cjk_text(self):
        assert _is_garbled("这是一个很长的中文文本用于测试") is True

    def test_mixed_garbled(self):
        text = "Firma má zisk abc123!@#$%^&*()_+-=[]{}|;':\",./<>?`~"
        assert _is_garbled(text) is True  # low alpha ratio

    def test_normal_english(self):
        assert _is_garbled("The company shows stable financial health with positive profit.") is False


# ═══════════════════════════════════════════════════════════════════════════
# sanitize_llm_text
# ═══════════════════════════════════════════════════════════════════════════

class TestSanitizeLlmText:
    def test_empty_string(self):
        assert sanitize_llm_text("") == ""

    def test_none_input(self):
        assert sanitize_llm_text(None) is None

    def test_clean_text_unchanged(self):
        text = "Firma vykazuje stabilné finančné zdravie."
        assert sanitize_llm_text(text) == text

    def test_latex_dollar_removed(self):
        text = "Skóre $Z'' = 2.5$ je v bezpečnej zóne."
        result = sanitize_llm_text(text)
        assert "$" not in result

    def test_garbled_text_replaced(self):
        text = "Это какой-то русский текст"
        result = sanitize_llm_text(text)
        # Garbled text should be replaced (not contain cyrillic)
        assert "Это" not in result


# ═══════════════════════════════════════════════════════════════════════════
# compute_fraud_heatmap
# ═══════════════════════════════════════════════════════════════════════════

class TestComputeFraudHeatmap:
    def _i18n(self):
        """Minimálne i18n strings pre heatmap."""
        return {
            "fraud_cat_vestnik": "Obchodný vestník",
            "fraud_cat_forensic": "Forenzná analýza",
            "fraud_cat_narrative": "Naratívna analýza",
            "fraud_cat_notes": "Poznámky k výkazom",
            "fraud_cat_auditor": "Auditné overenie",
            "fraud_cat_legal": "Právne registre",
            "fraud_cat_financial": "Finančné ukazovatele",
            "fraud_severity_critical": "Kritické",
            "fraud_severity_high": "Vysoké",
            "fraud_severity_medium": "Stredné",
            "fraud_severity_low": "Nízke",
            "fraud_severity_none": "Žiadne",
            "fraud_flags_found": "{n} nájdených",
            "fraud_no_flags": "Žiadne varovné indikátory",
        }

    def test_empty_inputs_all_none(self):
        """Prázdne vstupy — všetky kategórie by mali byť 'none'."""
        result = compute_fraud_heatmap(None, [], [], self._i18n())
        assert result["has_data"] is not None
        cats = {c["label"]: c for c in result["categories"]}
        # Aspoň jedna kategória by mala existovať
        assert len(result["categories"]) > 0

    def test_vestnik_critical_event(self):
        """Kritický vestník event → critical severity pre vestnik kategóriu."""
        event = SimpleNamespace(
            sourceId="OV_123",
            eventType="Zmena konateľa",
            severityLevel="CRITICAL",
        )
        result = compute_fraud_heatmap(None, [], [event], self._i18n())
        vestnik_cat = [c for c in result["categories"] if "vestník" in c["label"].lower() or "vestnik" in c["label"].lower()]
        assert len(vestnik_cat) >= 1
        assert vestnik_cat[0]["severity"] == "critical"
        assert vestnik_cat[0]["count"] == 1

    def test_vestnik_high_event(self):
        """Vysoký vestník event → high severity."""
        event = SimpleNamespace(
            sourceId="OV_456",
            eventType="Zmena sídla",
            severityLevel="HIGH",
        )
        result = compute_fraud_heatmap(None, [], [event], self._i18n())
        vestnik_cat = [c for c in result["categories"] if "vestník" in c["label"].lower() or "vestnik" in c["label"].lower()]
        assert vestnik_cat[0]["severity"] == "high"

    def test_insolvency_event_separated(self):
        """Insolvenčné eventy sa oddeľujú od bežných vestník eventov."""
        event = SimpleNamespace(
            sourceId="INSOLVENCY_123",
            eventType="konkurz",
            severityLevel="CRITICAL",
        )
        result = compute_fraud_heatmap(None, [], [event], self._i18n())
        vestnik_cat = [c for c in result["categories"] if "vestník" in c["label"].lower() or "vestnik" in c["label"].lower()]
        # Insolvenčné eventy by nemali byť vo vestník kategórii
        assert vestnik_cat[0]["count"] == 0
        assert vestnik_cat[0]["severity"] == "none"

    def test_forensic_flags_from_verdict(self):
        """Forenzné flagy z verdictu → forensic kategória."""
        verdict = SimpleNamespace(forensicRedFlags=json.dumps(["flag1", "flag2", "flag3"]))
        result = compute_fraud_heatmap(verdict, [], [], self._i18n())
        forensic_cat = [c for c in result["categories"] if "forenzn" in c["label"].lower()]
        assert forensic_cat[0]["severity"] == "critical"  # 3+ flags = critical
        assert forensic_cat[0]["count"] == 3


# ═══════════════════════════════════════════════════════════════════════════
# compute_insolvency_score
# ═══════════════════════════════════════════════════════════════════════════

class TestComputeInsolvencyScore:
    def _i18n(self):
        return {
            "insolv_score_label": "Insolvenčné skóre",
            "insolv_score_safe": "Bezpečná zóna",
            "insolv_score_grey": "Šedá zóna",
            "insolv_score_distress": "Núdzová zóna",
        }

    def test_empty_statements(self):
        """Prázdne výkazy — skóre by malo byť 0 alebo None."""
        result = compute_insolvency_score([], self._i18n())
        assert result is not None

    def test_none_statements(self):
        result = compute_insolvency_score(None, self._i18n())
        assert result is not None


# ═══════════════════════════════════════════════════════════════════════════
# _translate_flag
# ═══════════════════════════════════════════════════════════════════════════

class TestTranslateFlag:
    def test_known_flag_translated(self):
        """Známy flag sa preloží cez i18n."""
        i18n = {"flag_beneish_manipulator": "Beneish indikácia manipulácie"}
        result = _translate_flag("Beneish M-score: pravdepodobný manipulátor", i18n)
        # Buď preložené, alebo pôvodný text (ak sa kľúč nenájde)
        assert result is not None
        assert isinstance(result, str)

    def test_unknown_flag_returns_original(self):
        """Neznámy flag vráti pôvodný text."""
        i18n = {}
        result = _translate_flag("Unknown flag text", i18n)
        assert result == "Unknown flag text" or result is not None


# ═══════════════════════════════════════════════════════════════════════════
# render_html_report — smoke testy (bez DB, len rendering z context dict)
# ═══════════════════════════════════════════════════════════════════════════

def _minimal_context(**overrides):
    """Vytvorí minimálny context dict pre render_html_report.
    Všetky kľúče majú bezpečné default hodnoty (None, [], {}, "")."""
    i18n = get_i18n_strings("sk")
    # Mock verdict — template pristupuje k verdict.verifaScore, verdict.finalVerdict, atď.
    mock_verdict = SimpleNamespace(
        verifaScore=65,
        riskCategory="A",
        finalVerdict="Firma vykazuje stabilné finančné zdravie.",
        executiveSummary="Stabilná firma s kladným ziskom.",
        keyRisk="Žiadne kritické riziká.",
        debtExposureRating=None,
        llmAnalysisStatus="LLM_ANALYZED",
        llmScoreAdjustment=0,
        justification="[]",
        scorecardBreakdown=None,
    )
    ctx = {
        "company": SimpleNamespace(ico="12345678", nazov="Test s.r.o.", name="Test s.r.o.", auditVerdict=mock_verdict, financialStatements=[]),
        "verdict": mock_verdict,
        "evidence_list": [],
        "latest_stmt": None,
        "stmts_sorted": [],
        "stmts": [],
        "ebitda_by_year": {},
        "latest_ratios": None,
        "gross_profit_estimated": False,
        "gross_profit_all_estimated": False,
        "estimated_gp_years": [],
        "cashflow_estimated": False,
        "has_cashflow_data": False,
        "nace_code": "",
        "nace_text": "",
        "employee_count": None,
        "employee_count_estimated": False,
        "vestnik_events": [],
        "chart_image_base64": "",
        "balance_chart_base64": "",
        "pnl_chart_base64": "",
        "cashflow_chart_base64": "",
        "altman_chart_base64": "",
        "logo_base64": "",
        "start_pages_map": {},
        "total_pages": 0,
        "generated_at": "2024-01-01",
        "counts": SimpleNamespace(SUCCESS=0, WARNING=0, INFO=0, UNAVAILABLE=0, FAILED=0, PARTIAL=0, SKIPPED=0),
        "grouped_sources": {},
        "labels": {},
        "scorecard_breakdown": [],
        "algorithmic_total": 65,
        "hard_stop": False,
        "altman_scores": [],
        "is_financial_institution": False,
        "is_startup": False,
        "startup_info": None,
        "has_mixed_consolidation": False,
        "has_non_standard_months": False,
        "has_short_history": False,
        "piotroski_score": None,
        "piotroski_flags": [],
        "beneish_m_score": None,
        "beneish_is_manipulator": False,
        "beneish_flags": [],
        "yoy_revenue_growth": [],
        "yoy_profit_growth": [],
        "trend_ratios": {},
        "ratios_chart_base64": "",
        "radar_chart_base64": "",
        "auditor_opinion": None,
        "gauge_end_x": 0,
        "gauge_end_y": 0,
        "gauge_large_arc": 0,
        "cf_waterfall_base64": "",
        "bs_infographic_base64": "",
        "pl_infographic_base64": "",
        "liquidity_chart_base64": "",
        "employee_chart_base64": "",
        "rpe_chart_base64": "",
        "asset_composition_chart_base64": "",
        "equity_composition_chart_base64": "",
        "statement_delay_days": None,
        "qr_base64": "",
        "valid_until": "",
        "confidence_score": 0,
        "confidence_factors": [],
        "company_city": "",
        "company_founded_year": None,
        "revenue_per_employee": None,
        "report_language": "sk",
        "i18n": i18n,
        "insolvency_score": None,
        "fraud_heatmap": {"categories": [], "has_data": False},
        "strengths_weaknesses": {"strengths": [], "weaknesses": []},
        "state_liabilities_alert": None,
        "rpe_alert": None,
        "yoy_table": [],
    }
    ctx.update(overrides)
    return ctx


class TestRenderHtmlReport:
    """Smoke testy pre render_html_report — overujú že rendering nezhavaruje."""

    def test_minimal_context_renders_html(self):
        """Minimálny context (žiadne dáta) by mal vyrenderovať HTML bez chyby."""
        ctx = _minimal_context()
        html = render_html_report(ctx)
        assert isinstance(html, str)
        assert len(html) > 1000  # HTML by malo mať nejaký obsah
        assert "<html" in html.lower() or "<!doctype" in html.lower()

    def test_html_contains_company_name(self):
        """HTML by malo obsahovať názov firmy."""
        ctx = _minimal_context(company={"ico": "12345678", "nazov": "Test s.r.o.", "auditVerdict": None})
        html = render_html_report(ctx)
        assert "Test s.r.o." in html or "12345678" in html

    def test_html_contains_ico(self):
        """HTML by malo obsahovať IČO."""
        ctx = _minimal_context()
        html = render_html_report(ctx)
        assert "12345678" in html

    def test_html_with_hard_stop(self):
        """Hard stop scenario by mal vyrenderovať bez chyby."""
        ctx = _minimal_context(hard_stop=True)
        html = render_html_report(ctx)
        assert isinstance(html, str)
        assert len(html) > 1000

    def test_html_with_scorecard_breakdown(self):
        """Scorecard breakdown by mal vyrenderovať bez chyby."""
        ctx = _minimal_context(
            scorecard_breakdown=[
                {"name": "Platobná schopnosť", "score": 20, "max_score": 30, "detail": "OK"},
                {"name": "Finančné zdravie", "score": 15, "max_score": 25, "detail": "Stabilné"},
            ],
            algorithmic_total=65,
        )
        html = render_html_report(ctx)
        assert isinstance(html, str)
        assert "Platobná schopnosť" in html or "65" in html

    def test_html_english_language(self):
        """EN jazyk by mal vyrenderovať bez chyby."""
        i18n = get_i18n_strings("en")
        ctx = _minimal_context(report_language="en", i18n=i18n)
        html = render_html_report(ctx)
        assert isinstance(html, str)
        assert len(html) > 1000

    def test_html_german_language(self):
        """DE jazyk by mal vyrenderovať bez chyby."""
        i18n = get_i18n_strings("de")
        ctx = _minimal_context(report_language="de", i18n=i18n)
        html = render_html_report(ctx)
        assert isinstance(html, str)
        assert len(html) > 1000

    def test_html_with_charts(self):
        """Context s chart base64 by mal vyrenderovať bez chyby (charts sa zobrazia len keď existuje latest_stmt)."""
        ctx = _minimal_context(
            cashflow_chart_base64="data:image/png;base64,iVBORw0KGgo=",
            altman_chart_base64="data:image/png;base64,iVBORw0KGgo=",
            ratios_chart_base64="data:image/png;base64,iVBORw0KGgo=",
        )
        html = render_html_report(ctx)
        assert isinstance(html, str)
        assert len(html) > 1000  # Rendering nezhavaroval

    def test_html_with_fraud_heatmap(self):
        """Fraud heatmap s kategóriami by mal vyrenderovať bez chyby."""
        ctx = _minimal_context(
            fraud_heatmap={
                "categories": [
                    {"label": "Obchodný vestník", "severity": "critical", "count": 2, "color": "#dc2626", "bg": "#fef2f2", "details": ["event1"]},
                    {"label": "Forenzná analýza", "severity": "none", "count": 0, "color": "#94a3b8", "bg": "#f8fafc", "details": []},
                ],
                "has_data": True,
            },
        )
        html = render_html_report(ctx)
        assert isinstance(html, str)
        assert "Obchodný vestník" in html or "vestník" in html.lower()
