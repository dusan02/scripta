import logging
from typing import Optional
from google.genai import types

from src.config import settings
from .shared import _get_gemini_client, _log_tokens
from src.models import OrsrForensics

logger = logging.getLogger(__name__)

ORSR_FORENSIC_PROMPT = """Si forenzný dátový analytik pre slovenský Obchodný register (ORSR). 
Tvojou úlohou je analyzovať čistý text "Úplného výpisu" z ORSR a spočítať frekvenciu historických zmien. 
Zameriavaš sa na dve kľúčové sekcie:
1. "Štatutárny orgán" (konatelia, predstavenstvo)
2. "Sídlo"

V týchto sekciách hľadaj dátumy v zátvorkách vo formáte (od: DD.MM.YYYY do: DD.MM.YYYY) alebo výrazy "vymazané". 
Na základe toho urči:
- statutory_changes_count: Koľkokrát sa v histórii firmy zmenil štatutárny orgán (odchod/príchod konateľa).
- address_changes_count: Koľkokrát firma zmenila svoje sídlo v histórii.
- high_turnover_risk: Nastav na True iba vtedy, ak sa štatutár zmenil aspoň 3-krát za posledné 2 roky (alebo podobne podozrivá frekvencia). Inak False.

Vráť výlučne JSON odpovedajúci Pydantic schéme, nič viac. Zvyšné hodnoty (has_virtual_seat, has_foreign_statutory) nemeníš a necháš na predvolených hodnotách False, tie sa doplňujú systémovo v Pythone.
"""

async def analyze_orsr_history(full_text: str, model: str = "gemini-2.5-flash") -> OrsrForensics:
    """Analyzuje úplný výpis z ORSR a vráti základné forenzné metriky."""
    if not full_text:
        return OrsrForensics()

    client = _get_gemini_client()
    
    # Pre prípad veľmi veľkých textov (čo úplné výpisy môžu byť) použijeme celý text
    contents = [full_text]

    config = types.GenerateContentConfig(
        system_instruction=ORSR_FORENSIC_PROMPT,
        response_mime_type="application/json",
        response_schema=OrsrForensics,
        temperature=0.0
    )

    try:
        response = await client.aio.models.generate_content(
            model=model,
            contents=contents,
            config=config,
        )
        _log_tokens(model, response.usage_metadata, "analyze_orsr_history")
        raw = response.text or "{}"
        return OrsrForensics.model_validate_json(raw)
    except Exception as e:
        logger.error(f"Error v analyze_orsr_history: {e}")
        return OrsrForensics()
