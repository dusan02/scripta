import logging
from typing import List
from pydantic import BaseModel, Field
from google.genai import types

from src.config import settings
from .shared import _get_gemini_client, _log_tokens

logger = logging.getLogger(__name__)


class QADiscrepancy(BaseModel):
    field: str = Field(..., description="Ktoré pole alebo tvrdenie v verdikte je problematické.")
    verdict_value: str = Field(..., description="Hodnota uvedená vo verdikte.")
    source_value: str = Field(..., description="Skutočná hodnota zo zdrojových dát alebo 'NOT_FOUND'.")
    severity: str = Field(..., description="CRITICAL, WARNING, INFO")


class QAResult(BaseModel):
    discrepancies: List[QADiscrepancy] = Field(default_factory=list)
    overall_ok: bool = Field(..., description="True ak neboli nájdené žiadne kritické nezrovnalosti.")
    quality_score: int = Field(..., ge=0, le=100, description="Kvantitatívne hodnotenie kvality verdiktu (0-100). 100 = bezchybný, 85+ = veľmi dobrý, 70-85 = priemerný, <70 = slabý. Pričítaj za: správne čísla (+30), správnu risk_category (+15), pokrytie všetkých pilierov (+20), cross-analýzu depth (+15), valid key_risk (+10), správne debt_exposure (+10). Odčítaj za každú CRITICAL discrepancy (-15) a WARNING (-5).")


_QA_PROMPT_SK = """Si Report QA Agent @ Verifa.sk — Quality Assurance Auditor.
Tvojou úlohou je skontrolovať finálny verdikt Chief Auditora proti zdrojovým dátam a nájsť nezrovnalosti.

Dostaneš:
1. VERDICT JSON — finálny verdikt (executive_summary, final_verdict, zdovodnenie, key_risk, verifa_score, risk_category, debt_exposure_rating)
2. SOURCE JSON — zdrojové dáta firmy (financialStatements, vestnikEvents, companyEvents, analyza_trendov)

Kontroluj:
1. ČÍSLA: Každé číslo uvedené v executive_summary alebo final_verdict musí zodpovedať zdrojovým dátam. Ak verdikt hovorí "tržby 5,2 mil." ale v zdrojoch je 3,8 mil., je to CRITICAL discrepancy.
2. RISK CATEGORY: Skontroluj, či risk_category zodpovedá verifa_score (90-100=AAA, 70-89=A, 40-69=B, 0-39=C).
3. EVIDENCE SOURCES: Pre každý EvidenceItem v zdovodnenie skontroluj, či source pole odkazuje na zdroj, ktorý skutočne existuje v zdrojových dátach.
4. FABRICATED FACTS: Ak verdikt obsahuje konkrétne tvrdenie ("firma má exekúciu 50 000 EUR"), ktoré nie je podložené zdrojovými dátami, označ ako CRITICAL.
5. DEBT EXPOSURE: Ak debt_exposure_rating > 0, skontroluj či v companyEvents alebo vestnikEvents skutočne existujú dlhy/exekúcie.
6. PILLAR COVERAGE: Skontroluj, či zdovodnenie obsahuje aspoň jeden EvidenceItem pre každý z 5 pilierov (Platobná schopnosť, Finančné zdravie, Ziskovosť, Rast, Právna bezúhonnosť). Ak chýba pilier, označ ako WARNING.
7. CROSS-ANALYSIS DEPTH: Skontroluj, či executive_summary obsahuje krížovú analýzu (prepojenie rôznych dátových zdrojov), nielen sumarizáciu faktov. Ak je executive_summary len zoznam faktov bez vzťahov medzi nimi, označ ako WARNING.
8. KEY RISK VALIDITY: Skontroluj, či key_risk skutočne reflektuje najväčšiu hrozbu firmy na základe zdrojových dát. Ak key_risk spomína riziko, ktoré nie je podložené dátami, alebo ignoruje zjavné väčšie riziko, označ ako WARNING.

Pravidlá:
- Si konzervatívny. Ak si nie si istý, či číslo súhlasí, označ ako WARNING (nie CRITICAL).
- Neporovnávaj presné formátovanie (medzery, čiarky). Porovnávaj hodnoty.
- Ak verdikt spomína "bez záznamu" a v zdrojoch naozaj nie sú dáta, je to OK.
- Slovenčina vo všetkých textoch.

QUALITY_SCORE výpočet (0-100):
- Začni od 100.
- -15 za každú CRITICAL discrepancy.
- -5 za každú WARNING discrepancy.
- -10 ak chýba cross-analýza depth (executive_summary je len zoznam faktov).
- -10 ak key_risk nie je podložený dátami.
- Minimum 0, maximum 100.
"""

_QA_PROMPT_EN = """You are Report QA Agent @ Verifa.sk — Quality Assurance Auditor.
Your task is to verify the Chief Auditor's final verdict against source data and find discrepancies.

You receive:
1. VERDICT JSON — final verdict (executive_summary, final_verdict, zdovodnenie, key_risk, verifa_score, risk_category, debt_exposure_rating)
2. SOURCE JSON — company source data (financialStatements, vestnikEvents, companyEvents, analyza_trendov)

Check:
1. NUMBERS: Every number in executive_summary or final_verdict must match source data. If verdict says "revenue 5.2M" but source shows 3.8M, it's a CRITICAL discrepancy.
2. RISK CATEGORY: Check if risk_category matches verifa_score (90-100=AAA, 70-89=A, 40-69=B, 0-39=C).
3. EVIDENCE SOURCES: For each EvidenceItem in zdovodnenie, check if the source field refers to a source that actually exists in the source data.
4. FABRICATED FACTS: If verdict contains a specific claim ("company has 50,000 EUR enforcement") not supported by source data, flag as CRITICAL.
5. DEBT EXPOSURE: If debt_exposure_rating > 0, verify that companyEvents or vestnikEvents actually contain debts/enforcements.
6. PILLAR COVERAGE: Check that zdovodnenie contains at least one EvidenceItem for each of the 5 pillars (Solvency, Financial Health, Profitability, Growth, Legal Integrity). If a pillar is missing, flag as WARNING.
7. CROSS-ANALYSIS DEPTH: Check that executive_summary contains cross-analysis (connecting different data sources), not just a summary of facts. If executive_summary is just a list of facts without relationships between them, flag as WARNING.
8. KEY RISK VALIDITY: Check that key_risk actually reflects the biggest threat to the company based on source data. If key_risk mentions a risk not supported by data, or ignores an obvious larger risk, flag as WARNING.

Rules:
- Be conservative. If unsure whether a number matches, flag as WARNING (not CRITICAL).
- Don't compare exact formatting (spaces, commas). Compare values.
- If verdict mentions "no records" and source data indeed has none, that's OK.
- English in all texts.

QUALITY_SCORE calculation (0-100):
- Start from 100.
- -15 for each CRITICAL discrepancy.
- -5 for each WARNING discrepancy.
- -10 if cross-analysis depth is missing (executive_summary is just a list of facts).
- -10 if key_risk is not supported by data.
- Minimum 0, maximum 100.
"""

_QA_PROMPT_DE = """Sie sind Report QA Agent @ Verifa.sk — Quality Assurance Auditor.
Ihre Aufgabe ist es, das endgültige Gutachten des Chief Auditors gegen die Quelldaten zu überprüfen und Unstimmigkeiten zu finden.

Sie erhalten:
1. VERDICT JSON — endgültiges Gutachten (executive_summary, final_verdict, zdovodnenie, key_risk, verifa_score, risk_category, debt_exposure_rating)
2. SOURCE JSON — Unternehmensquelldaten (financialStatements, vestnikEvents, companyEvents, analyza_trendov)

Prüfen Sie:
1. ZAHLEN: Jede Zahl in executive_summary oder final_verdict muss mit den Quelldaten übereinstimmen. Wenn das Gutachten "Umsatz 5,2 Mio." sagt, aber die Quelle 3,8 Mio. zeigt, ist dies eine CRITICAL Abweichung.
2. RISK CATEGORY: Prüfen Sie, ob risk_category zu verifa_score passt (90-100=AAA, 70-89=A, 40-69=B, 0-39=C).
3. EVIDENCE SOURCES: Für jedes EvidenceItem in zdovodnenie prüfen Sie, ob das source-Feld auf eine Quelle verweist, die tatsächlich in den Quelldaten existiert.
4. FABRICATED FACTS: Wenn das Gutachten eine konkrete Behauptung enthält ("Unternehmen hat 50.000 EUR Zwangsvollstreckung"), die nicht durch Quelldaten belegt ist, als CRITICAL markieren.
5. DEBT EXPOSURE: Wenn debt_exposure_rating > 0, verifizieren Sie, dass companyEvents oder vestnikEvents tatsächlich Schulden/Zwangsvollstreckungen enthalten.
6. SÄULEN-ABDECKUNG: Prüfen Sie, dass zdovodnenie mindestens ein EvidenceItem für jede der 5 Säulen enthält (Zahlungsfähigkeit, Finanzielle Gesundheit, Rentabilität, Wachstum, Rechtliche Unbescholtenheit). Wenn eine Säule fehlt, als WARNING markieren.
7. KREUZANALYSE-TIEFE: Prüfen Sie, dass executive_summary eine Kreuzanalyse enthält (Verbindung verschiedener Datenquellen), nicht nur eine Zusammenfassung von Fakten. Wenn executive_summary nur eine Faktenliste ohne Beziehungen ist, als WARNING markieren.
8. HAUPTRISIKO-VALIDITÄT: Prüfen Sie, dass key_risk tatsächlich die größte Bedrohung des Unternehmens basierend auf Quelldaten widerspiegelt. Wenn key_risk ein nicht belegtes Risiko erwähnt oder ein offensichtliches größeres Risiko ignoriert, als WARNING markieren.

Regeln:
- Seien Sie konservativ. Bei Unsicherheit, ob eine Zahl übereinstimmt, als WARNING markieren (nicht CRITICAL).
- Keinen exakten Formatvergleich (Leerzeichen, Kommas). Werte vergleichen.
- Wenn das Gutachten "keine Einträge" erwähnt und die Quelldaten tatsächlich keine haben, ist das OK.
- Deutsch in allen Texten.

QUALITY_SCORE Berechnung (0-100):
- Starten Sie bei 100.
- -15 für jede CRITICAL Abweichung.
- -5 für jede WARNING Abweichung.
- -10 wenn Kreuzanalyse-Tiefe fehlt (executive_summary ist nur eine Faktenliste).
- -10 wenn key_risk nicht durch Daten belegt ist.
- Minimum 0, Maximum 100.
"""


async def verify_report_quality(
    verdict_json: str,
    source_json: str,
    model: str = settings.model_fallback,
    report_language: str = "sk",
) -> QAResult:
    """
    Report QA Agent: overí finálny verdikt proti zdrojovým dátam.
    Vráti zoznam nezrovnalostí alebo potvrdenie, že všetko súhlasí.
    """
    prompts = {
        "sk": _QA_PROMPT_SK,
        "en": _QA_PROMPT_EN,
        "de": _QA_PROMPT_DE,
    }
    system_prompt = prompts.get(report_language, _QA_PROMPT_SK)

    client = _get_gemini_client()

    contents = f"[VERDICT JSON]\n{verdict_json}\n\n---\n[SOURCE JSON]\n{source_json}"

    config = types.GenerateContentConfig(
        system_instruction=system_prompt,
        response_mime_type="application/json",
        response_schema=QAResult,
        temperature=0.0,
    )

    response = await client.aio.models.generate_content(
        model=model,
        contents=contents,
        config=config,
    )
    _log_tokens(model, response.usage_metadata, "verify_report_quality")
    return QAResult.model_validate_json(response.text)
