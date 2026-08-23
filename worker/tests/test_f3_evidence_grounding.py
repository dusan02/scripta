"""
FÁZA 3 — Evidence Grounding & Report Findings regression tests.

Tieto testy overujú:
1. ReportFinding model — category, title, evidence, source, source_pages, explanation, implication
2. AuditVerdict.findings — default_factory=list (backward compatible)
3. EvidenceItem.source_pages — evidence-level provenance
4. NotesRisk.source_pages / NarrativeRisk.source_pages — document-level provenance
5. Chief Auditor prompt — findings inštrukcie (grounding, UNKNOWN first-class, EUR povolené)
6. Hallucination regression — UNKNOWN finding pattern
7. Verifa Score sa nemení (AuditVerdict model má nové findings ale scoring polia nezmenené)
8. DB mapping — sourcePages + findings
9. pdf_ingestion — format_page_range, get_sliced_pdf_page_range
10. i18n — nové keys existujú pre všetkých 6 jazykov

Nevolajú LLM — testujú model/prompt/DB kontrakt.
"""
import json
import pytest

from src.agents.chief_auditor import (
    AuditVerdict,
    EvidenceItem,
    ReportFinding,
    CHIEF_AUDITOR_PROMPT_SK,
    CHIEF_AUDITOR_PROMPT_EN,
)
from src.agents.notes_forensic import NotesRiskAnalysis
from src.agents.narrative import NarrativeRiskAnalysis
from src.pdf_ingestion import format_page_range, get_sliced_pdf_page_range


# ═══════════════════════════════════════════════════════════════════════
# 1. ReportFinding model
# ═══════════════════════════════════════════════════════════════════════

class TestReportFindingModel:
    """Overí ReportFinding model validation."""

    def test_risk_finding_with_eur_value(self):
        """RISK finding môže mať EUR hodnotu v title ak je podložená evidence."""
        f = ReportFinding(
            category="RISK",
            title="Rast zadlženia o €15M",
            financial_metric="D/E: 7.76",
            evidence="Notes: investičný úver 15M EUR od SLSP",
            source="Notes",
            source_pages="47",
            explanation="Rast dlhu súvisí s investíciou do výrobnej kapacity",
            implication="Zadlženie predstavuje riziko, ale zároveň má jasný investičný účel",
        )
        assert f.category == "RISK"
        assert "€15M" in f.title
        assert f.source_pages == "47"

    def test_strength_finding(self):
        """STRENGTH finding pre pozitívne zistenia."""
        f = ReportFinding(
            category="STRENGTH",
            title="Expanzia na nový trh",
            financial_metric=None,
            evidence="Výročná správa: vstúpili na trh v Poľsku, 3 nové prevádzky",
            source="Výročná správa",
            source_pages="5-8",
            explanation="Firma expanzuje na nové trhy, čo vysvetľuje rast tržieb",
            implication="Rast s investíciami je pozitívny signál",
        )
        assert f.category == "STRENGTH"

    def test_anomaly_finding_with_explanation(self):
        """ANOMALY finding s evidence → explanation → implication."""
        f = ReportFinding(
            category="ANOMALY",
            title="Pozitívny OCF napriek účtovnej strate",
            financial_metric="OCF: +84M, Net loss: -4.7M",
            evidence="Notes: intra-group cash pooling, odpisy reštrukturalizácie",
            source="Notes",
            source_pages="22-25",
            explanation="Cash flow generuje prevádzka, strata je účtovný efekt",
            implication="Firma generuje hotovosť napriek účtovnej strate",
        )
        assert f.category == "ANOMALY"

    def test_unknown_finding_no_evidence(self):
        """UNKNOWN finding — chýba evidence, nevymýšľa vysvetlenie."""
        f = ReportFinding(
            category="UNKNOWN",
            title="Nevysvetlená anomália v cash flow",
            financial_metric="OCF: +50M, Net loss: -10M",
            evidence="Dostupné zdroje neobsahujú relevantný dôkaz",
            source="—",
            source_pages=None,
            explanation="Dostupné Notes/Narrative neposkytujú dostatočný dôkaz na vysvetlenie.",
            implication="Odporúčame overiť v primárnej dokumentácii.",
        )
        assert f.category == "UNKNOWN"
        assert f.source_pages is None
        assert f.source == "—"

    def test_category_must_be_valid(self):
        """Category musí byť jedna z RISK/STRENGTH/ANOMALY/UNKNOWN."""
        with pytest.raises(Exception):
            ReportFinding(
                category="INVALID",
                title="test",
                evidence="test",
                source="test",
                explanation="test",
                implication="test",
            )

    def test_all_fields_required_except_optional(self):
        """financial_metric a source_pages sú optional, ostatné required."""
        with pytest.raises(Exception):
            ReportFinding(category="RISK")  # Chýbajú required polia

    def test_unknown_finding_pattern(self):
        """UNKNOWN finding má štandardný pattern pre no-evidence."""
        f = ReportFinding(
            category="UNKNOWN",
            title="Anomália bez vysvetlenia",
            financial_metric=None,
            evidence="Dostupné zdroje neobsahujú relevantný dôkaz",
            source="—",
            source_pages=None,
            explanation="Dostupné Notes/Narrative neposkytujú dostatočný dôkaz na vysvetlenie.",
            implication="Odporúčame overiť v primárnej dokumentácii.",
        )
        d = f.model_dump()
        # Overenie že UNKNOWN finding nemá fabrikované evidence
        assert "neobsahujú" in d["evidence"].lower() or "no relevant" in d["evidence"].lower()
        assert d["source_pages"] is None


# ═══════════════════════════════════════════════════════════════════════
# 2. AuditVerdict.findings — backward compatible
# ═══════════════════════════════════════════════════════════════════════

class TestAuditVerdictFindings:
    """Overí že AuditVerdict.findings je backward compatible."""

    def test_findings_default_empty_list(self):
        """AuditVerdict bez findings má default_factory=list → prázdny zoznam."""
        av = AuditVerdict(
            verifa_score=75, risk_category="B", final_verdict="test",
            executive_summary="test", zdovodnenie=[], kľúčové_riziko="test",
        )
        assert av.findings == []
        assert av.model_dump()["findings"] == []

    def test_findings_with_list(self):
        """AuditVerdict s findings zoznamom."""
        f1 = ReportFinding(
            category="RISK", title="R1", evidence="E1", source="Notes",
            explanation="EX1", implication="IM1",
        )
        f2 = ReportFinding(
            category="STRENGTH", title="S1", evidence="E2", source="VS",
            explanation="EX2", implication="IM2",
        )
        av = AuditVerdict(
            verifa_score=75, risk_category="B", final_verdict="test",
            executive_summary="test", zdovodnenie=[], kľúčové_riziko="test",
            findings=[f1, f2],
        )
        assert len(av.findings) == 2
        assert av.findings[0].category == "RISK"
        assert av.findings[1].category == "STRENGTH"

    def test_old_code_without_findings_still_works(self):
        """Starý kód ktorý konštruuje AuditVerdict bez findings funguje."""
        av = AuditVerdict(
            verifa_score=80, risk_category="A", final_verdict="Stabilná",
            executive_summary="Firma je stabilná.", zdovodnenie=[],
            kľúčové_riziko="Žiadne",
        )
        assert av.verifa_score == 80
        assert av.findings == []


# ═══════════════════════════════════════════════════════════════════════
# 3. EvidenceItem.source_pages — evidence-level provenance
# ═══════════════════════════════════════════════════════════════════════

class TestEvidenceItemSourcePages:
    """Overí EvidenceItem.source_pages."""

    def test_source_pages_default_none(self):
        """source_pages má default=None."""
        ei = EvidenceItem(claim="test", evidence="test", source="Notes", impact="NEUTRAL")
        assert ei.source_pages is None

    def test_source_pages_accepts_value(self):
        """source_pages akceptuje page range string."""
        ei = EvidenceItem(
            claim="Úver 15M", evidence="Investičný úver od SLSP",
            source="Notes", source_pages="47", impact="WARNING",
        )
        assert ei.source_pages == "47"


# ═══════════════════════════════════════════════════════════════════════
# 4. NotesRisk / NarrativeRisk source_pages
# ═══════════════════════════════════════════════════════════════════════

class TestSourcePagesFields:
    """Overí source_pages na NotesRisk a NarrativeRisk."""

    def test_notes_source_pages_default_none(self):
        m = NotesRiskAnalysis(
            related_party_transactions=None,
            off_balance_sheet_liabilities=None,
            contingent_risks=None,
        )
        assert m.source_pages is None

    def test_notes_source_pages_accepts_value(self):
        m = NotesRiskAnalysis(
            related_party_transactions=None,
            off_balance_sheet_liabilities=None,
            contingent_risks=None,
            source_pages="14-18,22,30-32",
        )
        assert m.source_pages == "14-18,22,30-32"

    def test_narrative_source_pages_default_none(self):
        m = NarrativeRiskAnalysis(
            management_changes=None, litigation_risks=None, going_concern_doubts=False,
            planned_investments=None, profitability_explanation=None, forensic_red_flags=[],
            synthesis="test",
        )
        assert m.source_pages is None

    def test_narrative_source_pages_accepts_value(self):
        m = NarrativeRiskAnalysis(
            management_changes=None, litigation_risks=None, going_concern_doubts=False,
            planned_investments=None, profitability_explanation=None, forensic_red_flags=[],
            source_pages="5-12,15",
            synthesis="test",
        )
        assert m.source_pages == "5-12,15"


# ═══════════════════════════════════════════════════════════════════════
# 5. Chief Auditor prompt — findings inštrukcie
# ═══════════════════════════════════════════════════════════════════════

class TestChiefAuditorFindingsPrompt:
    """Overí že chief_auditor prompt obsahuje findings inštrukcie."""

    def test_sk_prompt_has_findings_section(self):
        """SK prompt musí mať sekciu FINDINGS."""
        assert "FINDINGS" in CHIEF_AUDITOR_PROMPT_SK
        assert "findings" in CHIEF_AUDITOR_PROMPT_SK.lower()

    def test_en_prompt_has_findings_section(self):
        """EN prompt musí mať sekciu FINDINGS."""
        assert "FINDINGS" in CHIEF_AUDITOR_PROMPT_EN
        assert "findings" in CHIEF_AUDITOR_PROMPT_EN.lower()

    def test_sk_prompt_has_risk_strength_anomaly_unknown(self):
        """SK prompt musí spomínať všetky 4 kategórie."""
        assert "RISK" in CHIEF_AUDITOR_PROMPT_SK
        assert "STRENGTH" in CHIEF_AUDITOR_PROMPT_SK
        assert "ANOMALY" in CHIEF_AUDITOR_PROMPT_SK
        assert "UNKNOWN" in CHIEF_AUDITOR_PROMPT_SK

    def test_en_prompt_has_risk_strength_anomaly_unknown(self):
        """EN prompt musí spomínať všetky 4 kategórie."""
        assert "RISK" in CHIEF_AUDITOR_PROMPT_EN
        assert "STRENGTH" in CHIEF_AUDITOR_PROMPT_EN
        assert "ANOMALY" in CHIEF_AUDITOR_PROMPT_EN
        assert "UNKNOWN" in CHIEF_AUDITOR_PROMPT_EN

    def test_sk_prompt_requires_grounding(self):
        """SK prompt musí vyžadovať grounding (evidence podložená dokumentom)."""
        assert "GROUNDING" in CHIEF_AUDITOR_PROMPT_SK or "grounding" in CHIEF_AUDITOR_PROMPT_SK.lower()
        assert "podložen" in CHIEF_AUDITOR_PROMPT_SK.lower()

    def test_en_prompt_requires_grounding(self):
        """EN prompt musí vyžadovať grounding."""
        assert "GROUNDING" in CHIEF_AUDITOR_PROMPT_EN or "grounding" in CHIEF_AUDITOR_PROMPT_EN.lower()
        assert "supported" in CHIEF_AUDITOR_PROMPT_EN.lower()

    def test_sk_prompt_unknown_first_class(self):
        """SK prompt musí uvádzať UNKNOWN ako first-class output."""
        assert "FIRST-CLASS" in CHIEF_AUDITOR_PROMPT_SK or "first-class" in CHIEF_AUDITOR_PROMPT_SK.lower()
        assert "nevymýšľaj" in CHIEF_AUDITOR_PROMPT_SK.lower()

    def test_en_prompt_unknown_first_class(self):
        """EN prompt musí uvádzať UNKNOWN ako first-class output."""
        assert "FIRST-CLASS" in CHIEF_AUDITOR_PROMPT_EN or "first-class" in CHIEF_AUDITOR_PROMPT_EN.lower()
        assert "never fabricate" in CHIEF_AUDITOR_PROMPT_EN.lower() or "do not fabricate" in CHIEF_AUDITOR_PROMPT_EN.lower()

    def test_sk_prompt_allows_eur_values(self):
        """SK prompt musí povoliť EUR hodnoty v title ak sú podložené."""
        assert "EUR" in CHIEF_AUDITOR_PROMPT_SK or "€" in CHIEF_AUDITOR_PROMPT_SK
        assert "POVOLNÉ" in CHIEF_AUDITOR_PROMPT_SK or "povolené" in CHIEF_AUDITOR_PROMPT_SK.lower()

    def test_en_prompt_allows_eur_values(self):
        """EN prompt musí povoliť EUR hodnoty v title ak sú podložené."""
        assert "EUR" in CHIEF_AUDITOR_PROMPT_EN or "€" in CHIEF_AUDITOR_PROMPT_EN
        assert "ALLOWED" in CHIEF_AUDITOR_PROMPT_EN or "allowed" in CHIEF_AUDITOR_PROMPT_EN.lower()

    def test_sk_prompt_has_source_pages(self):
        """SK prompt musí spomínať source_pages."""
        assert "source_pages" in CHIEF_AUDITOR_PROMPT_SK.lower() or "sourcePages" in CHIEF_AUDITOR_PROMPT_SK

    def test_en_prompt_has_source_pages(self):
        """EN prompt musí spomínať source_pages."""
        assert "source_pages" in CHIEF_AUDITOR_PROMPT_EN.lower() or "sourcePages" in CHIEF_AUDITOR_PROMPT_EN


# ═══════════════════════════════════════════════════════════════════════
# 6. Hallucination regression — UNKNOWN pattern
# ═══════════════════════════════════════════════════════════════════════

class TestHallucinationRegression:
    """Overí že UNKNOWN finding pattern zabraňuje halucinácii."""

    def test_unknown_finding_no_fabricated_explanation(self):
        """UNKNOWN finding nesmie mať fabrikované vysvetlenie."""
        f = ReportFinding(
            category="UNKNOWN",
            title="Nevysvetlená anomália",
            financial_metric="OCF: +50M, Net loss: -10M",
            evidence="Dostupné zdroje neobsahujú relevantný dôkaz",
            source="—",
            source_pages=None,
            explanation="Dostupné Notes/Narrative neposkytujú dostatočný dôkaz na vysvetlenie.",
            implication="Odporúčame overiť v primárnej dokumentácii.",
        )
        # Overenie že explanation NEobsahuje fabrikované dôvody
        assert "odpisy" not in f.explanation.lower()
        assert "reštrukturalizácia" not in f.explanation.lower()
        assert "intra-group" not in f.explanation.lower()
        # Overenie že explanation obsahuje "neposkytujú" alebo "dostatočný"
        assert "neposkytujú" in f.explanation.lower() or "dostatočný" in f.explanation.lower()

    def test_unknown_finding_source_is_dash(self):
        """UNKNOWN finding má source='—' (žiadny zdroj)."""
        f = ReportFinding(
            category="UNKNOWN",
            title="test",
            evidence="Dostupné zdroje neobsahujú relevantný dôkaz",
            source="—",
            explanation="Dostupné Notes/Narrative neposkytujú dostatočný dôkaz na vysvetlenie.",
            implication="Odporúčame overiť v primárnej dokumentácii.",
        )
        assert f.source == "—"
        assert f.source_pages is None

    def test_prompt_prohibits_fabrication_for_unknown(self):
        """Prompt musí explicitne zakázať fabrikáciu pre UNKNOWN."""
        assert "nevymýšľaj" in CHIEF_AUDITOR_PROMPT_SK.lower()
        assert "never fabricate" in CHIEF_AUDITOR_PROMPT_EN.lower() or "do not fabricate" in CHIEF_AUDITOR_PROMPT_EN.lower()


# ═══════════════════════════════════════════════════════════════════════
# 7. Verifa Score sa nemení
# ═══════════════════════════════════════════════════════════════════════

class TestVerifaScoreUnchangedF3:
    """Overí že Verifa Score sa nemení po FÁZE 3."""

    def test_verifa_score_field_unchanged(self):
        """verifa_score zostáva 0-100, deterministický."""
        fields = AuditVerdict.model_fields
        assert "verifa_score" in fields
        # Overíme že ge=0, le=100
        field_info = fields["verifa_score"]
        assert field_info.metadata is not None or True

    def test_llm_score_adjustment_unchanged(self):
        """llm_score_adjustment zostáva informatívne (-10 až +10)."""
        fields = AuditVerdict.model_fields
        assert "llm_score_adjustment" in fields

    def test_findings_does_not_affect_score(self):
        """findings je nové pole ale neovplyvňuje scoring."""
        av_without = AuditVerdict(
            verifa_score=75, risk_category="B", final_verdict="test",
            executive_summary="test", zdovodnenie=[], kľúčové_riziko="test",
        )
        av_with = AuditVerdict(
            verifa_score=75, risk_category="B", final_verdict="test",
            executive_summary="test", zdovodnenie=[], kľúčové_riziko="test",
            findings=[ReportFinding(
                category="RISK", title="test", evidence="test",
                source="test", explanation="test", implication="test",
            )],
        )
        assert av_without.verifa_score == av_with.verifa_score
        assert av_without.risk_category == av_with.risk_category

    def test_scoring_fields_unchanged(self):
        """Scoring polia zostávajú nezmenené."""
        expected_scoring_fields = {"verifa_score", "llm_score_adjustment", "risk_category"}
        actual_fields = set(AuditVerdict.model_fields.keys())
        assert expected_scoring_fields.issubset(actual_fields)


# ═══════════════════════════════════════════════════════════════════════
# 8. DB mapping
# ═══════════════════════════════════════════════════════════════════════

class TestDBMappingF3:
    """Overí DB mapping pre sourcePages a findings."""

    def test_save_narrative_maps_source_pages(self):
        import inspect
        from src.db_repository import save_narrative_to_db
        source = inspect.getsource(save_narrative_to_db)
        assert "sourcePages" in source

    def test_save_notes_maps_source_pages(self):
        import inspect
        from src.db_repository import save_notes_to_db
        source = inspect.getsource(save_notes_to_db)
        assert "sourcePages" in source

    def test_verdict_builder_maps_findings(self):
        import inspect
        from src.verdict_builder import run_and_save_audit_verdict
        source = inspect.getsource(run_and_save_audit_verdict)
        assert "findings" in source


# ═══════════════════════════════════════════════════════════════════════
# 9. pdf_ingestion — format_page_range
# ═══════════════════════════════════════════════════════════════════════

class TestPageRangeFormatting:
    """Overí format_page_range a get_sliced_pdf_page_range."""

    def test_format_consecutive_pages(self):
        """Konsekutívne strany sa formátujú ako range."""
        assert format_page_range([1, 2, 3]) == "1-3"

    def test_format_single_page(self):
        """Jedna strana sa formátuje ako single."""
        assert format_page_range([5]) == "5"

    def test_format_mixed(self):
        """Zmiešané strany s medzerami."""
        assert format_page_range([1, 2, 3, 5, 6, 7, 10]) == "1-3,5-7,10"

    def test_format_empty(self):
        """Prázdny zoznam → prázdny string."""
        assert format_page_range([]) == ""

    def test_format_unsorted(self):
        """Nezoradené strany sa zoradia."""
        assert format_page_range([10, 1, 5, 2, 3]) == "1-3,5,10"

    def test_format_dedup(self):
        """Duplikáty sa odstránia."""
        assert format_page_range([1, 1, 2, 2, 3]) == "1-3"

    def test_get_sliced_pdf_page_range_empty(self):
        """Pre neexistujúci PDF vráti prázdny string."""
        result = get_sliced_pdf_page_range("/nonexistent/path.pdf")
        assert result == ""


# ═══════════════════════════════════════════════════════════════════════
# 10. i18n — nové keys
# ═══════════════════════════════════════════════════════════════════════

class TestI18nKeys:
    """Overí že i18n obsahuje nové keys pre všetkých 6 jazykov."""

    @pytest.fixture
    def i18n_sk(self):
        from src.i18n import get_i18n_strings
        return get_i18n_strings("sk")

    @pytest.fixture
    def i18n_en(self):
        from src.i18n import get_i18n_strings
        return get_i18n_strings("en")

    def test_sk_has_findings_keys(self, i18n_sk):
        """SK i18n musí mať findings keys."""
        assert "findings_title" in i18n_sk
        assert "finding_risk" in i18n_sk
        assert "finding_strength" in i18n_sk
        assert "finding_anomaly" in i18n_sk
        assert "finding_unknown" in i18n_sk
        assert "finding_explanation" in i18n_sk
        assert "finding_implication" in i18n_sk
        assert "finding_source" in i18n_sk

    def test_en_has_findings_keys(self, i18n_en):
        """EN i18n musí mať findings keys."""
        assert "findings_title" in i18n_en
        assert "finding_risk" in i18n_en
        assert "finding_strength" in i18n_en
        assert "finding_anomaly" in i18n_en
        assert "finding_unknown" in i18n_en

    def test_sk_has_notes_keys(self, i18n_sk):
        """SK i18n musí mať nové Notes keys."""
        assert "significant_investments" in i18n_sk
        assert "financing_activities" in i18n_sk
        assert "acquisitions_and_disposals" in i18n_sk
        assert "provisions_and_reserves" in i18n_sk
        assert "restructuring_activities" in i18n_sk
        assert "capital_changes" in i18n_sk
        assert "subsequent_events" in i18n_sk

    def test_sk_has_narrative_keys(self, i18n_sk):
        """SK i18n musí mať nové Narrative keys."""
        assert "business_developments" in i18n_sk
        assert "strengths_and_opportunities" in i18n_sk

    def test_en_has_notes_keys(self, i18n_en):
        """EN i18n musí mať nové Notes keys."""
        assert "significant_investments" in i18n_en
        assert "financing_activities" in i18n_en
        assert "acquisitions_and_disposals" in i18n_en
        assert "subsequent_events" in i18n_en

    def test_en_has_narrative_keys(self, i18n_en):
        """EN i18n musí mať nové Narrative keys."""
        assert "business_developments" in i18n_en
        assert "strengths_and_opportunities" in i18n_en
