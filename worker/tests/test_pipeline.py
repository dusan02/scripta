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
