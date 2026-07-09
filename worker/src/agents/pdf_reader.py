import os
import logging
from typing import List, Optional
from pydantic import BaseModel, Field
from google.genai import types

from src.config import settings
from src.pdf_ingestion import extract_relevant_pdf_chunks
from .shared import _get_gemini_client, _log_tokens

logger = logging.getLogger(__name__)


class CompanyEvent(BaseModel):
    source: str = Field(..., description="Zdroj: ROZHODNUTIA, INSOLVENCY, DISKVALIFIKACIE, DOVERA, VSZP, SP, UNION, FS_DAN, FS_DPH, CRZ, UVO, VESTNIK")
    event_type: str = Field(..., description="Typ: SUDNE_ROZHODNUTIE, INSOLVENCIA, DISKVALIFIKACIA, POISTOVNA_DLUH, DAN_NEDOPLATOK, VEREJNA_ZMLUVA, OBSTARAVANIE, VESTNIK_UDALOST, ZALOZNE_PRAVO, VECNE_BREMENO, POVERENIE, INE")
    severity: str = Field(..., description="CRITICAL, HIGH, MEDIUM, LOW, INFO")
    title: str = Field(..., description="Krátky názov udalosti (1-2 vety).")
    description: str = Field(..., description="Detailný popis udalosti s konkrétnymi faktami (sumy, dátumy, súd, číslo spisu).")
    event_date: Optional[str] = Field(default=None, description="Dátum udalosti vo formáte YYYY-MM-DD ak je známy.")
    amount: Optional[float] = Field(default=None, description="Finančná hodnota v EUR ak je relevantná (nedoplatok, suma zmluvy).")
    metadata: Optional[dict] = Field(default=None, description="Dodatočné dáta: súd, číslo spisu, IČO protistrany, atď.")


class CompanyEventList(BaseModel):
    events: List[CompanyEvent] = Field(default_factory=list, description="Zoznam udalostí nájdených v PDF dokumentoch.")
    summary: str = Field(..., description="Krátky súhrn všetkých zistení z PDF dokumentov (2-3 vety).")


PDF_READER_PROMPT = """Si PDF Reader Agent @ Verifa.sk. Tvojou úlohou je prečítať text extrahovaný z PDF dokumentov štátnych registrov a vytvoriť štruktúrovaný zoznam udalostí (CompanyEvent[]).

**Aké PDF dokumenty dostávaš:**
- ROZHODNUTIA — súdne rozhodnutia (rozsudky, uznesenia, platobné rozkazy)
- INSOLVENCY — záznamy z registra úpadcov (konkurz, reštrukturalizácia)
- DISKVALIFIKACIE — zákazy činnosti, diskvalifikácie konateľov
- DOVERA/VSZP/SP/UNION — nedoplatky v poisťovniach
- FS_DAN/FS_DPH/FS_DAN_PRIJMOV — daňové nedoplatky, registrácia DPH
- CRZ — zmluvy z Centrálneho registra zmlúv
- UVO — verejné obstarávanie
- NCRZP — záložné práva na obchodný podiel
- NCRD — vecné bremená
- POVERENIA — notárske poverenia
- ORSR/ZRSR — výpisy z obchodného/živnostenského registra

**Pravidlá:**
1. Pre každý významný záznam v dátach vytvor jeden CompanyEvent.
2. Severity priraďuj:
   - CRITICAL: konkurz, exekúcia, diskvalifikácia, súdny rozsudok s platením, daňový nedoplatok > 10 000 EUR
   - HIGH: nedoplatok v poisťovni > 1 000 EUR, daňový nedoplatok 1 000-10 000 EUR, záložné právo na obchodný podiel
   - MEDIUM: menšie nedoplatky, verejné obstarávanie, zmluvy z CRZ
   - LOW: registrácia DPH, bežné záznamy z ORSR/ZRSR
   - INFO: záznamy bez finančného dopadu
3. Ak dáta obsahujú "bez záznamu" alebo "žiadne výsledky", nevracaj žiadny event pre daný zdroj.
4. V `description` uveď konkrétne fakty: sumy, dátumy, čísla spisov, súd, protistrany.
5. V `amount` uveď sumu v EUR ako číslo (bez menovej značky).
6. V `event_date` uveď dátum vo formáte YYYY-MM-DD ak je v dátach.
7. V `metadata` môžeš uložiť: súd, číslo spisu, IČO protistrany, NACE, atď.
8. Ak sú dáta tabuľka s viacerými záznamami (napr. zoznam zmlúv z CRZ), vytvor event pre každú zmluvu samostatne.
9. Slovenčina vo všetkých textoch. Správne diakritika a dĺžne.

**Formát vstupných dát:**
- Niektoré vstupy začínajú `[JSON API DATA]` — to sú štruktúrované JSON dáta priamo z API štátnych registrov.
  Tieto dáta sú presnejšie ako PDF text. Mapuj JSON polia priamo na CompanyEvent fields.
  Pre ROZHODNUTIA JSON: `formaRozhodnutia` → event_type, `spisovaZnacka` → metadata.spis, `datumVydania` → event_date, `sud.nazov` → metadata.sud, `sudca.meno` → metadata.sudca, `zvyraznenie` → description.
- Ostatné vstupy sú text extrahovaný z PDF — analyzuj ich normálne.

**Dôležité:**
- Neskúšaj vymýšľať dáta, ktoré v PDF nie sú. Ak informácia chýba, použi null.
- Ak PDF nemá žiadny text (prázdny súbor), nevracaj žiadne eventy.
- Zmluvy z CRZ: uveď sumu zmluvy a protistranu v metadata.
- Verejné obstarávanie z UVO: uveď názov obstarávania a hodnotu.
- Daňové nedoplatky: uveď presnú sumu a obdobie.
- Poisťovne: uveď presnú sumu nedoplatku.
"""


async def extract_company_events(
    pdf_texts: List[tuple[str, str]],
    model: str = settings.model_vestnik,
) -> CompanyEventList:
    """
    PDF Reader Agent: analyzuje text z PDF dokumentov registrov a vracia štruktúrované CompanyEvent[].

    Args:
        pdf_texts: zoznam (label, text) dvojíc — label je názov súboru, text je extrahovaný obsah
        model: LLM model (default: gemini-2.5-flash)
    """
    client = _get_gemini_client()

    contents = []
    for label, text in pdf_texts:
        if text and text.strip():
            contents.append(f"\n--- PDF: {label} ---\n{text.strip()}\n")

    if not contents:
        logger.info("PDF Reader Agent: žiadne PDF texty na analýzu — vraciam prázdny zoznam.")
        return CompanyEventList(events=[], summary="Žiadne PDF dokumenty na analýzu.")

    config = types.GenerateContentConfig(
        system_instruction=PDF_READER_PROMPT,
        response_mime_type="application/json",
        response_schema=CompanyEventList,
        temperature=0.0,
    )

    response = await client.aio.models.generate_content(
        model=model,
        contents=contents,
        config=config,
    )
    _log_tokens(model, response.usage_metadata, "extract_company_events")
    raw = response.text or "{}"
    return CompanyEventList.model_validate_json(raw)
