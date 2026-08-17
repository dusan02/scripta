"""
Unit testy pre pipeline.py — orákestrácia generovania reportu.

Pokrýva:
- _extract_year_from_fn: extrakcia roku z názvu súboru
- _check_cross_year_unit_consistency: detekcia nekonzistentných jednotiek (EUR vs tisíce EUR)
- _check_cross_year_duplicates: detekcia duplicitných osobných nákladov naprieč rokmi
- _sanitize_verdict_text: sanitizácia LLM textu (garbled, preklepy, LaTeX)
- _strip_hallucinated_debts: anti-halucinácia — odstránenie fiktívnych dlhov z CLEAN registrov
- _build_fallback_verdict: fallback verdikt keď LLM zlyhá
- _remaining_eta: dynamický remaining ETA
"""

import json
import time
import pytest
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from src.llm_extractor import CompanyFinancialExtraction
from src.agents.shared import FinancialMetrics, AuditorReportData
from src.agents.chief_auditor import AuditVerdict, EvidenceItem
from src.analytics import ScorecardResult, ScorecardPillar
from src.pipeline import (
    _extract_year_from_fn,
    _check_cross_year_unit_consistency,
    _check_cross_year_duplicates,
    _sanitize_verdict_text,
    _strip_hallucinated_debts,
    _build_fallback_verdict,
    _remaining_eta,
    _apply_orsr_override,
    _apply_balance_sheet_fallbacks,
)


# ── Helpers ───────────────────────────────────────────────────────────────────

def _metrics(year, **kwargs):
    """Vytvorí FinancialMetrics s predvolenými null hodnotami."""
    defaults = dict(
        rok_zavierky=year,
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
        dan_z_prijmu=None,
        pocet_zamestnancov=None,
        zavazky_sp=None,
        danove_zavazky=None,
        zavazky_zamestnanci=None,
        mena="EUR",
        typ_zavierky="SK_GAAP",
        pocet_mesiacov_obdobia=12,
        is_consolidated=False,
    )
    defaults.update(kwargs)
    return FinancialMetrics(**defaults)


def _extraction(year, **metric_kwargs):
    """Vytvorí CompanyFinancialExtraction s danými metrikami."""
    audit = AuditorReportData(
        nazor_auditora="Bez výhrad",
        going_concern_riziko=False,
        auditor_vyhrady_text=None,
    )
    return CompanyFinancialExtraction(
        ico="12345678",
        nazov_spolocnosti="Test s.r.o.",
        audit=audit,
        metriky=_metrics(year, **metric_kwargs),
    )


# ═══════════════════════════════════════════════════════════════════════════
# _extract_year_from_fn
# ═══════════════════════════════════════════════════════════════════════════

class TestExtractYearFromFn:
    def test_standard_ifrs_filename(self):
        assert _extract_year_from_fn("IFRS_35876832_2024_0.pdf") == 2024

    def test_standard_ruz_filename(self):
        assert _extract_year_from_fn("RUZ_12345678_2023_1.pdf") == 2023

    def test_no_year_in_filename(self):
        assert _extract_year_from_fn("report.pdf") == 0

    def test_full_path(self):
        assert _extract_year_from_fn("/tmp/scrape/IFRS_12345678_2022_0.pdf") == 2022

    def test_short_filename(self):
        assert _extract_year_from_fn("a_b.pdf") == 0

    def test_year_not_digit(self):
        assert _extract_year_from_fn("IFRS_12345678_abc_0.pdf") == 0


# ═══════════════════════════════════════════════════════════════════════════
# _check_cross_year_unit_consistency
# ═══════════════════════════════════════════════════════════════════════════

class TestCrossYearUnitConsistency:
    def test_consistent_units_no_change(self):
        """Všetky roky v rovnakých jednotkách — žiadna zmena."""
        results = [
            _extraction(2024, celkove_aktiva=1_200_000),
            _extraction(2023, celkove_aktiva=1_100_000),
            _extraction(2022, celkove_aktiva=1_000_000),
        ]
        _check_cross_year_unit_consistency(results)
        assert results[0].metriky.celkove_aktiva == 1_200_000
        assert results[1].metriky.celkove_aktiva == 1_100_000
        assert results[2].metriky.celkove_aktiva == 1_000_000

    def test_thousands_eur_detected_and_fixed(self):
        """Jeden rok v tisícoch EUR — mal by byť vynásobený ×1000."""
        results = [
            _extraction(2024, celkove_aktiva=1_200_000),
            _extraction(2023, celkove_aktiva=1_200),  # tisíce EUR
            _extraction(2022, celkove_aktiva=1_100_000),
        ]
        _check_cross_year_unit_consistency(results)
        assert results[1].metriky.celkove_aktiva == 1_200_000  # opravené

    def test_all_years_thousands_no_fix(self):
        """Ak by sa všetky roky opravovali — záchytná kontrola zabráni."""
        results = [
            _extraction(2024, celkove_aktiva=1_200),
            _extraction(2023, celkove_aktiva=1_100),
        ]
        _check_cross_year_unit_consistency(results)
        # Ratio ~1.09 — mimo rozsah 100-10000, takže sa neopraví
        assert results[0].metriky.celkove_aktiva == 1_200
        assert results[1].metriky.celkove_aktiva == 1_100

    def test_single_year_no_op(self):
        """Jeden rok — žiadna kontrola."""
        results = [_extraction(2024, celkove_aktiva=1_200_000)]
        _check_cross_year_unit_consistency(results)
        assert results[0].metriky.celkove_aktiva == 1_200_000

    def test_no_assets_data_no_op(self):
        """Žiadne dáta o aktívach — žiadna zmena."""
        results = [
            _extraction(2024, celkove_aktiva=None),
            _extraction(2023, celkove_aktiva=None),
        ]
        _check_cross_year_unit_consistency(results)
        assert results[0].metriky.celkove_aktiva is None

    def test_money_fields_all_multiplied(self):
        """Pri oprave jednotiek sa násobia všetky peňažné polia, nielen aktíva."""
        results = [
            _extraction(2024, celkove_aktiva=1_000_000, osobne_naklady=200_000, trzby_z_hlavnej_cinnosti=2_000_000),
            _extraction(2023, celkove_aktiva=1_000, osobne_naklady=200, trzby_z_hlavnej_cinnosti=2_000),
        ]
        _check_cross_year_unit_consistency(results)
        assert results[1].metriky.celkove_aktiva == 1_000_000
        assert results[1].metriky.osobne_naklady == 200_000
        assert results[1].metriky.trzby_z_hlavnej_cinnosti == 2_000_000


# ═══════════════════════════════════════════════════════════════════════════
# _check_cross_year_duplicates
# ═══════════════════════════════════════════════════════════════════════════

class TestCrossYearDuplicates:
    def test_no_duplicates_no_change(self):
        """Rôzne hodnoty — žiadna zmena."""
        results = [
            _extraction(2024, osobne_naklady=200_000),
            _extraction(2023, osobne_naklady=180_000),
            _extraction(2022, osobne_naklady=160_000),
        ]
        _check_cross_year_duplicates(results)
        assert all(r.metriky.osobne_naklady is not None for r in results)

    def test_non_adjacent_duplicate_nulled(self):
        """Nesusedné roky s rovnakou hodnotou — starší sa nulluje."""
        results = [
            _extraction(2024, osobne_naklady=200_000),
            _extraction(2023, osobne_naklady=180_000),
            _extraction(2022, osobne_naklady=200_000),  # duplikát s 2024
        ]
        _check_cross_year_duplicates(results)
        # 2024 (najnovší) sa zachová, 2022 sa nulluje
        assert results[0].metriky.osobne_naklady == 200_000
        assert results[2].metriky.osobne_naklady is None

    def test_adjacent_same_value_kept(self):
        """Susedné roky s rovnakou hodnotou — môže byť legitímne, neznevalidňuje."""
        results = [
            _extraction(2024, osobne_naklady=200_000),
            _extraction(2023, osobne_naklady=200_000),
        ]
        _check_cross_year_duplicates(results)
        # Susedné roky — neznevalidňuje
        assert results[0].metriky.osobne_naklady == 200_000
        assert results[1].metriky.osobne_naklady == 200_000

    def test_three_years_same_value(self):
        """3 roky s rovnakou hodnotou — staršie sa nullujú."""
        results = [
            _extraction(2024, osobne_naklady=200_000),
            _extraction(2023, osobne_naklady=200_000),
            _extraction(2022, osobne_naklady=200_000),
        ]
        _check_cross_year_duplicates(results)
        assert results[0].metriky.osobne_naklady == 200_000  # najnovší zostáva
        assert results[1].metriky.osobne_naklady is None
        assert results[2].metriky.osobne_naklady is None

    def test_no_staff_data_no_op(self):
        """Žiadne osobné náklady — žiadna zmena."""
        results = [
            _extraction(2024, osobne_naklady=None),
            _extraction(2023, osobne_naklady=None),
        ]
        _check_cross_year_duplicates(results)
        assert results[0].metriky.osobne_naklady is None


# ═══════════════════════════════════════════════════════════════════════════
# _sanitize_verdict_text
# ═══════════════════════════════════════════════════════════════════════════

class TestSanitizeVerdictText:
    def test_empty_string(self):
        assert _sanitize_verdict_text("") == ""

    def test_none_input(self):
        assert _sanitize_verdict_text(None) is None

    def test_clean_text_unchanged(self):
        text = "Firma vykazuje stabilné finančné zdravie."
        assert _sanitize_verdict_text(text) == text

    def test_garbled_cyrillic_returns_empty(self):
        text = "Это текст на кириллице с дополнительными символами"
        assert _sanitize_verdict_text(text) == ""

    def test_garbled_cjk_returns_empty(self):
        text = "这是一个中文文本测试内容"
        assert _sanitize_verdict_text(text) == ""

    def test_ale_to_lower(self):
        text = "Firma je stabilná. ALE má niektoré riziká."
        result = _sanitize_verdict_text(text)
        assert "ALE" not in result
        assert "ale" in result

    def test_latex_dollar_signs_removed(self):
        text = "Skóre je $Z'' = 2.5$ čo je v bezpečnej zóne."
        result = _sanitize_verdict_text(text)
        assert "$" not in result
        assert "Z'' = 2.5" in result

    def test_latex_prime_replaced(self):
        text = r"Altman Z\prime\prime skóre"
        result = _sanitize_verdict_text(text)
        assert "\\prime" not in result
        assert "''" in result

    def test_dovera_typo_fixed(self):
        text = "Dövera poisťovňa hlási dlh."
        result = _sanitize_verdict_text(text)
        assert "Dôvera" in result
        assert "Dövera" not in result

    def test_diznik_typo_fixed(self):
        text = "Firma je dižnik v registri."
        result = _sanitize_verdict_text(text)
        assert "dlžník" in result
        assert "dižnik" not in result

    def test_compound_dovera_dlznici_fixed(self):
        text = "Dôveradižníci neobsahujú záznam."
        result = _sanitize_verdict_text(text)
        assert "Dôvera — dlžníci" in result

    def test_vszp_compound_fixed(self):
        text = "VšZP-dižníci neobsahujú záznam."
        result = _sanitize_verdict_text(text)
        assert "VšZP — dlžníci" in result

    def test_fimra_typo_fixed(self):
        text = "Fimra vykazuje zisk."
        result = _sanitize_verdict_text(text)
        assert "Firma" in result
        assert "Fimra" not in result


# ═══════════════════════════════════════════════════════════════════════════
# _strip_hallucinated_debts
# ═══════════════════════════════════════════════════════════════════════════

class TestStripHallucinatedDebts:
    def test_no_clean_registries_no_change(self):
        """Žiadny CLEAN register — žiadna zmena."""
        payload = {
            "finalVerdict": "Firma má dlh 500 000 EUR voči Sociálnej poisťovni.",
            "executiveSummary": "Dlh voči SP je 500 000 EUR.",
            "keyRisk": "Dlh voči SP.",
        }
        result = _strip_hallucinated_debts(payload, ["SP_DLZNICI: HAS_DEBT"], "12345678")
        assert result["finalVerdict"] == payload["finalVerdict"]

    def test_clean_registry_strips_hallucinated_amount(self):
        """CLEAN register + EUR suma v texte → odstráni halucinovanú vetu."""
        payload = {
            "finalVerdict": "Firma má dlh 500 000 EUR voči sociálna poisťovňa. Iné riziká sú minimálne.",
            "executiveSummary": "",
            "keyRisk": "",
        }
        result = _strip_hallucinated_debts(payload, ["SP_DLZNICI: CLEAN"], "12345678")
        assert "500 000 EUR" not in result["finalVerdict"]
        assert "sociálna poisťovňa" not in result["finalVerdict"]
        # Druhá veta zostáva
        assert "Iné riziká" in result["finalVerdict"]

    def test_clean_registry_no_amount_no_change(self):
        """CLEAN register ale bez EUR sumy v texte — žiadna zmena."""
        payload = {
            "finalVerdict": "Firma má dlh voči sociálna poisťovňa.",
            "executiveSummary": "",
            "keyRisk": "",
        }
        result = _strip_hallucinated_debts(payload, ["SP_DLZNICI: CLEAN"], "12345678")
        assert result["finalVerdict"] == payload["finalVerdict"]

    def test_justification_sanitized(self):
        """Justification (JSON array) s halucinovaným dlhom sa sanitizuje."""
        items = [
            {
                "claim": "Dlh voči Dôvera poisťovni",
                "evidence": "Dôvera hlási dlh 160 000 €",
                "impact": "CRITICAL",
            }
        ]
        payload = {
            "finalVerdict": "",
            "executiveSummary": "",
            "keyRisk": "",
            "justification": json.dumps(items, ensure_ascii=False),
        }
        result = _strip_hallucinated_debts(payload, ["DOVERA_DLZNICI: CLEAN"], "12345678")
        parsed = json.loads(result["justification"])
        assert parsed[0]["impact"] == "NEUTRAL"
        assert "neobsahujú záznam" in parsed[0]["evidence"]

    def test_eur_symbol_variants_detected(self):
        """Rôzne formáty EUR sumy sa detegujú."""
        for amount_str in ["500 000 EUR", "500000 €", "500 000,50 Eur"]:
            payload = {
                "finalVerdict": f"Firma má dlh {amount_str} voči sociálna poisťovňa. Zvyšok je OK.",
                "executiveSummary": "",
                "keyRisk": "",
            }
            result = _strip_hallucinated_debts(payload, ["SP_DLZNICI: CLEAN"], "12345678")
            assert amount_str not in result["finalVerdict"], f"Failed for: {amount_str}"

    def test_multiple_clean_registries(self):
        """Viaceré CLEAN registre — všetky sa kontrolujú."""
        payload = {
            "finalVerdict": "Dlh 100 000 EUR voči sociálna poisťovňa. Dlh 50 000 € voči dôvera. Zisk je kladný.",
            "executiveSummary": "",
            "keyRisk": "",
        }
        result = _strip_hallucinated_debts(
            payload,
            ["SP_DLZNICI: CLEAN", "DOVERA_DLZNICI: CLEAN"],
            "12345678",
        )
        assert "100 000 EUR" not in result["finalVerdict"]
        assert "50 000 €" not in result["finalVerdict"]
        assert "Zisk je kladný" in result["finalVerdict"]


# ═══════════════════════════════════════════════════════════════════════════
# _build_fallback_verdict
# ═══════════════════════════════════════════════════════════════════════════

class TestBuildFallbackVerdict:
    def test_normal_fallback(self):
        """Bez hard_stop — normálny fallback verdikt."""
        scorecard = ScorecardResult(
            total_score=65,
            risk_category="A",
            hard_stop=False,
            pillars=[
                ScorecardPillar(name="Platobná schopnosť", score=20, max_score=30, detail="OK", flags=[]),
            ],
        )
        verdict = _build_fallback_verdict({"ico": "12345678"}, scorecard, "sk")
        assert verdict.verifa_score == 65
        assert verdict.risk_category == "A"
        assert verdict.llm_analysis_status == "FALLBACK_ALGORITHMIC"
        assert "HARD STOP" not in verdict.final_verdict

    def test_hard_stop_fallback(self):
        """Hard stop (konkurz) — fallback verdikt s HARD STOP správou."""
        scorecard = ScorecardResult(
            total_score=0,
            risk_category="C",
            hard_stop=True,
            pillars=[],
        )
        verdict = _build_fallback_verdict({"ico": "12345678"}, scorecard, "sk")
        assert verdict.verifa_score == 0
        assert verdict.risk_category == "C"
        assert "HARD STOP" in verdict.final_verdict or "HARD" in verdict.final_verdict
        # Hard stop evidence item
        critical_items = [e for e in verdict.zdovodnenie if e.impact == "CRITICAL"]
        assert len(critical_items) >= 1

    def test_no_scorecard(self):
        """Bez scorecardu — skóre 0, INSUFFICIENT_DATA."""
        verdict = _build_fallback_verdict({"ico": "12345678"}, None, "sk")
        assert verdict.verifa_score == 0
        assert verdict.risk_category == "INSUFFICIENT_DATA"

    def test_english_language(self):
        """EN jazyk — použijú sa EN i18n strings."""
        scorecard = ScorecardResult(
            total_score=50,
            risk_category="B",
            hard_stop=False,
            pillars=[],
        )
        verdict = _build_fallback_verdict({"ico": "12345678"}, scorecard, "en")
        assert verdict.verifa_score == 50
        assert verdict.risk_category == "B"


# ═══════════════════════════════════════════════════════════════════════════
# _remaining_eta
# ═══════════════════════════════════════════════════════════════════════════

class TestRemainingEta:
    def test_fresh_start_returns_baseline(self):
        """Na začiatku vráti baseline (elapsed ≈ 0)."""
        t_start = time.perf_counter()
        eta = _remaining_eta(t_start, baseline=120)
        assert 115 <= eta <= 120  # malý tolerance pre execution time

    def test_elapsed_time_subtracted(self):
        """Po uplynutí času sa ETA znižuje."""
        # Simulujeme uplynutie 10 sekúnd pomocou mock času
        t_start = time.perf_counter() - 10
        eta = _remaining_eta(t_start, baseline=120)
        assert 105 <= eta <= 115

    def test_minimum_5_seconds(self):
        """ETA nikdy neklesne pod 5 sekúnd."""
        t_start = time.perf_counter() - 1000
        eta = _remaining_eta(t_start, baseline=120)
        assert eta == 5

    def test_zero_baseline(self):
        """Baseline 0 — vždy vráti 5 (minimum)."""
        t_start = time.perf_counter()
        eta = _remaining_eta(t_start, baseline=0)
        assert eta == 5


# ═══════════════════════════════════════════════════════════════════════════
# _apply_orsr_override — ORSR Management Anomaly override
# ═══════════════════════════════════════════════════════════════════════════

class TestApplyOrsrOverride:
    """Testuje ORSR override logiku — ak LLM dismissne mgmt anomaly risk,
    refundujeme ORSR penalizáciu z deterministic_score."""

    def _scorecard_with_orsr_penalty(self, penalty: int = -15):
        """Vytvorí scorecard s ORSR pilierom ktorý má negatívne skóre."""
        return ScorecardResult(
            total_score=50,
            risk_category="B",
            hard_stop=False,
            pillars=[
                ScorecardPillar(name="Platobná schopnosť", score=20, max_score=30, detail="OK", flags=[]),
                ScorecardPillar(name="ORSR Management Anomaly", score=penalty, max_score=0, detail="Anomália v štruktúre vedenia", flags=[]),
            ],
        )

    def test_wh_dismissed_refunds_orsr_penalty(self):
        """Ak wh_dismissed=True a ORSR pilier má negatívne skóre, refunduje sa."""
        scorecard = self._scorecard_with_orsr_penalty(penalty=-15)
        wh_refund, new_score = _apply_orsr_override(True, scorecard, 50, "12345678")
        assert wh_refund == 15
        assert new_score == 65  # 50 + 15

    def test_wh_not_dismissed_no_refund(self):
        """Ak wh_dismissed=False, žiadny refund."""
        scorecard = self._scorecard_with_orsr_penalty(penalty=-15)
        wh_refund, new_score = _apply_orsr_override(False, scorecard, 50, "12345678")
        assert wh_refund == 0
        assert new_score == 50

    def test_no_orsr_pillar_no_refund(self):
        """Ak neexistuje ORSR pilier, žiadny refund aj keď wh_dismissed=True."""
        scorecard = ScorecardResult(
            total_score=50,
            risk_category="B",
            hard_stop=False,
            pillars=[
                ScorecardPillar(name="Platobná schopnosť", score=20, max_score=30, detail="OK", flags=[]),
            ],
        )
        wh_refund, new_score = _apply_orsr_override(True, scorecard, 50, "12345678")
        assert wh_refund == 0
        assert new_score == 50

    def test_orsr_pillar_positive_no_refund(self):
        """Ak ORSR pilier má pozitívne skóre (žiadna penalizácia), žiadny refund."""
        scorecard = ScorecardResult(
            total_score=50,
            risk_category="B",
            hard_stop=False,
            pillars=[
                ScorecardPillar(name="ORSR Management Anomaly", score=5, max_score=10, detail="OK", flags=[]),
            ],
        )
        wh_refund, new_score = _apply_orsr_override(True, scorecard, 50, "12345678")
        assert wh_refund == 0
        assert new_score == 50

    def test_score_capped_at_100(self):
        """Ak by refund presiahol 100, skóre sa capne na 100."""
        scorecard = self._scorecard_with_orsr_penalty(penalty=-30)
        wh_refund, new_score = _apply_orsr_override(True, scorecard, 85, "12345678")
        assert wh_refund == 30
        assert new_score == 100  # 85 + 30 = 115, cap na 100

    def test_no_scorecard_no_refund(self):
        """Ak scorecard je None, žiadny refund."""
        wh_refund, new_score = _apply_orsr_override(True, None, 50, "12345678")
        assert wh_refund == 0
        assert new_score == 50

    def test_multiple_orsr_pillars_all_refunded(self):
        """Ak existuje viacero ORSR pilierov s negatívnym skóre, refundujú sa všetky."""
        scorecard = ScorecardResult(
            total_score=40,
            risk_category="B",
            hard_stop=False,
            pillars=[
                ScorecardPillar(name="ORSR Anomaly 1", score=-10, max_score=0, detail="A", flags=[]),
                ScorecardPillar(name="ORSR Anomaly 2", score=-5, max_score=0, detail="B", flags=[]),
            ],
        )
        wh_refund, new_score = _apply_orsr_override(True, scorecard, 40, "12345678")
        assert wh_refund == 15  # 10 + 5
        assert new_score == 55  # 40 + 15


# ═══════════════════════════════════════════════════════════════════════════
# _strip_hallucinated_debts — integračné testy s rôznymi registrami
# ═══════════════════════════════════════════════════════════════════════════

class TestStripHallucinatedDebtsIntegration:
    """Integračné testy pre anti-hallucináciu naprieč rôznymi registrami."""

    def test_financna_sprava_clean_strips_tax_debt(self):
        """FINANCNA_SPRAVA CLEAN + daňový dlh v texte → odstráni."""
        payload = {
            "finalVerdict": "Firma má daňové nedoplatky 500 000 EUR voči finančná správa. Zisk je kladný.",
            "executiveSummary": "",
            "keyRisk": "",
        }
        result = _strip_hallucinated_debts(payload, ["FINANCNA_SPRAVA: CLEAN"], "12345678")
        assert "500 000 EUR" not in result["finalVerdict"]
        assert "finančná správa" not in result["finalVerdict"].lower()
        assert "Zisk je kladný" in result["finalVerdict"]

    def test_dovera_clean_strips_insurance_debt(self):
        """DOVERA_DLZNICI CLEAN + Dôvera dlh v texte → odstráni."""
        payload = {
            "finalVerdict": "Dlh 160 000 € voči dôvera poisťovni. Firma je stabilná.",
            "executiveSummary": "",
            "keyRisk": "",
        }
        result = _strip_hallucinated_debts(payload, ["DOVERA_DLZNICI: CLEAN"], "12345678")
        assert "160 000 €" not in result["finalVerdict"]
        assert "dôvera" not in result["finalVerdict"].lower()
        assert "Firma je stabilná" in result["finalVerdict"]

    def test_vszp_clean_strips_debt(self):
        """VšZP CLEAN + VšZP dlh v texte → odstráni."""
        payload = {
            "finalVerdict": "Dlh 80 000 EUR voči všzp. Firma je zisková.",
            "executiveSummary": "",
            "keyRisk": "",
        }
        result = _strip_hallucinated_debts(payload, ["VSZP_DLZNICI: CLEAN"], "12345678")
        assert "80 000 EUR" not in result["finalVerdict"]
        assert "všzp" not in result["finalVerdict"].lower()

    def test_poverenia_clean_strips_execution_debt(self):
        """POVERENIA CLEAN + exekúcia s sumou v texte → odstráni."""
        payload = {
            "finalVerdict": "Exekúcia v hodnote 25 000 € voči firme. Firma je zisková.",
            "executiveSummary": "",
            "keyRisk": "",
        }
        result = _strip_hallucinated_debts(payload, ["POVERENIA: CLEAN"], "12345678")
        assert "25 000 €" not in result["finalVerdict"]
        assert "Exekúcia" not in result["finalVerdict"]

    def test_has_debt_registry_not_stripped(self):
        """Ak register má HAS_DEBT (nie CLEAN), text sa nemení."""
        payload = {
            "finalVerdict": "Dlh 500 000 EUR voči sociálna poisťovňa. Firma je stabilná.",
            "executiveSummary": "",
            "keyRisk": "",
        }
        result = _strip_hallucinated_debts(payload, ["SP_DLZNICI: HAS_DEBT"], "12345678")
        assert result["finalVerdict"] == payload["finalVerdict"]

    def test_mixed_clean_and_has_debt(self):
        """Zmix CLEAN a HAS_DEBT — len CLEAN registre sa strippujú."""
        payload = {
            "finalVerdict": "Dlh 100 000 EUR voči sociálna poisťovňa. Dlh 50 000 € voči dôvera. Zisk.",
            "executiveSummary": "",
            "keyRisk": "",
        }
        result = _strip_hallucinated_debts(
            payload,
            ["SP_DLZNICI: HAS_DEBT", "DOVERA_DLZNICI: CLEAN"],
            "12345678",
        )
        # SP dlh zostáva (HAS_DEBT), Dôvera dlh sa strippuje (CLEAN)
        assert "100 000 EUR" in result["finalVerdict"]
        assert "50 000 €" not in result["finalVerdict"]
        assert "Zisk" in result["finalVerdict"]

    def test_no_eur_amount_no_stripping(self):
        """CLEAN register ale bez EUR sumy v texte — žiadna zmena."""
        payload = {
            "finalVerdict": "Firma má dlh voči finančná správa. Zisk je kladný.",
            "executiveSummary": "",
            "keyRisk": "",
        }
        result = _strip_hallucinated_debts(payload, ["FINANCNA_SPRAVA: CLEAN"], "12345678")
        assert result["finalVerdict"] == payload["finalVerdict"]

    def test_eur_amount_far_from_keyword_not_stripped(self):
        """EUR suma viac ako 200 znakov od keywordu — nesedí window, nemá strippovať."""
        # "finančná správa" na začiatku, EUR suma > 200 znakov ďalej
        padding = "x" * 250
        payload = {
            "finalVerdict": f"finančná správa je čistá. {padding} Dlh 500 000 EUR inde.",
            "executiveSummary": "",
            "keyRisk": "",
        }
        result = _strip_hallucinated_debts(payload, ["FINANCNA_SPRAVA: CLEAN"], "12345678")
        # EUR suma je príliš ďaleko od keywordu — nemá byť strippnutá
        assert "500 000 EUR" in result["finalVerdict"]

    def test_justification_evidence_item_sanitized(self):
        """Justification (JSON array) s halucinovaným dlhom sa sanitizuje."""
        items = [
            {
                "claim": "Dlh voči Dôvera poisťovni",
                "evidence": "Dôvera hlási dlh 160 000 €",
                "impact": "CRITICAL",
                "source": "Dôvera register",
            }
        ]
        payload = {
            "finalVerdict": "",
            "executiveSummary": "",
            "keyRisk": "",
            "justification": json.dumps(items, ensure_ascii=False),
        }
        result = _strip_hallucinated_debts(payload, ["DOVERA_DLZNICI: CLEAN"], "12345678")
        parsed = json.loads(result["justification"])
        assert parsed[0]["impact"] == "NEUTRAL"
        assert "neobsahujú záznam" in parsed[0]["evidence"].lower() or "halucin" in parsed[0]["evidence"].lower()

    def test_executive_summary_also_stripped(self):
        """Executive summary sa tiež strippuje."""
        payload = {
            "finalVerdict": "",
            "executiveSummary": "Dlh 200 000 EUR voči sociálna poisťovňa je problém. Zisk je kladný.",
            "keyRisk": "",
        }
        result = _strip_hallucinated_debts(payload, ["SP_DLZNICI: CLEAN"], "12345678")
        assert "200 000 EUR" not in result["executiveSummary"]
        assert "Zisk je kladný" in result["executiveSummary"]

    def test_key_risk_also_stripped(self):
        """Key risk sa tiež strippuje."""
        payload = {
            "finalVerdict": "",
            "executiveSummary": "",
            "keyRisk": "Riziko: dlh 300 000 EUR voči sociálna poisťovňa.",
        }
        result = _strip_hallucinated_debts(payload, ["SP_DLZNICI: CLEAN"], "12345678")
        assert "300 000 EUR" not in result["keyRisk"]


# ── Grounding Filter: forensicRedFlags anti-hallucination ──────────────────

class TestGroundingFilter:
    """
    Test deterministického filtra, ktorý odstraňuje halucinované forensicRedFlags
    z naratívu, ak notesRisk neobsahuje relatedPartyTransactions.
    Toto je Layer 3 v Swiss cheese anti-hallucination defense.
    """

    def _build_narrative_by_year(self, flags):
        """Konštruuje narrative_by_year dict s forensicRedFlags."""
        return [{"rok": 2023, "narrativeRisk": {"forensicRedFlags": flags}}]

    def _build_notes_by_year(self, related_party=None):
        """Konštruuje notes_by_year dict."""
        return [{"rok": 2023, "notesRisk": {"relatedPartyTransactions": related_party}}]

    def test_strips_related_party_flags_when_notes_empty(self):
        """Ak notesRisk nemá relatedPartyTransactions, flagy o spriaznených osobách sa odstránia."""
        import re
        narrative_by_year = self._build_narrative_by_year([
            "signifikantné transakcie so spriaznenými osobami",
            "opakované oneskorené platby dodávateľom",
            "presun majetku na dcérske spoločnosti",
        ])
        notes_by_year = self._build_notes_by_year(related_party=None)

        _has_rp = any(
            _nr.get("notesRisk", {}).get("relatedPartyTransactions")
            for _nr in notes_by_year
        )
        assert not _has_rp

        _RP_PATTERNS = [
            re.compile(r'spriaznen', re.IGNORECASE),
            re.compile(r'related\s*part', re.IGNORECASE),
            re.compile(r'presun\s*majetk', re.IGNORECASE),
            re.compile(r'asset\s*transfer', re.IGNORECASE),
            re.compile(r'dcérs', re.IGNORECASE),
            re.compile(r'subsidiar', re.IGNORECASE),
            re.compile(r'odtok\s*kapit', re.IGNORECASE),
            re.compile(r'capital\s*extract', re.IGNORECASE),
        ]

        removed = 0
        for entry in narrative_by_year:
            nr = entry.get("narrativeRisk", {})
            flags = nr.get("forensicRedFlags")
            if flags and isinstance(flags, list):
                filtered = []
                for flag in flags:
                    if isinstance(flag, str) and any(p.search(flag) for p in _RP_PATTERNS):
                        removed += 1
                    else:
                        filtered.append(flag)
                nr["forensicRedFlags"] = filtered

        assert removed == 2  # "spriaznen" and "dcérske" flags removed
        remaining = narrative_by_year[0]["narrativeRisk"]["forensicRedFlags"]
        assert len(remaining) == 1
        assert "oneskorené platby" in remaining[0]

    def test_keeps_all_flags_when_notes_has_related_party(self):
        """Ak notesRisk má relatedPartyTransactions, flagy sa NEodstraňujú."""
        import re
        narrative_by_year = self._build_narrative_by_year([
            "transakcie so spriaznenými osobami",
            "presun majetku na dcérske spoločnosti",
        ])
        notes_by_year = self._build_notes_by_year(related_party="Pôžička dcérskej spoločnosti 500k EUR")

        _has_rp = any(
            _nr.get("notesRisk", {}).get("relatedPartyTransactions")
            for _nr in notes_by_year
        )
        assert _has_rp  # Filter sa neaplikuje

    def test_strips_english_flags(self):
        """Filter funguje aj pre anglické flagy."""
        import re
        narrative_by_year = self._build_narrative_by_year([
            "significant related party transactions detected",
            "ongoing asset transfers to subsidiaries",
            "dependency on single customer",
        ])
        notes_by_year = self._build_notes_by_year(related_party=None)

        _RP_PATTERNS = [
            re.compile(r'spriaznen', re.IGNORECASE),
            re.compile(r'related\s*part', re.IGNORECASE),
            re.compile(r'presun\s*majetk', re.IGNORECASE),
            re.compile(r'asset\s*transfer', re.IGNORECASE),
            re.compile(r'dcérs', re.IGNORECASE),
            re.compile(r'subsidiar', re.IGNORECASE),
            re.compile(r'odtok\s*kapit', re.IGNORECASE),
            re.compile(r'capital\s*extract', re.IGNORECASE),
        ]

        removed = 0
        for entry in narrative_by_year:
            nr = entry.get("narrativeRisk", {})
            flags = nr.get("forensicRedFlags")
            if flags and isinstance(flags, list):
                filtered = []
                for flag in flags:
                    if isinstance(flag, str) and any(p.search(flag) for p in _RP_PATTERNS):
                        removed += 1
                    else:
                        filtered.append(flag)
                nr["forensicRedFlags"] = filtered

        assert removed == 2  # "related part" and "asset transfer" + "subsidiaries"
        remaining = narrative_by_year[0]["narrativeRisk"]["forensicRedFlags"]
        assert len(remaining) == 1
        assert "single customer" in remaining[0]

    def test_empty_flags_list_unchanged(self):
        """Prázdny zoznam flagov sa nemení."""
        narrative_by_year = self._build_narrative_by_year([])
        notes_by_year = self._build_notes_by_year(related_party=None)

        # Filter by nemal spadnúť na prázdny zoznam
        for entry in narrative_by_year:
            nr = entry.get("narrativeRisk", {})
            flags = nr.get("forensicRedFlags")
            assert flags == []


# ── _apply_balance_sheet_fallbacks ──────────────────────────────────────────────

class TestApplyBalanceSheetFallbacks:
    """Testy pre fallback výpočty chýbajúcich súvahových položiek."""

    def test_equity_from_basic_liabilities(self):
        """vlastne_imanie = celkove_aktiva - (kratkodobe + dlhodobe zavazky)."""
        m = _metrics(2024,
            celkove_aktiva=1_000_000,
            kratkodobe_zavazky=300_000,
            dlhodobe_zavazky=200_000,
        )
        _apply_balance_sheet_fallbacks(m)
        assert m.vlastne_imanie_celkom == 500_000

    def test_equity_includes_lt_reserves(self):
        """Fallback zahŕňa dlhodobé rezervy do pasív."""
        m = _metrics(2024,
            celkove_aktiva=1_000_000,
            kratkodobe_zavazky=300_000,
            dlhodobe_zavazky=200_000,
            dlhodobe_rezervy=100_000,
        )
        _apply_balance_sheet_fallbacks(m)
        # equity = 1M - (300k + 200k + 100k) = 400k
        assert m.vlastne_imanie_celkom == 400_000

    def test_equity_includes_st_reserves(self):
        """Fallback zahŕňa krátkodobé rezervy do pasív."""
        m = _metrics(2024,
            celkove_aktiva=1_000_000,
            kratkodobe_zavazky=300_000,
            dlhodobe_zavazky=200_000,
            kratkodobe_rezervy=50_000,
        )
        _apply_balance_sheet_fallbacks(m)
        # equity = 1M - (300k + 200k + 50k) = 450k
        assert m.vlastne_imanie_celkom == 450_000

    def test_equity_includes_bank_loans(self):
        """Fallback zahŕňa bežné bankové úvery do pasív."""
        m = _metrics(2024,
            celkove_aktiva=1_000_000,
            kratkodobe_zavazky=300_000,
            dlhodobe_zavazky=200_000,
            bezne_bankove_uvery=150_000,
        )
        _apply_balance_sheet_fallbacks(m)
        # equity = 1M - (300k + 200k + 150k) = 350k
        assert m.vlastne_imanie_celkom == 350_000

    def test_equity_includes_all_extra_liabilities(self):
        """Fallback zahŕňa rezervy + úvery naraz."""
        m = _metrics(2024,
            celkove_aktiva=1_000_000,
            kratkodobe_zavazky=300_000,
            dlhodobe_zavazky=200_000,
            dlhodobe_rezervy=100_000,
            kratkodobe_rezervy=50_000,
            bezne_bankove_uvery=150_000,
        )
        _apply_balance_sheet_fallbacks(m)
        # equity = 1M - (300k + 200k + 100k + 50k + 150k) = 200k
        assert m.vlastne_imanie_celkom == 200_000

    def test_equity_skipped_when_negative(self):
        """Ak by bolo vlastne_imanie záporné, fallback sa preskočí."""
        m = _metrics(2024,
            celkove_aktiva=100_000,
            kratkodobe_zavazky=300_000,
            dlhodobe_zavazky=200_000,
        )
        _apply_balance_sheet_fallbacks(m)
        # 100k - 500k = -400k → preskočiť
        assert m.vlastne_imanie_celkom is None

    def test_equity_not_overwritten_when_present(self):
        """Ak vlastne_imanie už existuje, fallback ho neprepíše."""
        m = _metrics(2024,
            celkove_aktiva=1_000_000,
            vlastne_imanie_celkom=600_000,
            kratkodobe_zavazky=300_000,
            dlhodobe_zavazky=200_000,
        )
        _apply_balance_sheet_fallbacks(m)
        assert m.vlastne_imanie_celkom == 600_000

    def test_equity_skipped_when_low_confidence(self):
        """Ak je vlastne_imanie v low_confidence_fields, fallback sa neaplikuje."""
        m = _metrics(2024,
            celkove_aktiva=1_000_000,
            kratkodobe_zavazky=300_000,
            dlhodobe_zavazky=200_000,
        )
        _apply_balance_sheet_fallbacks(m, low_confidence_fields={"vlastne_imanie_celkom"})
        assert m.vlastne_imanie_celkom is None

    def test_obezny_majetok_from_subitems(self):
        """obezny_majetok sa vypočíta zo zásob + pohľadávok + hotovosti (>= 2 sub-items)."""
        m = _metrics(2024,
            zasoby=100_000,
            pohladavky_z_obchodneho_styku=200_000,
            peniaze_a_penazne_ekvivalenty_k_31_12=50_000,
        )
        _apply_balance_sheet_fallbacks(m)
        assert m.obezny_majetok == 350_000

    def test_obezny_majetok_skipped_with_one_subitem(self):
        """Ak je len 1 sub-item, obezny_majetok sa nevypočíta."""
        m = _metrics(2024,
            zasoby=100_000,
        )
        _apply_balance_sheet_fallbacks(m)
        assert m.obezny_majetok is None

    def test_celkove_aktiva_from_obezny(self):
        """celkove_aktiva sa aproximuje z obezny_majetok keď chýba."""
        m = _metrics(2024,
            obezny_majetok=500_000,
        )
        _apply_balance_sheet_fallbacks(m)
        assert m.celkove_aktiva == 500_000

    def test_celkove_aktiva_skipped_when_low_confidence(self):
        """Ak je celkove_aktiva v low_confidence_fields, fallback sa neaplikuje."""
        m = _metrics(2024,
            obezny_majetok=500_000,
        )
        _apply_balance_sheet_fallbacks(m, low_confidence_fields={"celkove_aktiva"})
        assert m.celkove_aktiva is None

    def test_no_fallback_when_assets_missing(self):
        """Ak chýba celkove_aktiva aj obezny_majetok, equity fallback sa neaplikuje."""
        m = _metrics(2024,
            kratkodobe_zavazky=300_000,
            dlhodobe_zavazky=200_000,
        )
        _apply_balance_sheet_fallbacks(m)
        assert m.vlastne_imanie_celkom is None
