import logging
from typing import Optional
from pydantic import BaseModel, Field
from google.genai import types

from src.config import settings
from .shared import _get_gemini_client, _gemini_uploaded_file, _log_tokens

logger = logging.getLogger(__name__)

class NotesRiskAnalysis(BaseModel):
    related_party_transactions: Optional[str] = Field(..., description="Transakcie so spriaznenými osobami (Related Party Transactions). Hľadaj 'spriaznené osoby', 'related parties', 'IAS 24', 'osoby blízke', 'transakcie podľa IAS 24'.")
    off_balance_sheet_liabilities: Optional[str] = Field(..., description="Podsúvahové záväzky (ručenia, vystavené bankové záruky, lízingové garancie).")
    contingent_risks: Optional[str] = Field(..., description="Prebiehajúce súdne spory a potenciálne záväzky z nich plynúce.")

NOTES_SYSTEM_PROMPT = """Si expertný Forenzný analytik. Analyzuješ "Poznámky k účtovnej závierke" (Notes).
Tvojou jedinou úlohou je odhaliť riziká tunelovania, skrytých dlhov a právnych hrozieb, ktoré sa nepíšu priamo v číslach.
1. Zameraj sa primárne na "Transakcie so spriaznenými osobami" (Related Party Transactions). Hľadaj, komu firma požičiava peniaze (vlastníkom, dcérskym firmám) a od koho nakupuje manažérske služby. Toto je najčastejšia metóda tunelovania.
2. Hľadaj podsúvahové záväzky (garancie za iné firmy).
3. Hľadaj prebiehajúce súdne spory (contingent liabilities).
Ak v texte nenájdeš nič relevantné, vráť null. Nikdy si nevymýšľaj."""

async def extract_notes_risks(file_path: str, model: str = settings.model_notes) -> NotesRiskAnalysis:
    """Extrahuje riziká z Poznámok k závierke (Related party transactions, atď)."""
    client = _get_gemini_client()
    config = types.GenerateContentConfig(
        system_instruction=NOTES_SYSTEM_PROMPT,
        response_mime_type="application/json",
        response_schema=NotesRiskAnalysis,
        temperature=0.0
    )
    with _gemini_uploaded_file(client, file_path) as uploaded_file:
        response = await client.aio.models.generate_content(
            model=model,
            contents=[uploaded_file],
            config=config,
        )
        _log_tokens(model, response.usage_metadata, "extract_notes_risks")
    return NotesRiskAnalysis.model_validate_json(response.text)
