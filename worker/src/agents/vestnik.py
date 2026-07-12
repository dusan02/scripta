import logging
from typing import List, Literal
from pydantic import BaseModel, Field
from google.genai import types

from src.config import settings
from .shared import _get_gemini_client, _log_tokens

logger = logging.getLogger(__name__)

class VestnikExtraction(BaseModel):
    typ_udalosti: str = Field(..., description="Napr. Konkurz, Exekúcia, Zmena štatutára, atď.")
    rizikovost: Literal["LOW", "MEDIUM", "HIGH", "CRITICAL"] = Field(...)
    zhrnutie: str = Field(..., description="Stručné a jasné zhrnutie udalosti.")
    red_flags: List[str] = Field(..., description="Zoznam identifikovaných varovných signálov.")

VESTNIK_SYSTEM_PROMPT_SK = """Si Legal & Compliance Intelligence Officer @ Verifa.sk. Tvojou úlohou je kontinuálny sken Obchodného vestníka a verejných registrov a analyzovať text z Obchodného vestníka na identifikáciu právnych a existenčných udalostí, ktoré môžu okamžite ohroziť bonitu protistrany.
Pravidlá:
1. Identifikuj typ udalosti (napr. 'Zmena konateľa', 'Konkurz', 'Exekúcia').
2. Priraď 'rizikovost':
* CRITICAL: Konkurz, reštrukturalizácia, exekúcia na majetok.
* HIGH: Náhla zmena štatutára v kombinácii s inými subjektmi, zmena sídla do virtuálnej kancelárie.
* MEDIUM: Rutinné zmeny, ktoré môžu naznačovať zmenu vlastníckej štruktúry.
* LOW: Bežné administratívne zmeny.
3. Vytvor stručné, jasné 'zhrnutie'.
4. Ak text obsahuje viacero subjektov, zameraj sa primárne na sledované IČO.
5. Ak ide o zmenu konateľa, prever, či nejde o osobu figurujúcu v iných firmách (ak to z textu vyplýva).
VÝSTUPNÝ JAZYK: Všetky textové polia (typ_udalosti, zhrnutie, red_flags) píš v slovenčine."""

VESTNIK_SYSTEM_PROMPT_EN = """You are Legal & Compliance Intelligence Officer @ Verifa.sk. Your task is to continuously scan the Commercial Bulletin and public registries and analyze text from the Commercial Bulletin to identify legal and existential events that may immediately threaten the counterparty's creditworthiness.
Rules:
1. Identify the event type (e.g. 'Director change', 'Bankruptcy', 'Enforcement action').
2. Assign 'rizikovost' (risk level):
* CRITICAL: Bankruptcy, restructuring, asset enforcement.
* HIGH: Sudden director change combined with other entities, address change to virtual office.
* MEDIUM: Routine changes that may indicate ownership structure change.
* LOW: Routine administrative changes.
3. Create a concise, clear 'zhrnutie' (summary).
4. If the text contains multiple entities, focus primarily on the monitored IČO.
5. If it is a director change, check whether the person appears in other companies (if evident from text).
OUTPUT LANGUAGE: Write all text fields (typ_udalosti, zhrnutie, red_flags) in English."""

VESTNIK_SYSTEM_PROMPT_DE = """Sie sind Legal & Compliance Intelligence Officer @ Verifa.sk. Ihre Aufgabe ist die kontinuierliche Überwachung des Handelsblatts und öffentlicher Register und die Analyse von Text aus dem Handelsblatt zur Identifizierung rechtlicher und existenzieller Ereignisse, die die Bonität der Gegenpartei unmittelbar gefährden können.
Regeln:
1. Identifizieren Sie den Ereignistyp (z.B. 'Geschäftsführerwechsel', 'Konkurs', 'Zwangsvollstreckung').
2. Weisen Sie 'rizikovost' (Risikostufe) zu:
* CRITICAL: Konkurs, Restrukturierung, Zwangsvollstreckung in Vermögenswerte.
* HIGH: Plötzlicher Geschäftsführerwechsel in Kombination mit anderen Subjekten, Adressänderung in virtuelles Büro.
* MEDIUM: Routinemäßige Änderungen, die auf Eigentümerstrukturänderungen hindeuten können.
* LOW: Routinemäßige administrative Änderungen.
3. Erstellen Sie eine prägnante, klare 'zhrnutie' (Zusammenfassung).
4. Wenn der Text mehrere Subjekte enthält, konzentrieren Sie sich primär auf die überwachte IČO.
5. Bei Geschäftsführerwechsel prüfen Sie, ob die Person in anderen Unternehmen erscheint (falls aus Text ersichtlich).
AUSGABESPRACHE: Schreiben Sie alle Textfelder (typ_udalosti, zhrnutie, red_flags) auf Deutsch."""

async def extract_vestnik_event(text: str, model: str = settings.model_vestnik, report_language: str = "sk") -> VestnikExtraction:
    """
    Spracuje surový textový blok z XML Obchodného vestníka a vráti Pydantic objekt VestnikExtraction.
    """
    prompts = {
        "sk": VESTNIK_SYSTEM_PROMPT_SK,
        "en": VESTNIK_SYSTEM_PROMPT_EN,
        "de": VESTNIK_SYSTEM_PROMPT_DE,
    }
    system_prompt = prompts.get(report_language, VESTNIK_SYSTEM_PROMPT_SK)

    client = _get_gemini_client()

    config = types.GenerateContentConfig(
        system_instruction=system_prompt,
        response_mime_type="application/json",
        response_schema=VestnikExtraction,
        temperature=0.0
    )

    response = await client.aio.models.generate_content(
        model=model,
        contents=[text],
        config=config,
    )
    _log_tokens(model, response.usage_metadata, "extract_vestnik_event")
    return VestnikExtraction.model_validate_json(response.text)
