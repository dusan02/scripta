import os
import re
import logging
from typing import Optional
from pydantic import BaseModel, Field
from google.genai import types

from src.config import settings
from .shared import _get_gemini_client, _gemini_uploaded_file, _log_tokens

logger = logging.getLogger(__name__)

class StaffCostsResult(BaseModel):
    osobne_naklady: Optional[float] = Field(..., description="Osobné/personálne náklady (Staff costs / Employee benefits) v EUR. Súčet mzdových nákladov + sociálneho poistenia + odvodov. Ak chýba, vráť null.")
    found_in: str = Field(..., description="Kde sa našlo: 'income_statement' alebo 'notes' alebo 'not_found'.")

_STAFF_COSTS_PROMPT = """Si expertný finančný analytik. Tvojou JEDINOU úlohou je nájsť hodnotu osobných/personálnych nákladov (staff costs / employee benefits) v účtovnej závierke.

Hľadaj tieto názvy položiek (skús všetky):
- Slovensky: "Osobné náklady", "Mzdové náklady", "Personálne náklady", "Náklady na zamestnancov", "Zamestnanecké dávky", "Mzdové a osobné náklady"
- Anglicky: "Staff costs", "Employee benefits expense", "Wages and salaries", "Salaries and wages", "Employee costs", "Personnel costs", "Labor costs"

KRITICKÉ: Výkaz ziskov a strát môže byť prezentovaný PODĽA FUNKCIE (by function), nie podľa druhu (by nature). V takom prípade:
1. Výkaz ziskov a strát NEBUDE mať samostatný riadok pre osobné náklady — budú skryté v "Cost of sales", "Administrative expenses", "Selling expenses".
2. V takom prípade HĽADAJ V POZNÁMKACH (Notes) — konkrétne v poznámke o zamestnaneckých dávkach / employee benefits / staff costs disclosure.
3. Poznámky typicky obsahujú tabuľku s rozkladom: "Wages and salaries" + "Social security contributions" + "Other staff costs" = Total. Sčítaj všetky zložky.

PRAVIDLÁ:
- Všetky hodnoty extrahuj V EURÁCH. Ak tabuľka uvádza "v tisícoch EUR", vynásob 1000. Ak "v miliónoch EUR", vynásob 1 000 000.
- Extrahuj hodnotu pre AKTUÁLNE účtovné obdobie (prvý stĺpec dát / current year).
- Nákladové položky VŽDY extrahuj ako KLDNÉ čísla (absolútna hodnota). Zátvorky (1500) = 1500.
- Ak hodnotu nenájdeš ani vo výkaze ani v poznámkach, vráť null a found_in='not_found'."""


async def extract_staff_costs_focused(file_path: str, model: str = settings.model_ifrs) -> Optional[float]:
    """
    Cielene extrahuje iba osobné náklady z PDF/TXT.
    Používa sa ako retry keď hlavná extrakcia vráti None pre osobne_naklady.
    Využíva špecifický prompt zameraný na IFRS by-function výkazy kde sú mzdové
    náklady v poznámkach, nie v hlavnom výkaze.
    """
    filename = os.path.basename(file_path)
    match = re.search(r'_(\d{4})_', filename)
    expected_year = int(match.group(1)) if match else None

    client = _get_gemini_client()

    config = types.GenerateContentConfig(
        system_instruction=_STAFF_COSTS_PROMPT,
        response_mime_type="application/json",
        response_schema=StaffCostsResult,
        temperature=0.0
    )

    try:
        if file_path.lower().endswith(".txt"):
            with open(file_path, "r", encoding="utf-8") as f:
                text_content = f.read()
            logger.info(f"[STAFF COSTS RETRY] Spracovávam .txt: {filename} ({len(text_content)} chars)")
            response = await client.aio.models.generate_content(
                model=model,
                contents=[text_content],
                config=config,
            )
        else:
            with _gemini_uploaded_file(client, file_path) as uploaded_file:
                logger.info(f"[STAFF COSTS RETRY] Spracovávam PDF: {filename}")
                response = await client.aio.models.generate_content(
                    model=model,
                    contents=[uploaded_file],
                    config=config,
                )

        _log_tokens(model, response.usage_metadata, "extract_staff_costs_focused")
        result = StaffCostsResult.model_validate_json(response.text)

        if result.osobne_naklady is not None:
            logger.info(f"[STAFF COSTS RETRY] Nájdené osobné náklady={result.osobne_naklady} (z: {result.found_in}) pre {filename}")

            # Sanity check: ak je hodnota pod 100 a máme IFRS firmu s veľkými tržbami, pravdepodobne odignorovalo tisíce/milióny
            if result.osobne_naklady > 0 and result.osobne_naklady < 100:
                logger.warning(f"[STAFF COSTS RETRY] Podozrenie na nezmenené jednotky (hodnota={result.osobne_naklady}). Násobím x1000.")
                result.osobne_naklady *= 1000

            # Safety net: náklad musí byť kladný
            if result.osobne_naklady < 0:
                result.osobne_naklady = abs(result.osobne_naklady)

            return result.osobne_naklady
        else:
            logger.warning(f"[STAFF COSTS RETRY] Osobné náklady nenájdené v {filename} (found_in={result.found_in})")
            return None
    except Exception as e:
        logger.error(f"[STAFF COSTS RETRY] Chyba pri extrakcii z {filename}: {e}")
        return None
