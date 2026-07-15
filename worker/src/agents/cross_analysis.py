import logging
from pydantic import BaseModel, Field
from google.genai import types

from src.config import settings
from .shared import _get_gemini_client, _log_tokens, COMMON_BUT_PATTERNS, COMMON_FORENSIC_RULES, COMMON_TEXT_QUALITY_RULES

logger = logging.getLogger(__name__)


class CrossAnalysisResult(BaseModel):
    executive_summary: str = Field(..., description="Hlboká korelačná analýza a forenzná syntéza. Prepoj finančné anomálie so zisteniami z registrov do pútavého odstavca. Aktívne hľadaj rozpory a napätia medzi indikátormi (vzor 'X je pozitívne, ALE Y to komplikuje').")
    key_risk: str = Field(..., description="Najväčšia hrozba, ktorej firma čelí.")


CROSS_ANALYSIS_PROMPT_SK = f"""Si Cross-Analysis Agent @ Verifa.sk — Senior Financial Forensics Analyst. Tvojou JEDINOU úlohou je vykonať krížovú analýzu všetkých dostupných dát a vytvoriť executive_summary a key_risk pre finálny posudok.

Dostávaš všetky dáta firmy v JSON formáte: finančné výkazy, naratívne analýzy, forenzné poznámky (notesRisk_by_year — transakcie so spriaznenými osobami, podsúvahové záväzky, kontingentné riziká), vestník udalosti, companyEvents z PDF Reader Agent, ORSR forenzné analýzy, a 5-pilierový scorecard breakdown.

**TVOJA ÚLOHA:**
1. EXECUTIVE SUMMARY — Krížová korelačná analýza. Nie sumarizácia faktov. Hľadaj rozpory a anomálie.
2. KEY RISK — Najväčšia hrozba firmy v jednej vete.

{COMMON_BUT_PATTERNS['sk']}

**PRAVIDLÁ:**
{COMMON_FORENSIC_RULES['sk']}

{COMMON_TEXT_QUALITY_RULES['sk']}"""

CROSS_ANALYSIS_PROMPT_EN = f"""You are Cross-Analysis Agent @ Verifa.sk — Senior Financial Forensics Analyst. Your SOLE task is to perform cross-analysis of all available data and create an executive_summary and key_risk for the final assessment.

You receive all company data in JSON format: financial statements, narrative analyses, forensic notes (notesRisk_by_year — related party transactions, off-balance-sheet liabilities, contingent risks), bulletin events, companyEvents from PDF Reader Agent, ORSR forensic analyses, and 5-pillar scorecard breakdown.

**YOUR TASK:**
1. EXECUTIVE SUMMARY — Cross-correlation analysis. NOT fact summarization. Find contradictions and anomalies.
2. KEY RISK — The biggest threat to the company in one sentence.

{COMMON_BUT_PATTERNS['en']}

**RULES:**
{COMMON_FORENSIC_RULES['en']}

{COMMON_TEXT_QUALITY_RULES['en']}"""

CROSS_ANALYSIS_PROMPT_DE = f"""Sie sind Cross-Analysis Agent @ Verifa.sk — Senior Financial Forensics Analyst. Ihre EINZIGE Aufgabe ist eine Kreuzanalyse aller verfügbaren Daten durchzuführen und executive_summary und key_risk für die endgültige Bewertung zu erstellen.

Sie erhalten alle Unternehmensdaten im JSON-Format: Jahresabschlüsse, narrative Analysen, forensische Notizen (notesRisk_by_year — Transaktionen mit nahestenden Personen, außerbilanzielle Verbindlichkeiten, Eventualrisiken), Handelsblatt-Ereignisse, companyEvents vom PDF Reader Agent, ORSR forensische Analysen und 5-Säulen-Scorecard-Aufschlüsselung.

**IHRE AUFGABE:**
1. EXECUTIVE SUMMARY — Kreuzkorrelationsanalyse. KEINE Faktenzusammenfassung. Finden Sie Widersprüche und Anomalien.
2. KEY RISK — Die größte Bedrohung für das Unternehmen in einem Satz.

{COMMON_BUT_PATTERNS['de']}

**REGELN:**
{COMMON_FORENSIC_RULES['de']}

{COMMON_TEXT_QUALITY_RULES['de']}"""


async def generate_cross_analysis(data_json: str, model: str = settings.model_cross_analysis, report_language: str = "sk") -> CrossAnalysisResult:
    """
    Cross-Analysis Agent: vykoná krížovú analýzu dát a vygeneruje executive_summary + key_risk.
    Beží pred Chief Auditorom, ktorý tento výstup použije ako vstup pre finálny verdikt.
    """
    prompts = {
        "sk": CROSS_ANALYSIS_PROMPT_SK,
        "en": CROSS_ANALYSIS_PROMPT_EN,
        "de": CROSS_ANALYSIS_PROMPT_DE,
    }
    system_prompt = prompts.get(report_language, CROSS_ANALYSIS_PROMPT_SK)

    client = _get_gemini_client()

    config = types.GenerateContentConfig(
        system_instruction=system_prompt,
        response_mime_type="application/json",
        response_schema=CrossAnalysisResult,
        temperature=0.0
    )

    response = await client.aio.models.generate_content(
        model=model,
        contents=[data_json],
        config=config,
    )
    _log_tokens(model, response.usage_metadata, "generate_cross_analysis")
    raw = response.text or "{}"
    return CrossAnalysisResult.model_validate_json(raw)
