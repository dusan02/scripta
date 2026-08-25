"""
Unit testy pre deterministickú injekciu finančných metrík (placeholder systém).

Testuje:
- build_metric_placeholders(): správne formátovanie hodnôt z DB
- inject_metrics(): nahradzovanie placeholderov v texte
- Edge cases: None hodnoty, division by zero, záporné čísla, chýbajúce dáta
- EBITDA výpočet z grossProfit + depreciation
- YoY trendy s správnym skloňovaním (klesli/vzrástli)
- Altman zóny (Núdzová/Šedá/Bezpečná)
"""
import pytest
from src.pipeline import (
    build_metric_placeholders,
    inject_metrics,
    validate_final_text,
    sanitize_final_text,
    _format_eur,
    _format_ratio,
    _format_pct,
    _format_count,
    _yoy_text,
    _altman_zone,
    _compute_ebitda,
)


# ════════════════════════════════════════════════════════════════════════
# Formátovacie funkcie
# ════════════════════════════════════════════════════════════════════════

class TestFormatEur:
    def test_millions(self):
        assert _format_eur(111_607_748) == "111,6 mil. €"

    def test_millions_negative(self):
        assert _format_eur(-2_686_224) == "-2,7 mil. €"

    def test_thousands(self):
        assert _format_eur(15_593) == "16 tis. €"

    def test_thousands_negative(self):
        assert _format_eur(-26_361) == "-26 tis. €"

    def test_small_value(self):
        assert _format_eur(500) == "500 €"

    def test_zero(self):
        assert _format_eur(0) == "0 €"

    def test_none(self):
        assert _format_eur(None) == "N/A"

    def test_decimal_input(self):
        assert _format_eur(111_607_748.0) == "111,6 mil. €"


class TestFormatRatio:
    def test_basic(self):
        assert _format_ratio(0.62) == "0,62"

    def test_high(self):
        assert _format_ratio(7.76) == "7,76"

    def test_none(self):
        assert _format_ratio(None) == "N/A"


class TestFormatPct:
    def test_basic(self):
        assert _format_pct(13.24) == "13,2 %"

    def test_negative(self):
        assert _format_pct(-2.4) == "-2,4 %"

    def test_none(self):
        assert _format_pct(None) == "N/A"


class TestFormatCount:
    def test_basic(self):
        assert _format_count(1292) == "1 292"

    def test_large(self):
        assert _format_count(1_000_000) == "1 000 000"

    def test_none(self):
        assert _format_count(None) == "N/A"


# ════════════════════════════════════════════════════════════════════════
# YoY text
# ════════════════════════════════════════════════════════════════════════

class TestYoyText:
    def test_growth(self):
        result = _yoy_text(128_000_000, 111_000_000, "vzrástli", "klesli")
        assert "vzrástli" in result
        assert "%" in result

    def test_decline(self):
        result = _yoy_text(111_000_000, 128_000_000, "vzrástli", "klesli")
        assert "klesli" in result
        assert "%" in result

    def test_zero_prev(self):
        assert _yoy_text(100, 0, "vzrástli", "klesli") == "N/A"

    def test_none_curr(self):
        assert _yoy_text(None, 100, "vzrástli", "klesli") == "N/A"

    def test_none_prev(self):
        assert _yoy_text(100, None, "vzrástli", "klesli") == "N/A"


# ════════════════════════════════════════════════════════════════════════
# Altman zóny
# ════════════════════════════════════════════════════════════════════════

class TestAltmanZone:
    def test_distress(self):
        assert _altman_zone(0.5) == "Núdzová zóna"

    def test_distress_boundary(self):
        assert _altman_zone(1.0) == "Núdzová zóna"

    def test_grey(self):
        assert _altman_zone(2.0) == "Šedá zóna"

    def test_safe(self):
        assert _altman_zone(3.0) == "Bezpečná zóna"

    def test_none(self):
        assert _altman_zone(None) == "N/A"


# ════════════════════════════════════════════════════════════════════════
# EBITDA
# ════════════════════════════════════════════════════════════════════════

class TestComputeEbitda:
    def test_gross_plus_depreciation(self):
        stmt = {"grossProfit": 7_819_601, "depreciation": 7_988_038}
        assert _compute_ebitda(stmt) == 15_807_639

    def test_fallback_net_plus_interest_plus_depreciation(self):
        stmt = {"netProfitLoss": -2_686_224, "interestExpense": 703_666, "depreciation": 7_988_038}
        assert _compute_ebitda(stmt) == 6_005_480

    def test_missing_all(self):
        assert _compute_ebitda({}) is None

    def test_none_gross(self):
        stmt = {"grossProfit": None, "depreciation": 1000}
        assert _compute_ebitda(stmt) is None


# ════════════════════════════════════════════════════════════════════════
# build_metric_placeholders
# ════════════════════════════════════════════════════════════════════════

# Fixture: Heineken-like dáta
HEINEKEN_STMTS = [
    {
        "year": 2024,
        "mainActivityRevenue": 128_626_552,
        "netProfitLoss": 3_659_200,
        "totalAssets": 83_663_935,
        "equity": 15_489_174,
        "operatingCashFlow": 6_432_056,
        "cashAndEquivalents": 0,
        "shortTermLiabilities": 31_656_787,
        "longTermLiabilities": 28_955_955,
        "tradeReceivables": 16_836_287,
        "tradePayables": 28_749_011,
        "inventory": 5_853_256,
        "depreciation": 6_978_086,
        "grossProfit": 5_944_856,
        "currentAssets": 27_940_237,
        "employeeCount": None,
    },
    {
        "year": 2025,
        "mainActivityRevenue": 111_607_748,
        "netProfitLoss": -2_686_224,
        "totalAssets": 84_511_671,
        "equity": 9_056_363,
        "operatingCashFlow": 11_726_843,
        "cashAndEquivalents": 0,
        "shortTermLiabilities": 58_760_209,
        "longTermLiabilities": 11_385_287,
        "tradeReceivables": 13_497_956,
        "tradePayables": 33_802_054,
        "inventory": 7_819_601,
        "depreciation": 7_988_038,
        "grossProfit": -7_702_545,
        "currentAssets": 36_592_672,
        "employeeCount": None,
    },
]

HEINEKEN_TRENDS = {
    "altman_z_scores": [
        {"year": 2024, "z_score": 2.8, "zone": "SAFE"},
        {"year": 2025, "z_score": 1.39, "zone": "DISTRESS"},
    ],
}


class TestBuildPlaceholders:
    def test_revenue(self):
        ph = build_metric_placeholders(HEINEKEN_STMTS, HEINEKEN_TRENDS)
        assert ph["{{REVENUE}}"] == "111,6 mil. €"

    def test_revenue_prev(self):
        ph = build_metric_placeholders(HEINEKEN_STMTS, HEINEKEN_TRENDS)
        assert ph["{{REVENUE_PREV}}"] == "128,6 mil. €"

    def test_net_result_negative(self):
        ph = build_metric_placeholders(HEINEKEN_STMTS, HEINEKEN_TRENDS)
        assert ph["{{NET_RESULT}}"] == "-2,7 mil. €"

    def test_net_result_prev_positive(self):
        ph = build_metric_placeholders(HEINEKEN_STMTS, HEINEKEN_TRENDS)
        assert ph["{{NET_RESULT_PREV}}"] == "3,7 mil. €"

    def test_ocf(self):
        ph = build_metric_placeholders(HEINEKEN_STMTS, HEINEKEN_TRENDS)
        assert ph["{{OCF}}"] == "11,7 mil. €"

    def test_cash_zero(self):
        ph = build_metric_placeholders(HEINEKEN_STMTS, HEINEKEN_TRENDS)
        assert ph["{{CASH}}"] == "0 €"

    def test_revenue_yoy_decline(self):
        ph = build_metric_placeholders(HEINEKEN_STMTS, HEINEKEN_TRENDS)
        assert "klesli" in ph["{{REVENUE_YOY}}"]
        assert "%" in ph["{{REVENUE_YOY}}"]

    def test_net_result_yoy_swung_to_loss(self):
        ph = build_metric_placeholders(HEINEKEN_STMTS, HEINEKEN_TRENDS)
        assert ph["{{NET_RESULT_YOY}}"] == "preklopenie do čistej straty"

    def test_altman_z(self):
        ph = build_metric_placeholders(HEINEKEN_STMTS, HEINEKEN_TRENDS)
        assert ph["{{ALTMAN_Z}}"] == "1,39"

    def test_altman_zone_distress(self):
        ph = build_metric_placeholders(HEINEKEN_STMTS, HEINEKEN_TRENDS)
        # 1.39 → Šedá zóna (1.1-2.6)
        assert ph["{{ALTMAN_ZONE}}"] == "Šedá zóna"

    def test_current_ratio(self):
        ph = build_metric_placeholders(HEINEKEN_STMTS, HEINEKEN_TRENDS)
        # 36_592_672 / 58_760_209 = 0.62
        assert ph["{{CURRENT_RATIO}}"] == "0,62"

    def test_debt_equity(self):
        ph = build_metric_placeholders(HEINEKEN_STMTS, HEINEKEN_TRENDS)
        # (58_760_209 + 11_385_287) / 9_056_363 = 7.75
        assert ph["{{DEBT_EQUITY}}"] == "7,75"

    def test_net_margin_negative(self):
        ph = build_metric_placeholders(HEINEKEN_STMTS, HEINEKEN_TRENDS)
        # -2_686_224 / 111_607_748 * 100 = -2.41
        assert ph["{{NET_MARGIN}}"] == "-2,4 %"

    def test_ebitda(self):
        ph = build_metric_placeholders(HEINEKEN_STMTS, HEINEKEN_TRENDS)
        # grossProfit + depreciation = -7_702_545 + 7_988_038 = 285_493
        assert ph["{{EBITDA}}"] == "285 tis. €"

    def test_company_name(self):
        ph = build_metric_placeholders(HEINEKEN_STMTS, HEINEKEN_TRENDS, company_name="Heineken Slovensko, a.s.")
        assert ph["{{COMPANY_NAME}}"] == "Heineken Slovensko, a.s."

    def test_latest_year(self):
        ph = build_metric_placeholders(HEINEKEN_STMTS, HEINEKEN_TRENDS)
        assert ph["{{LATEST_YEAR}}"] == "2025"

    def test_statutar_changes(self):
        ph = build_metric_placeholders(HEINEKEN_STMTS, HEINEKEN_TRENDS, statutar_changes=48)
        assert ph["{{STATUTAR_CHANGES}}"] == "48"

    def test_empty_stmts(self):
        ph = build_metric_placeholders([])
        assert ph == {}

    def test_single_year_no_prev(self):
        ph = build_metric_placeholders([HEINEKEN_STMTS[-1]], HEINEKEN_TRENDS)
        assert ph["{{REVENUE_PREV}}"] == "N/A"
        assert ph["{{REVENUE_YOY}}"] == "N/A"

    def test_none_trends(self):
        ph = build_metric_placeholders(HEINEKEN_STMTS, trends=None)
        assert ph["{{ALTMAN_Z}}"] == "N/A"
        assert ph["{{ALTMAN_ZONE}}"] == "N/A"

    def test_st_liab_yoy_increase(self):
        ph = build_metric_placeholders(HEINEKEN_STMTS, HEINEKEN_TRENDS)
        # 58_760_209 vs 31_656_787 = +85.6%
        assert "nárast" in ph["{{ST_LIAB_YOY}}"]
        assert "%" in ph["{{ST_LIAB_YOY}}"]


# ════════════════════════════════════════════════════════════════════════
# inject_metrics
# ════════════════════════════════════════════════════════════════════════

class TestInjectMetrics:
    def test_basic_replacement(self):
        ph = {"{{REVENUE}}": "111,6 mil. €", "{{OCF}}": "11,7 mil. €"}
        text = "Tržby {{REVENUE}}, OCF {{OCF}}."
        result = inject_metrics(text, ph)
        assert result == "Tržby 111,6 mil. €, OCF 11,7 mil. €."

    def test_yoy_replacement(self):
        ph = {"{{REVENUE_YOY}}": "klesli o 13,2 %"}
        text = "Tržby {{REVENUE_YOY}}, ale OCF zostáva pozitívny."
        result = inject_metrics(text, ph)
        assert result == "Tržby klesli o 13,2 %, ale OCF zostáva pozitívny."

    def test_multiple_placeholders(self):
        ph = {
            "{{REVENUE}}": "111,6 mil. €",
            "{{NET_RESULT}}": "-2,7 mil. €",
            "{{CURRENT_RATIO}}": "0,62",
            "{{ALTMAN_ZONE}}": "Núdzová zóna",
        }
        text = "Tržby {{REVENUE}}, strata {{NET_RESULT}}, likvidita {{CURRENT_RATIO}}, zóna {{ALTMAN_ZONE}}."
        result = inject_metrics(text, ph)
        assert "111,6 mil. €" in result
        assert "-2,7 mil. €" in result
        assert "0,62" in result
        assert "Núdzová zóna" in result

    def test_no_placeholders_in_text(self):
        ph = {"{{REVENUE}}": "111,6 mil. €"}
        text = "Bez placeholderov."
        result = inject_metrics(text, ph)
        assert result == "Bez placeholderov."

    def test_empty_text(self):
        ph = {"{{REVENUE}}": "111,6 mil. €"}
        assert inject_metrics("", ph) == ""

    def test_empty_placeholders(self):
        text = "Text bez placeholderov."
        assert inject_metrics(text, {}) == text

    def test_none_text(self):
        ph = {"{{REVENUE}}": "111,6 mil. €"}
        assert inject_metrics(None, ph) is None

    def test_placeholder_not_in_dict(self):
        # Ak placeholder nie je v dict, neznahradené {{...}} sa odstráni
        # (Jinja2 by ich inak vyrenderoval ako prázdne reťazce)
        ph = {"{{REVENUE}}": "111,6 mil. €"}
        text = "Tržby {{REVENUE}}, EBITDA {{EBITDA}}."
        result = inject_metrics(text, ph)
        assert "111,6 mil. €" in result
        assert "{{EBITDA}}" not in result  # odstránený

    def test_full_heineken_example(self):
        ph = build_metric_placeholders(HEINEKEN_STMTS, HEINEKEN_TRENDS, company_name="Heineken Slovensko, a.s.")
        text = (
            "Spoločnosť {{COMPANY_NAME}} vykazuje tržby {{REVENUE_YOY}}. "
            "Prevádzkový cash flow zostáva pozitívny na úrovni {{OCF}}. "
            "Bežná likvidita {{CURRENT_RATIO}} a Altman Z'' ({{ALTMAN_Z}}) indikujú {{ALTMAN_ZONE}}."
        )
        result = inject_metrics(text, ph)
        assert "Heineken Slovensko, a.s." in result
        assert "klesli" in result
        assert "11,7 mil. €" in result
        assert "0,62" in result
        assert "1,39" in result
        assert "Šedá zóna" in result
        # Žiadne placeholder nezostali
        assert "{{" not in result
        assert "}}" not in result


# ════════════════════════════════════════════════════════════════════════
# Edge cases
# ════════════════════════════════════════════════════════════════════════

class TestEdgeCases:
    def test_division_by_zero_equity(self):
        """D/E keď equity = 0 → N/A (nie ZeroDivisionError)"""
        stmts = [{"year": 2025, "equity": 0, "shortTermLiabilities": 100, "longTermLiabilities": 50}]
        ph = build_metric_placeholders(stmts)
        assert ph["{{DEBT_EQUITY}}"] == "N/A"

    def test_division_by_zero_revenue(self):
        """Net margin keď revenue = 0 → N/A"""
        stmts = [{"year": 2025, "mainActivityRevenue": 0, "netProfitLoss": 100}]
        ph = build_metric_placeholders(stmts)
        assert ph["{{NET_MARGIN}}"] == "N/A"

    def test_division_by_zero_short_term_liab(self):
        """Current ratio keď shortTermLiabilities = 0 → N/A"""
        stmts = [{"year": 2025, "currentAssets": 100, "shortTermLiabilities": 0}]
        ph = build_metric_placeholders(stmts)
        assert ph["{{CURRENT_RATIO}}"] == "N/A"

    def test_all_none_values(self):
        """Všetky hodnoty None → všetky placeholdre N/A"""
        stmts = [{"year": 2025}]
        ph = build_metric_placeholders(stmts)
        assert ph["{{REVENUE}}"] == "N/A"
        assert ph["{{NET_RESULT}}"] == "N/A"
        assert ph["{{OCF}}"] == "N/A"
        assert ph["{{CASH}}"] == "N/A"

    def test_negative_ebitda(self):
        """EBITDA keď grossProfit je veľmi záporný"""
        stmts = [{"year": 2025, "grossProfit": -10_000_000, "depreciation": 2_000_000}]
        ph = build_metric_placeholders(stmts)
        assert ph["{{EBITDA}}"] == "-8,0 mil. €"

    def test_ebitda_margin_negative(self):
        """EBITDA margin keď EBITDA je záporná"""
        stmts = [{
            "year": 2025,
            "grossProfit": -10_000_000,
            "depreciation": 2_000_000,
            "mainActivityRevenue": 100_000_000,
        }]
        ph = build_metric_placeholders(stmts)
        assert ph["{{EBITDA_MARGIN}}"] == "-8,0 %"

    def test_returned_to_profit(self):
        """NET_RESULT_YOY: návrat do zisku"""
        stmts = [
            {"year": 2024, "netProfitLoss": -1_000_000},
            {"year": 2025, "netProfitLoss": 500_000},
        ]
        ph = build_metric_placeholders(stmts)
        assert ph["{{NET_RESULT_YOY}}"] == "návrat do zisku"

    def test_continued_profit(self):
        """NET_RESULT_YOY: vzrástol (oba roky zisk)"""
        stmts = [
            {"year": 2024, "netProfitLoss": 1_000_000},
            {"year": 2025, "netProfitLoss": 2_000_000},
        ]
        ph = build_metric_placeholders(stmts)
        assert "vzrástol" in ph["{{NET_RESULT_YOY}}"]

    def test_continued_loss(self):
        """NET_RESULT_YOY: klesol (oba roky strata)"""
        stmts = [
            {"year": 2024, "netProfitLoss": -1_000_000},
            {"year": 2025, "netProfitLoss": -2_000_000},
        ]
        ph = build_metric_placeholders(stmts)
        assert "klesol" in ph["{{NET_RESULT_YOY}}"]


# ════════════════════════════════════════════════════════════════════════
# NET_RESULT_YOY_PCT
# ════════════════════════════════════════════════════════════════════════

class TestNetResultYoYPct:
    def test_profit_to_loss(self):
        """zisk → strata = 'preklopenie do straty'"""
        stmts = [
            {"year": 2024, "netProfitLoss": 1_000_000},
            {"year": 2025, "netProfitLoss": -500_000},
        ]
        ph = build_metric_placeholders(stmts)
        assert ph["{{NET_RESULT_YOY_PCT}}"] == "preklopenie do straty"

    def test_loss_to_profit(self):
        """strata → zisk = 'návrat do zisku'"""
        stmts = [
            {"year": 2024, "netProfitLoss": -1_000_000},
            {"year": 2025, "netProfitLoss": 500_000},
        ]
        ph = build_metric_placeholders(stmts)
        assert ph["{{NET_RESULT_YOY_PCT}}"] == "návrat do zisku"

    def test_prev_zero_to_profit(self):
        """prev = 0, curr > 0"""
        stmts = [
            {"year": 2024, "netProfitLoss": 0},
            {"year": 2025, "netProfitLoss": 500_000},
        ]
        ph = build_metric_placeholders(stmts)
        assert "z nulového výsledku do zisku" in ph["{{NET_RESULT_YOY_PCT}}"]

    def test_prev_zero_to_loss(self):
        """prev = 0, curr < 0"""
        stmts = [
            {"year": 2024, "netProfitLoss": 0},
            {"year": 2025, "netProfitLoss": -500_000},
        ]
        ph = build_metric_placeholders(stmts)
        assert "z nulového výsledku do straty" in ph["{{NET_RESULT_YOY_PCT}}"]

    def test_both_zero(self):
        """prev = 0, curr = 0"""
        stmts = [
            {"year": 2024, "netProfitLoss": 0},
            {"year": 2025, "netProfitLoss": 0},
        ]
        ph = build_metric_placeholders(stmts)
        assert ph["{{NET_RESULT_YOY_PCT}}"] == "0 %"

    def test_normal_decline(self):
        """normálny pokles zisku"""
        stmts = [
            {"year": 2024, "netProfitLoss": 10_000_000},
            {"year": 2025, "netProfitLoss": 7_000_000},
        ]
        ph = build_metric_placeholders(stmts)
        assert "%" in ph["{{NET_RESULT_YOY_PCT}}"]
        assert "-30,0 %" == ph["{{NET_RESULT_YOY_PCT}}"]

    def test_missing_prev(self):
        """chýba prev year → N/A"""
        ph = build_metric_placeholders([HEINEKEN_STMTS[-1]])
        assert ph["{{NET_RESULT_YOY_PCT}}"] == "N/A"

    def test_both_none(self):
        """oba None → N/A"""
        stmts = [{"year": 2025}, {"year": 2024}]
        ph = build_metric_placeholders(stmts)
        assert ph["{{NET_RESULT_YOY_PCT}}"] == "N/A"


# ════════════════════════════════════════════════════════════════════════
# Dangling fragment cleanup + validate_final_text
# ════════════════════════════════════════════════════════════════════════

class TestDanglingCleanup:
    def test_o_viac_ako_punctuation(self):
        """'prepadol o viac ako.' → 'prepadol.'"""
        text = "čistý zisk sa prepadol o viac ako."
        result = inject_metrics(text, {})
        assert "o viac ako" not in result
        assert "prepadol." in result

    def test_o_viac_ako_conjunction(self):
        """'klesli o viac ako a čistý zisk' → 'klesli a čistý zisk'"""
        text = "Tržby klesli o viac ako a čistý zisk sa prepadol."
        result = inject_metrics(text, {})
        assert "o viac ako" not in result

    def test_o_takmer_conjunction(self):
        """'klesli o takmer a čistý zisk' → 'klesli a čistý zisk'"""
        text = "Tržby medziročne klesli o takmer a čistý zisk sa prepadol."
        result = inject_metrics(text, {})
        assert "o takmer" not in result

    def test_verb_o_punctuation(self):
        """'prepadol o,' → 'prepadol'"""
        text = "čistý zisk sa prepadol o, čo nadväzuje"
        result = inject_metrics(text, {})
        assert "prepadol o," not in result

    def test_vo_vyske_punctuation(self):
        """'vo výške,' → '.'"""
        text = "spoločnosť eviduje rezervu vo výške, ktorá by"
        result = inject_metrics(text, {})
        assert "vo výške," not in result

    def test_vo_vyske_modifier_punctuation(self):
        """'vo výške viac než.' → '.'"""
        text = "kapitálové výdavky vo výške viac než."
        result = inject_metrics(text, {})
        assert "vo výške viac než" not in result

    def test_uveru_co(self):
        """'úveru. čo' → 'úveru, čo'"""
        text = "čerpaním kontokorentného úveru. čo potvrdzuje"
        result = inject_metrics(text, {})
        assert "úveru, čo" in result
        assert "úveru. čo" not in result

    def test_unknown_placeholder_o_viac_ako(self):
        """'o viac ako {{UNKNOWN}}' → must NOT become 'o viac ako.'"""
        text = "zisk sa prepadol o viac ako {{UNKNOWN_PCT}}, čo je zlé."
        result = inject_metrics(text, {})
        assert "o viac ako" not in result
        assert "{{UNKNOWN_PCT}}" not in result
        # validate_final_text should find no dangling
        assert validate_final_text(result) == []

    def test_unknown_placeholder_vo_vyske(self):
        """'vo výške {{UNKNOWN}}' → must NOT become 'vo výške.'"""
        text = "kapitálové výdavky vo výške {{UNKNOWN_AMOUNT}}."
        result = inject_metrics(text, {})
        assert "vo výške" not in result
        assert "{{UNKNOWN_AMOUNT}}" not in result
        assert validate_final_text(result) == []

    def test_valid_placeholders_unchanged(self):
        """Valid placeholders must be replaced correctly, no dangling"""
        ph = {"{{REVENUE}}": "111,6 mil. €", "{{OCF}}": "11,7 mil. €"}
        text = "Tržby {{REVENUE}}, OCF {{OCF}}."
        result = inject_metrics(text, ph)
        assert result == "Tržby 111,6 mil. €, OCF 11,7 mil. €."
        assert validate_final_text(result) == []

    def test_existing_valid_verdict_unchanged(self):
        """Clean text without placeholders must pass through unchanged"""
        text = "Spoločnosť vykazuje tržby 111,6 mil. € a čistý zisk 3,7 mil. €."
        result = inject_metrics(text, {})
        assert validate_final_text(result) == []
        assert "111,6" in result


# ════════════════════════════════════════════════════════════════════════
# validate_final_text
# ════════════════════════════════════════════════════════════════════════

class TestValidateFinalText:
    def test_clean_text(self):
        assert validate_final_text("Tržby klesli o 13,2 %, čo je zlé.") == []

    def test_empty_text(self):
        assert validate_final_text("") == []

    def test_none_text(self):
        assert validate_final_text(None) == []

    def test_o_viac_ako_punct(self):
        findings = validate_final_text("zisk sa prepadol o viac ako.")
        assert len(findings) > 0
        assert any("o viac ako" in f for f in findings)

    def test_vo_vyske_punct(self):
        findings = validate_final_text("rezerva vo výške, ktorá by")
        assert len(findings) > 0

    def test_verb_o_punct(self):
        findings = validate_final_text("zisk klesol o.")
        assert len(findings) > 0

    def test_unresolved_placeholder(self):
        findings = validate_final_text("Text s {{UNKNOWN}} placeholderom.")
        assert len(findings) > 0
        assert any("placeholder" in f for f in findings)

    def test_o_co(self):
        findings = validate_final_text("prepadol o, čo je zlé")
        assert len(findings) > 0


# ════════════════════════════════════════════════════════════════════════
# sanitize_final_text — BLOCKING condition
# ════════════════════════════════════════════════════════════════════════

class TestSanitizeFinalText:
    def test_clean_text_unchanged(self):
        text = "Tržby klesli o 13,2 %, čo je zlé. Prevádzkový cash flow je pozitívny."
        result = sanitize_final_text(text)
        assert result == text

    def test_empty_text(self):
        assert sanitize_final_text("") == ""

    def test_broken_sentence_removed(self):
        """Broken sentence is removed, clean sentence preserved."""
        text = "čistý zisk sa prepadol o viac ako. Prevádzkový cash flow je pozitívny."
        result = sanitize_final_text(text)
        assert "o viac ako" not in result
        assert "Prevádzkový cash flow je pozitívny." in result

    def test_all_broken_returns_empty(self):
        """If all sentences are broken, returns empty string."""
        text = "zisk sa prepadol o viac ako. Tržby klesli o takmer."
        result = sanitize_final_text(text)
        assert result == ""

    def test_mixed_clean_and_broken(self):
        """Multiple sentences: only broken ones removed."""
        text = (
            "Spoločnosť vykazuje tržby 111,6 mil. €. "
            "čistý zisk sa prepadol o viac ako. "
            "Prevádzkový cash flow zostáva pozitívny na úrovni 11,7 mil. €."
        )
        result = sanitize_final_text(text)
        assert "111,6 mil. €" in result
        assert "o viac ako" not in result
        assert "11,7 mil. €" in result

    def test_unresolved_placeholder_removed(self):
        """Unresolved placeholder sentence is removed."""
        text = "Text s {{UNKNOWN}} placeholderom. Druhá veta je čistá."
        result = sanitize_final_text(text)
        assert "{{UNKNOWN}}" not in result
        assert "Druhá veta je čistá." in result

    def test_vo_vyske_sentence_removed(self):
        """'vo výške,' sentence is removed."""
        text = "Rezerva vo výške, ktorá by mohla narásť. Druhá veta je v poriadku."
        result = sanitize_final_text(text)
        assert "vo výške" not in result
        assert "Druhá veta je v poriadku." in result

    def test_legitimate_vo_vyske_with_amount(self):
        """'vo výške 10 mil. €' must NOT be removed — false positive check."""
        text = "Spoločnosť investovala vo výške 10 mil. € do modernizácie."
        result = sanitize_final_text(text)
        assert result == text

    def test_legitimate_o_viac_ako_with_value(self):
        """'o viac ako 20 %' must NOT be removed — false positive check."""
        text = "Tržby klesli o viac ako 20 % v porovnaní s minulým rokom."
        result = sanitize_final_text(text)
        assert result == text

    def test_legitimate_dosiahol_with_amount(self):
        """'dosiahol 5 mil. €' must NOT be removed — false positive check."""
        text = "EBITDA dosiahol 5 mil. €, čo je pozitívny signál."
        result = sanitize_final_text(text)
        assert result == text

    def test_completely_broken_returns_empty(self):
        """All sentences broken → empty string, not truncated fragment."""
        text = "zisk sa prepadol o viac ako. Tržby klesli o takmer. Rezerva vo výške."
        result = sanitize_final_text(text)
        assert result == ""
        assert "o viac ako" not in result
        assert "o takmer" not in result
