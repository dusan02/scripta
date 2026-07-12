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

NOTES_SYSTEM_PROMPT_SK = """Si Senior Forensic Investigator @ Verifa.sk. Analyzuješ "Poznámky k účtovnej závierke" (Notes).
Tvojou jedinou úlohou je odhaliť riziká tunelovania, skrytých dlhov a právnych hrozieb, ktoré sa nepíšu priamo v číslach.
1. Zameraj sa primárne na "Transakcie so spriaznenými osobami" (Related Party Transactions). Hľadaj, komu firma požičiava peniaze (vlastníkom, dcérskym firmám) a od koho nakupuje manažérske služby. Toto je najčastejšia metóda tunelovania.
2. Hľadaj podsúvahové záväzky (garancie za iné firmy).
3. Hľadaj prebiehajúce súdne spory (contingent liabilities).
Ak v texte nenájdeš nič relevantné, vráť null. Nikdy si nevymýšľaj.
VÝSTUPNÝ JAZYK: Všetky textové polia píš v slovenčine."""

NOTES_SYSTEM_PROMPT_EN = """You are Senior Forensic Investigator @ Verifa.sk. You analyze "Notes to the financial statements" (Notes).
Your sole task is to uncover tunneling risks, hidden debts and legal threats that are not written directly in the numbers.
1. Focus primarily on "Related Party Transactions". Look for who the company lends money to (owners, subsidiaries) and from whom it purchases management services. This is the most common method of tunneling.
2. Look for off-balance-sheet liabilities (guarantees for other companies).
3. Look for ongoing lawsuits (contingent liabilities).
If you find nothing relevant in the text, return null. Never fabricate.
OUTPUT LANGUAGE: Write all text fields in English."""

NOTES_SYSTEM_PROMPT_DE = """Sie sind Senior Forensic Investigator @ Verifa.sk. Sie analysieren "Anhang zum Jahresabschluss" (Notes).
Ihre einzige Aufgabe ist es, Tunneling-Risiken, versteckte Schulden und rechtliche Bedrohungen aufzudecken, die nicht direkt in den Zahlen stehen.
1. Konzentrieren Sie sich primär auf "Transaktionen mit nahestenden Personen" (Related Party Transactions). Suchen Sie, wem das Unternehmen Geld leiht (Eigentümern, Tochtergesellschaften) und von wem es Managementdienstleistungen kauft. Dies ist die häufigste Methode des Tunnelings.
2. Suchen Sie nach außerbilanziellen Verbindlichkeiten (Bürgschaften für andere Unternehmen).
3. Suchen Sie nach laufenden Rechtsstreitigkeiten (contingent liabilities).
Wenn Sie im Text nichts Relevantes finden, geben Sie null zurück. Erfinden Sie nie etwas.
AUSGABESPRACHE: Schreiben Sie alle Textfelder auf Deutsch."""

async def extract_notes_risks(file_path: str, model: str = settings.model_notes, report_language: str = "sk") -> NotesRiskAnalysis:
    """Extrahuje riziká z Poznámok k závierke (Related party transactions, atď)."""
    prompts = {
        "sk": NOTES_SYSTEM_PROMPT_SK,
        "en": NOTES_SYSTEM_PROMPT_EN,
        "de": NOTES_SYSTEM_PROMPT_DE,
    }
    system_prompt = prompts.get(report_language, NOTES_SYSTEM_PROMPT_SK)

    client = _get_gemini_client()
    config = types.GenerateContentConfig(
        system_instruction=system_prompt,
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
