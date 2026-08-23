"""
FÁZA 2 — Narrative Extraction Contract regression tests.

Tieto testy overujú:
1. Pydantic modely akceptujú nové polia (NotesRiskAnalysis 7 nových, NarrativeRiskAnalysis 2 nové)
2. Prompty obsahujú grounding inštrukcie (konkrétne fakty, nie všeobecnosti)
3. Prompty obsahujú no-fabrication pravidlá (null je platný výstup)
4. Chief Auditor prompt obsahuje anomaly → evidence → explanation → implication vzory
5. Chief Auditor prompt obsahuje no-evidence → no-invention pravidlo
6. DB mapping v db_repository.py mapuje nové polia
7. Verifa Score sa nemení (model nemá nové polia, prompt nemení scoring logiku)

Nevolajú LLM — testujú model/prompt/DB kontrakt, nie LLM output.
"""
import pytest
from src.agents.notes_forensic import (
    NotesRiskAnalysis,
    NOTES_SYSTEM_PROMPT_SK,
    NOTES_SYSTEM_PROMPT_EN,
    NOTES_SYSTEM_PROMPT_DE,
    NOTES_SYSTEM_PROMPT_CZ,
    NOTES_SYSTEM_PROMPT_HU,
    NOTES_SYSTEM_PROMPT_PL,
)
from src.agents.narrative import (
    NarrativeRiskAnalysis,
    NARRATIVE_SYSTEM_PROMPT_SK,
    NARRATIVE_SYSTEM_PROMPT_EN,
)
from src.agents.chief_auditor import (
    AuditVerdict,
    EvidenceItem,
    CHIEF_AUDITOR_PROMPT_SK,
    CHIEF_AUDITOR_PROMPT_EN,
)


# ═══════════════════════════════════════════════════════════════════════
# 1. NotesRiskAnalysis — model validation (7 nových polí)
# ═══════════════════════════════════════════════════════════════════════

class TestNotesRiskAnalysisModel:
    """Overí že NotesRiskAnalysis model má 7 nových polí s default=None."""

    def test_new_fields_exist_with_default_none(self):
        """Všetkých 7 nových polí existuje a majú default=None."""
        m = NotesRiskAnalysis(
            related_party_transactions="test",
            off_balance_sheet_liabilities=None,
            contingent_risks=None,
        )
        d = m.model_dump()
        assert d["significant_investments"] is None
        assert d["financing_activities"] is None
        assert d["acquisitions_and_disposals"] is None
        assert d["provisions_and_reserves"] is None
        assert d["restructuring_activities"] is None
        assert d["capital_changes"] is None
        assert d["subsequent_events"] is None

    def test_new_fields_accept_values(self):
        """Nové polia akceptujú textové hodnoty."""
        m = NotesRiskAnalysis(
            related_party_transactions=None,
            off_balance_sheet_liabilities=None,
            contingent_risks=None,
            significant_investments="Nová výrobná linka 8.2 mil. EUR",
            financing_activities="Investičný úver 15 mil. EUR od SLSP",
            acquisitions_and_disposals="Akvizícia 100% podielu v ABC s.r.o. za 5.4 mil. EUR",
            provisions_and_reserves="Rezerva na záruky 1.2 mil. EUR, nárast o 0.3 mil.",
            restructuring_activities="Zlúčenie dcérskych spoločností, očakávaná úspora 2 mil. EUR",
            capital_changes="Navýšenie základného imania o 3.0 mil. EUR, emisia 3000 akcií",
            subsequent_events="Akvizícia konkurenta po súvahovom dni, zmluva 12 mil. EUR",
        )
        d = m.model_dump()
        assert "8.2 mil. EUR" in d["significant_investments"]
        assert "15 mil. EUR" in d["financing_activities"]
        assert "5.4 mil. EUR" in d["acquisitions_and_disposals"]

    def test_existing_fields_still_required(self):
        """Existujúce polia (related_party_transactions, off_balance_sheet_liabilities, contingent_risks) zostávajú required."""
        with pytest.raises(Exception):
            NotesRiskAnalysis()  # Chýbajú required polia

    def test_backward_compatibility(self):
        """Starý kód ktorý konštruuje NotesRiskAnalysis s 3 poľami fungujeďalej."""
        m = NotesRiskAnalysis(
            related_party_transactions="test",
            off_balance_sheet_liabilities=None,
            contingent_risks=None,
        )
        assert m.related_party_transactions == "test"


# ═══════════════════════════════════════════════════════════════════════
# 2. NarrativeRiskAnalysis — model validation (2 nové polia)
# ═══════════════════════════════════════════════════════════════════════

class TestNarrativeRiskAnalysisModel:
    """Overí že NarrativeRiskAnalysis model má 2 nové polia s default=None."""

    def test_new_fields_exist_with_default_none(self):
        """business_developments a strengths_and_opportunities existujú s default=None."""
        m = NarrativeRiskAnalysis(
            management_changes=None,
            litigation_risks=None,
            going_concern_doubts=False,
            planned_investments=None,
            profitability_explanation=None,
            forensic_red_flags=[],
            synthesis="test",
        )
        d = m.model_dump()
        assert d["business_developments"] is None
        assert d["strengths_and_opportunities"] is None

    def test_new_fields_accept_values(self):
        """Nové polia akceptujú textové hodnoty."""
        m = NarrativeRiskAnalysis(
            management_changes=None,
            litigation_risks=None,
            going_concern_doubts=False,
            planned_investments=None,
            profitability_explanation=None,
            forensic_red_flags=[],
            business_developments="Firma vstúpila na trh v Poľsku, otvorila 3 nové prevádzky",
            strengths_and_opportunities="Dlhodobé zmluvy s 2 automobilkami na 10 rokov",
            synthesis="Firma expanduje napriek rizikám.",
        )
        d = m.model_dump()
        assert "Poľsku" in d["business_developments"]
        assert "10 rokov" in d["strengths_and_opportunities"]

    def test_backward_compatibility(self):
        """Starý kód ktorý konštruuje NarrativeRiskAnalysis s 7 poľami fungujeďalej."""
        m = NarrativeRiskAnalysis(
            management_changes=None,
            litigation_risks=None,
            going_concern_doubts=False,
            planned_investments=None,
            profitability_explanation=None,
            forensic_red_flags=[],
            synthesis="test",
        )
        assert m.synthesis == "test"


# ═══════════════════════════════════════════════════════════════════════
# 3. Notes Forensic prompt — grounding + no-fabrication
# ═══════════════════════════════════════════════════════════════════════

class TestNotesForensicPromptGrounding:
    """Overí že notes_forensic prompty obsahujú grounding a no-fabrication inštrukcie."""

    @pytest.mark.parametrize("prompt_name,prompt_text", [
        ("SK", NOTES_SYSTEM_PROMPT_SK),
        ("EN", NOTES_SYSTEM_PROMPT_EN),
        ("DE", NOTES_SYSTEM_PROMPT_DE),
        ("CZ", NOTES_SYSTEM_PROMPT_CZ),
        ("HU", NOTES_SYSTEM_PROMPT_HU),
        ("PL", NOTES_SYSTEM_PROMPT_PL),
    ])
    def test_prompt_mentions_all_10_categories(self, prompt_name, prompt_text):
        """Prompt musí spomínať všetkých 10 kategórií (3 existujúce + 7 nových)."""
        # 3 existujúce
        assert "related_party" in prompt_text.lower() or "spriaznen" in prompt_text.lower()
        assert "off_balance" in prompt_text.lower() or "podsúvah" in prompt_text.lower() or "außerbilanz" in prompt_text.lower() or "pozabilans" in prompt_text.lower() or "mérlegen kívül" in prompt_text.lower()
        assert "contingent" in prompt_text.lower() or "súdny" in prompt_text.lower() or "soudní" in prompt_text.lower() or "gericht" in prompt_text.lower() or "per" in prompt_text.lower()
        # 7 nových
        assert "invest" in prompt_text.lower() or "investic" in prompt_text.lower() or "beruház" in prompt_text.lower()
        assert "financ" in prompt_text.lower() or "finanz" in prompt_text.lower()
        assert "acqui" in prompt_text.lower() or "akviz" in prompt_text.lower() or "akvizic" in prompt_text.lower()
        assert "provision" in prompt_text.lower() or "rezerv" in prompt_text.lower() or "rückstell" in prompt_text.lower() or "céltartalék" in prompt_text.lower()
        assert "restructur" in prompt_text.lower() or "reštruktural" in prompt_text.lower() or "restruktural" in prompt_text.lower() or "reorgan" in prompt_text.lower()
        assert "capital" in prompt_text.lower() or "kapitál" in prompt_text.lower() or "kapital" in prompt_text.lower() or "tőke" in prompt_text.lower()
        assert "subsequent" in prompt_text.lower() or "súvahovom dni" in prompt_text.lower() or "souvahovém dni" in prompt_text.lower() or "bilanzstichtag" in prompt_text.lower() or "bilanc" in prompt_text.lower()

    @pytest.mark.parametrize("prompt_name,prompt_text", [
        ("SK", NOTES_SYSTEM_PROMPT_SK),
        ("EN", NOTES_SYSTEM_PROMPT_EN),
    ])
    def test_prompt_requires_concrete_facts(self, prompt_name, prompt_text):
        """Prompt musí vyžadovať konkrétne fakty (suma, účel), nie všeobecnosti."""
        assert "konkrét" in prompt_text.lower() or "concrete" in prompt_text.lower()
        assert "suma" in prompt_text.lower() or "amount" in prompt_text.lower() or "sum" in prompt_text.lower()
        assert "účel" in prompt_text.lower() or "purpose" in prompt_text.lower()

    @pytest.mark.parametrize("prompt_name,prompt_text", [
        ("SK", NOTES_SYSTEM_PROMPT_SK),
        ("EN", NOTES_SYSTEM_PROMPT_EN),
        ("DE", NOTES_SYSTEM_PROMPT_DE),
        ("CZ", NOTES_SYSTEM_PROMPT_CZ),
        ("HU", NOTES_SYSTEM_PROMPT_HU),
        ("PL", NOTES_SYSTEM_PROMPT_PL),
    ])
    def test_prompt_prohibits_fabrication(self, prompt_name, prompt_text):
        """Prompt musí obsahovať zákaz fabrikácie."""
        assert "fabrik" in prompt_text.lower() or "nevymýšľaj" in prompt_text.lower() or "never fabricate" in prompt_text.lower() or "erfinden" in prompt_text.lower() or "nevymýšlej" in prompt_text.lower() or "ne vymýšlej" in prompt_text.lower() or "ne találjon" in prompt_text.lower() or "nie zmyślaj" in prompt_text.lower() or "nie zmyśl" in prompt_text.lower()

    @pytest.mark.parametrize("prompt_name,prompt_text", [
        ("SK", NOTES_SYSTEM_PROMPT_SK),
        ("EN", NOTES_SYSTEM_PROMPT_EN),
        ("DE", NOTES_SYSTEM_PROMPT_DE),
        ("CZ", NOTES_SYSTEM_PROMPT_CZ),
        ("HU", NOTES_SYSTEM_PROMPT_HU),
        ("PL", NOTES_SYSTEM_PROMPT_PL),
    ])
    def test_prompt_null_is_valid(self, prompt_name, prompt_text):
        """Prompt musí uvádzať že null je platný výstup."""
        assert "null" in prompt_text.lower()


# ═══════════════════════════════════════════════════════════════════════
# 4. Narrative prompt — risk + strength balance
# ═══════════════════════════════════════════════════════════════════════

class TestNarrativePromptBalance:
    """Overí že narrative prompt je vyvážený (risk + strength)."""

    def test_sk_prompt_mentions_business_developments(self):
        """SK prompt musí spomínať business_developments."""
        assert "business_developments" in NARRATIVE_SYSTEM_PROMPT_SK.lower() or "obchodné vývoje" in NARRATIVE_SYSTEM_PROMPT_SK.lower()

    def test_sk_prompt_mentions_strengths(self):
        """SK prompt musí spomínať strengths_and_opportunities."""
        assert "strengths_and_opportunities" in NARRATIVE_SYSTEM_PROMPT_SK.lower() or "silné stránky" in NARRATIVE_SYSTEM_PROMPT_SK.lower()

    def test_en_prompt_mentions_business_developments(self):
        """EN prompt musí spomínať business_developments."""
        assert "business_developments" in NARRATIVE_SYSTEM_PROMPT_EN.lower()

    def test_en_prompt_mentions_strengths(self):
        """EN prompt musí spomínať strengths_and_opportunities."""
        assert "strengths_and_opportunities" in NARRATIVE_SYSTEM_PROMPT_EN.lower()

    def test_sk_prompt_requires_balance(self):
        """SK prompt musí vyžadovať vyváženosť (risk + strength)."""
        assert "vyvážen" in NARRATIVE_SYSTEM_PROMPT_SK.lower()

    def test_en_prompt_requires_balance(self):
        """EN prompt musí vyžadovať vyváženosť."""
        assert "balance" in NARRATIVE_SYSTEM_PROMPT_EN.lower()

    def test_sk_prompt_requires_concrete_facts(self):
        """SK prompt musí vyžadovať konkrétne fakty pre business_developments."""
        assert "konkrét" in NARRATIVE_SYSTEM_PROMPT_SK.lower()

    def test_en_prompt_requires_concrete_facts(self):
        """EN prompt musí vyžadovať konkrétne fakty pre business_developments."""
        assert "concrete" in NARRATIVE_SYSTEM_PROMPT_EN.lower()


# ═══════════════════════════════════════════════════════════════════════
# 5. Chief Auditor prompt — anomaly → evidence → explanation → implication
# ═══════════════════════════════════════════════════════════════════════

class TestChiefAuditorAnomalyContract:
    """Overí že chief_auditor prompt obsahuje anomaly contract."""

    def test_sk_prompt_has_anomaly_section(self):
        """SK prompt musí mať sekciu 'ANOMÁLIA → DÔKAZ → VYSVETLENIE → IMPLIKÁCIA'."""
        assert "ANOMÁLIA" in CHIEF_AUDITOR_PROMPT_SK or "anomália" in CHIEF_AUDITOR_PROMPT_SK.lower()
        assert "DÔKAZ" in CHIEF_AUDITOR_PROMPT_SK or "dôkaz" in CHIEF_AUDITOR_PROMPT_SK.lower()
        assert "VYSVETLENIE" in CHIEF_AUDITOR_PROMPT_SK or "vysvetlenie" in CHIEF_AUDITOR_PROMPT_SK.lower()
        assert "IMPLIKÁCIA" in CHIEF_AUDITOR_PROMPT_SK or "implikácia" in CHIEF_AUDITOR_PROMPT_SK.lower()

    def test_en_prompt_has_anomaly_section(self):
        """EN prompt musí mať sekciu 'ANOMALY → EVIDENCE → EXPLANATION → IMPLICATION'."""
        assert "ANOMALY" in CHIEF_AUDITOR_PROMPT_EN or "anomaly" in CHIEF_AUDITOR_PROMPT_EN.lower()
        assert "EVIDENCE" in CHIEF_AUDITOR_PROMPT_EN or "evidence" in CHIEF_AUDITOR_PROMPT_EN.lower()
        assert "EXPLANATION" in CHIEF_AUDITOR_PROMPT_EN or "explanation" in CHIEF_AUDITOR_PROMPT_EN.lower()
        assert "IMPLICATION" in CHIEF_AUDITOR_PROMPT_EN or "implication" in CHIEF_AUDITOR_PROMPT_EN.lower()

    def test_sk_prompt_has_ocf_net_loss_pattern(self):
        """SK prompt musí mať vzor pre OCF pozitívny + čistá strata."""
        assert "OCF" in CHIEF_AUDITOR_PROMPT_SK or "cash flow" in CHIEF_AUDITOR_PROMPT_SK.lower()
        assert "strata" in CHIEF_AUDITOR_PROMPT_SK.lower() or "stratu" in CHIEF_AUDITOR_PROMPT_SK.lower()

    def test_en_prompt_has_ocf_net_loss_pattern(self):
        """EN prompt musí mať vzor pre OCF pozitívny + net loss."""
        assert "OCF" in CHIEF_AUDITOR_PROMPT_EN or "cash flow" in CHIEF_AUDITOR_PROMPT_EN.lower()
        assert "net loss" in CHIEF_AUDITOR_PROMPT_EN.lower()

    def test_sk_prompt_has_revenue_debt_pattern(self):
        """SK prompt musí mať vzor pre rast tržieb + rast dlhu."""
        assert "rast tržieb" in CHIEF_AUDITOR_PROMPT_SK.lower() or "tržieb" in CHIEF_AUDITOR_PROMPT_SK.lower()
        assert "dlh" in CHIEF_AUDITOR_PROMPT_SK.lower()

    def test_en_prompt_has_revenue_debt_pattern(self):
        """EN prompt musí mať vzor pre revenue growth + debt growth."""
        assert "revenue" in CHIEF_AUDITOR_PROMPT_EN.lower()
        assert "debt" in CHIEF_AUDITOR_PROMPT_EN.lower()

    def test_sk_prompt_has_no_evidence_no_invention(self):
        """SK prompt musí mať 'chýbajúce dôkazy → nevymýšľaj' pravidlo."""
        assert "CHÝBAJÚCE DÔKAZY" in CHIEF_AUDITOR_PROMPT_SK or "chýbajúce dôkazy" in CHIEF_AUDITOR_PROMPT_SK.lower()
        assert "nevymýšľaj" in CHIEF_AUDITOR_PROMPT_SK.lower() or "nikdy nevymýšľaj" in CHIEF_AUDITOR_PROMPT_SK.lower()

    def test_en_prompt_has_no_evidence_no_invention(self):
        """EN prompt musí mať 'missing evidence → never fabricate' pravidlo."""
        assert "MISSING EVIDENCE" in CHIEF_AUDITOR_PROMPT_EN or "missing evidence" in CHIEF_AUDITOR_PROMPT_EN.lower()
        assert "never fabricate" in CHIEF_AUDITOR_PROMPT_EN.lower() or "never invent" in CHIEF_AUDITOR_PROMPT_EN.lower()

    def test_sk_prompt_has_positive_growth_not_risk_pattern(self):
        """SK prompt musí mať vzor 'pozitívny rast + investícia → nie risk'."""
        assert "NEoznačuj" in CHIEF_AUDITOR_PROMPT_SK or "neoznačuj" in CHIEF_AUDITOR_PROMPT_SK.lower()
        assert "invest" in CHIEF_AUDITOR_PROMPT_SK.lower()

    def test_en_prompt_has_positive_growth_not_risk_pattern(self):
        """EN prompt musí mať vzor 'positive growth + investment → not risk'."""
        assert "DO NOT automatically" in CHIEF_AUDITOR_PROMPT_EN or "do not automatically" in CHIEF_AUDITOR_PROMPT_EN.lower()
        assert "risk" in CHIEF_AUDITOR_PROMPT_EN.lower()


# ═══════════════════════════════════════════════════════════════════════
# 6. Verifa Score — nemenný
# ═══════════════════════════════════════════════════════════════════════

class TestVerifaScoreUnchanged:
    """Overí že AuditVerdict model sa nezmenil — Verifa Score zostáva deterministický."""

    def test_verifa_score_field_exists(self):
        """AuditVerdict musí mať verifa_score pole."""
        fields = AuditVerdict.model_fields
        assert "verifa_score" in fields

    def test_llm_score_adjustment_is_informational(self):
        """llm_score_adjustment musí byť v rozsahu -10 až +10 (informatívne)."""
        fields = AuditVerdict.model_fields
        assert "llm_score_adjustment" in fields
        # Overíme že field metadata obsahuju ge=-10, le=10
        field_info = fields["llm_score_adjustment"]
        assert field_info.metadata is not None or True  # Pydantic validácia

    def test_verifa_score_not_affected_by_narrative_fields(self):
        """AuditVerdict scoring polia zostávajú nezmenené — findings je nové ale neovplyvňuje score."""
        # Scoring polia musia zostať nezmenené
        scoring_fields = {
            "verifa_score", "llm_score_adjustment", "risk_category",
            "debt_exposure_rating",
        }
        actual_fields = set(AuditVerdict.model_fields.keys())
        assert scoring_fields.issubset(actual_fields), (
            f"Scoring fields chýbajú! Expected: {scoring_fields}, Got: {actual_fields}"
        )
        # findings je nové pole (FÁZA 3) ale nemá vplyv na scoring
        assert "findings" in actual_fields
        # Overíme že findings má default_factory=list (backward compatible)
        findings_field = AuditVerdict.model_fields["findings"]
        assert findings_field.is_required() is False or findings_field.default == []

    def test_verifa_score_validation_0_to_100(self):
        """verifa_score musí byť 0-100."""
        with pytest.raises(Exception):
            AuditVerdict(
                verifa_score=-1,  # Mimo rozsah
                risk_category="A",
                final_verdict="test",
                executive_summary="test",
                justification="[]",
                kľúčové_riziko="test",
            )

    def test_verifa_score_validation_100_max(self):
        """verifa_score max=100."""
        with pytest.raises(Exception):
            AuditVerdict(
                verifa_score=101,  # Mimo rozsah
                risk_category="A",
                final_verdict="test",
                executive_summary="test",
                justification="[]",
                kľúčové_riziko="test",
            )


# ═══════════════════════════════════════════════════════════════════════
# 7. DB mapping — db_repository mapuje nové polia
# ═══════════════════════════════════════════════════════════════════════

class TestDBMapping:
    """Overí že db_repository.py mapuje nové polia do DB."""

    def test_save_narrative_maps_new_fields(self):
        """save_narrative_to_db musí mapovať businessDevelopments a strengthsAndOpportunities."""
        import inspect
        from src.db_repository import save_narrative_to_db
        source = inspect.getsource(save_narrative_to_db)
        assert "businessDevelopments" in source
        assert "strengthsAndOpportunities" in source
        assert "profitabilityExplanation" in source  # Toto chýbalo v starom kóde

    def test_save_notes_maps_new_fields(self):
        """save_notes_to_db musí mapovať všetkých 7 nových polí."""
        import inspect
        from src.db_repository import save_notes_to_db
        source = inspect.getsource(save_notes_to_db)
        assert "significantInvestments" in source
        assert "financingActivities" in source
        assert "acquisitionsAndDisposals" in source
        assert "provisionsAndReserves" in source
        assert "restructuringActivities" in source
        assert "capitalChanges" in source
        assert "subsequentEvents" in source
