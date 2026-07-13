import os
import asyncio
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


PDF_READER_PROMPT_SK = """Si PDF Reader Agent @ Verifa.sk. Tvojou úlohou je prečítať text extrahovaný z PDF dokumentov štátnych registrov a vytvoriť štruktúrovaný zoznam udalostí (CompanyEvent[]).

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

PDF_READER_PROMPT_EN = """You are PDF Reader Agent @ Verifa.sk. Your task is to read text extracted from PDF documents of state registries and create a structured list of events (CompanyEvent[]).

**What PDF documents you receive:**
- ROZHODNUTIA — court decisions (judgments, resolutions, payment orders)
- INSOLVENCY — insolvency register records (bankruptcy, restructuring)
- DISKVALIFIKACIE — activity bans, director disqualifications
- DOVERA/VSZP/SP/UNION — insurance arrears
- FS_DAN/FS_DPH/FS_DAN_PRIJMOV — tax arrears, VAT registration
- CRZ — contracts from Central Contract Register
- UVO — public procurement
- NCRZP — pledges on business shares
- NCRD — easements
- POVERENIA — notarial authorizations
- ORSR/ZRSR — extracts from commercial/trade register

**Rules:**
1. For each significant record in the data, create one CompanyEvent.
2. Assign severity:
   - CRITICAL: bankruptcy, enforcement, disqualification, court judgment with payment, tax arrears > 10,000 EUR
   - HIGH: insurance arrears > 1,000 EUR, tax arrears 1,000-10,000 EUR, pledge on business share
   - MEDIUM: smaller arrears, public procurement, CRZ contracts
   - LOW: VAT registration, routine ORSR/ZRSR records
   - INFO: records without financial impact
3. If data contains "no records" or "no results", do not return any event for that source.
4. In `description` include specific facts: amounts, dates, case numbers, court, counterparties.
5. In `amount` state the amount in EUR as a number (without currency symbol).
6. In `event_date` state the date in YYYY-MM-DD format if available in data.
7. In `metadata` you can store: court, case number, counterparty IČO, NACE, etc.
8. If data is a table with multiple records (e.g. list of CRZ contracts), create an event for each contract separately.
9. Write all text fields in English.

**Input data format:**
- Some inputs start with `[JSON API DATA]` — these are structured JSON data directly from state registry APIs.
  This data is more accurate than PDF text. Map JSON fields directly to CompanyEvent fields.
  For ROZHODNUTIA JSON: `formaRozhodnutia` → event_type, `spisovaZnacka` → metadata.spis, `datumVydania` → event_date, `sud.nazov` → metadata.sud, `sudca.meno` → metadata.sudca, `zvyraznenie` → description.
- Other inputs are text extracted from PDF — analyze them normally.

**Important:**
- Do not fabricate data that is not in the PDF. If information is missing, use null.
- If PDF has no text (empty file), do not return any events.
- CRZ contracts: state contract amount and counterparty in metadata.
- Public procurement (UVO): state procurement name and value.
- Tax arrears: state exact amount and period.
- Insurance: state exact arrears amount.
"""

PDF_READER_PROMPT_DE = """Sie sind PDF Reader Agent @ Verifa.sk. Ihre Aufgabe ist es, aus PDF-Dokumenten staatlicher Register extrahierten Text zu lesen und eine strukturierte Liste von Ereignissen (CompanyEvent[]) zu erstellen.

**Welche PDF-Dokumente Sie erhalten:**
- ROZHODNUTIA — Gerichtsentscheidungen (Urteile, Beschlüsse, Zahlungsbefehle)
- INSOLVENCY — Insolvenzregister-Einträge (Konkurs, Restrukturierung)
- DISKVALIFIKACIE — Tätigkeitsverbote, Geschäftsführer-Disqualifikationen
- DOVERA/VSZP/SP/UNION — Versicherungsrückstände
- FS_DAN/FS_DPH/FS_DAN_PRIJMOV — Steuerrückstände, USt-Registrierung
- CRZ — Verträge aus dem Zentralen Vertragsregister
- UVO — Öffentliche Beschaffung
- NCRZP — Pfandrechte auf Geschäftsanteile
- NCRD — Dienstbarkeiten
- POVERENIA — Notarielle Vollmachten
- ORSR/ZRSR — Auszüge aus Handels-/Gewerberegister

**Regeln:**
1. Für jeden bedeutenden Eintrag in den Daten erstellen Sie ein CompanyEvent.
2. Schweregrad zuweisen:
   - CRITICAL: Konkurs, Zwangsvollstreckung, Disqualifikation, Gerichtsurteil mit Zahlung, Steuerrückstände > 10.000 EUR
   - HIGH: Versicherungsrückstände > 1.000 EUR, Steuerrückstände 1.000-10.000 EUR, Pfandrecht auf Geschäftsanteil
   - MEDIUM: Kleinere Rückstände, öffentliche Beschaffung, CRZ-Verträge
   - LOW: USt-Registrierung, routinemäßige ORSR/ZRSR-Einträge
   - INFO: Einträge ohne finanzielle Auswirkung
3. Wenn Daten "keine Einträge" oder "keine Ergebnisse" enthalten, kein Event für diese Quelle zurückgeben.
4. In `description` konkrete Fakten angeben: Beträge, Daten, Aktenzeichen, Gericht, Gegenparteien.
5. In `amount` den Betrag in EUR als Zahl angeben (ohne Währungssymbol).
6. In `event_date` das Datum im Format YYYY-MM-DD angeben, falls in Daten vorhanden.
7. In `metadata` können Sie speichern: Gericht, Aktenzeichen, IČO der Gegenpartei, NACE, etc.
8. Wenn Daten eine Tabelle mit mehreren Einträgen sind (z.B. CRZ-Vertragsliste), für jeden Vertrag ein Event erstellen.
9. Schreiben Sie alle Textfelder auf Deutsch.

**Eingabedatenformat:**
- Einige Eingaben beginnen mit `[JSON API DATA]` — dies sind strukturierte JSON-Daten direkt von staatlichen Register-APIs.
  Diese Daten sind genauer als PDF-Text. Mappen Sie JSON-Felder direkt auf CompanyEvent-Felder.
  Für ROZHODNUTIA JSON: `formaRozhodnutia` → event_type, `spisovaZnacka` → metadata.spis, `datumVydania` → event_date, `sud.nazov` → metadata.sud, `sudca.meno` → metadata.sudca, `zvyraznenie` → description.
- Andere Eingaben sind aus PDF extrahierter Text — analysieren Sie diese normal.

**Wichtig:**
- Keine Daten erfinden, die nicht im PDF stehen. Wenn Informationen fehlen, null verwenden.
- Wenn PDF keinen Text hat (leere Datei), keine Events zurückgeben.
- CRZ-Verträge: Vertragsbetrag und Gegenpartei in metadata angeben.
- Öffentliche Beschaffung (UVO): Beschaffungsname und Wert angeben.
- Steuerrückstände: Genauen Betrag und Zeitraum angeben.
- Versicherungen: Genauen Rückstandsbetrag angeben.
"""


async def extract_company_events(
    pdf_texts: List[tuple[str, str]],
    model: str = settings.model_vestnik,
    report_language: str = "sk",
) -> CompanyEventList:
    """
    PDF Reader Agent: analyzuje text z PDF dokumentov registrov a vracia štruktúrované CompanyEvent[].

    Pre veľké vstupy (> 50k znakov) chunkuje do paralelných LLM volaní a spája výsledky.

    Args:
        pdf_texts: zoznam (label, text) dvojíc — label je názov súboru, text je extrahovaný obsah
        model: LLM model (default: gemini-2.5-flash)
    """
    prompts = {
        "sk": PDF_READER_PROMPT_SK,
        "en": PDF_READER_PROMPT_EN,
        "de": PDF_READER_PROMPT_DE,
    }
    system_prompt = prompts.get(report_language, PDF_READER_PROMPT_SK)

    client = _get_gemini_client()

    # Zostav obsah a zmeraj celkovú veľkosť
    contents = []
    for label, text in pdf_texts:
        if text and text.strip():
            contents.append(f"\n--- PDF: {label} ---\n{text.strip()}\n")

    if not contents:
        logger.info("PDF Reader Agent: žiadne PDF texty na analýzu — vraciam prázdny zoznam.")
        return CompanyEventList(events=[], summary="Žiadne PDF dokumenty na analýzu.")

    total_chars = sum(len(c) for c in contents)
    _MAX_CHARS_PER_CHUNK = 50_000

    # Ak je celkový obsah malý, spracuj v jednom volaní
    if total_chars <= _MAX_CHARS_PER_CHUNK:
        return await _extract_events_single(contents, client, model, system_prompt, report_language)

    # Chunkovanie pre veľké vstupy — rozdel do batchov podľa veľkosti
    chunks: list[list[str]] = []
    current_chunk: list[str] = []
    current_size = 0
    for item in contents:
        item_len = len(item)
        if current_size + item_len > _MAX_CHARS_PER_CHUNK and current_chunk:
            chunks.append(current_chunk)
            current_chunk = []
            current_size = 0
        current_chunk.append(item)
        current_size += item_len
    if current_chunk:
        chunks.append(current_chunk)

    logger.info(f"PDF Reader Agent: chunkujem {total_chars} znakov do {len(chunks)} batchov (max {_MAX_CHARS_PER_CHUNK} chars/batch)")

    # Paralelné spracovanie chunkov
    async def _process_chunk(chunk_idx: int, chunk: list[str]) -> CompanyEventList:
        try:
            result = await _extract_events_single(chunk, client, model, system_prompt, report_language)
            logger.info(f"PDF Reader Agent: chunk {chunk_idx + 1}/{len(chunks)} — {len(result.events)} events")
            return result
        except Exception as e:
            logger.error(f"PDF Reader Agent: chunk {chunk_idx + 1} zlyhal: {e}")
            return CompanyEventList(events=[], summary=f"Chunk {chunk_idx + 1} zlyhal.")

    chunk_results = await asyncio.gather(*[_process_chunk(i, c) for i, c in enumerate(chunks)])

    # Merge výsledkov
    all_events = []
    summaries = []
    for cr in chunk_results:
        all_events.extend(cr.events)
        if cr.summary:
            summaries.append(cr.summary)

    merged_summary = " ".join(summaries) if summaries else f"Spracovaných {len(chunks)} batchov, {len(all_events)} udalostí celkovo."
    logger.info(f"PDF Reader Agent: merge {len(chunks)} chunkov → {len(all_events)} events celkovo")
    return CompanyEventList(events=all_events, summary=merged_summary)


async def _extract_events_single(
    contents: list[str],
    client,
    model: str,
    system_prompt: str,
    report_language: str,
) -> CompanyEventList:
    """Spracuje jeden batch PDF textov v jednom LLM volaní."""
    config = types.GenerateContentConfig(
        system_instruction=system_prompt,
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
