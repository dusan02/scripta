import logging
from typing import List, Optional
from pydantic import BaseModel, Field
from google.genai import types

from src.config import settings
from .shared import _get_gemini_client, _gemini_uploaded_file, _log_tokens

logger = logging.getLogger(__name__)

class NarrativeRiskAnalysis(BaseModel):
    management_changes: Optional[str] = Field(..., description="Zmeny v štatutárnych orgánoch alebo kľúčovom manažmente a ich forenzný dopad.")
    litigation_risks: Optional[str] = Field(..., description="Súdne spory, exekúcie alebo právne hrozby spomenuté v texte.")
    going_concern_doubts: bool = Field(..., description="Indície, že firma má problémy s likviditou alebo pokračovaním v činnosti.")
    planned_investments: Optional[str] = Field(..., description="Plánované investície, ktoré môžu naznačovať agresívny rast alebo naopak prípravu na predaj firmy.")
    profitability_explanation: Optional[str] = Field(..., description="Vysvetlenie manažmentu k výkyvom v ziskovosti a cash-flow.")
    forensic_red_flags: List[str] = Field(..., description="Zoznam identifikovaných rizikových indikátorov v texte správy.")
    synthesis: str = Field(..., description="Krátka syntéza: Je táto firma v stabilnom stave, alebo vykazuje známky nestability?")

NARRATIVE_SYSTEM_PROMPT = """Si expertný Finančný analytik Verifa.sk. Tvojou úlohou je extrahovať z dokumentu len informácie, ktoré majú právnu alebo finančnú relevanciu.
Tvoje pravidlá:
1. Ignoruj marketingový balast: Preskoč pasáže o 'víziách', 'spoločenskej zodpovednosti' alebo 'spokojnosti zamestnancov', pokiaľ nemajú priamy dopad na finančnú stabilitu.
2. Hľadaj 'Going Concern' signály: Buď mimoriadne citlivý na frázy o 'pochybnostiach o schopnosti pokračovať v činnosti', 'problémoch s financovaním' alebo 'závislosti od externých úverov'.
3. Identifikuj 'Biele kone': Hľadaj firmy, ktoré vykazujú vysoké tržby, ale nemajú zamestnancov, alebo majú transakcie so spriaznenými osobami, ktoré nezodpovedajú bežnej obchodnej praxi.
4. Venuj pozornosť 'plánovaným investíciám': Ak firma plánuje rozsiahle investície napriek zníženému cash flow, môže to byť signál riskantného rastu.
5. Buď kritický: Ak firma v texte bagatelizuje súdny spor, označ to ako litigation_risks a uveď, prečo je to riziko.
6. Analyzuj výkyvy zisku: Hľadaj pasáže, kde manažment vysvetľuje zníženie zisku alebo cash-flow. Ak firma vykazuje dlhodobú ziskovosť, hľadaj náznaky budúcich rizík (napr. zmena trhu, strata kľúčového zákazníka)."""

async def extract_narrative_risk(file_path: str, model: str = settings.model_narrative) -> NarrativeRiskAnalysis:
    """
    Spracuje Výročnú správu (VS_*.pdf). V predvolenom nastavení sa PDF orezáva na prvých
    ~15 strán (manažérska správa) v `pipeline.py`, aby sa ušetrili tokeny a zrýchlilo
    spracovanie.
    """
    client = _get_gemini_client()
    config = types.GenerateContentConfig(
        system_instruction=NARRATIVE_SYSTEM_PROMPT,
        response_mime_type="application/json",
        response_schema=NarrativeRiskAnalysis,
        temperature=0.0
    )
    with _gemini_uploaded_file(client, file_path) as uploaded_file:
        response = await client.aio.models.generate_content(
            model=model,
            contents=[uploaded_file],
            config=config,
        )
        _log_tokens(model, response.usage_metadata, "extract_narrative_risk")

    return NarrativeRiskAnalysis.model_validate_json(response.text)
