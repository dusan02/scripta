import os
import logging
from pydantic import BaseModel, Field
from typing import Optional
from google import genai
from google.genai import types

logger = logging.getLogger(__name__)

# ── Cenové sádzby pre odhad nákladov (USD / 1M tokenov) ───────────────────
_PRICING: dict[str, tuple[float, float]] = {
    "gemini-2.5-flash":       (0.30,  2.50),
    "gemini-3.5-flash":       (1.50,  9.00),
    "gemini-3.1-pro-preview": (2.00, 12.00),
    "gemini-3.1-pro":         (2.00, 12.00),
}

def _log_tokens(model: str, usage, label: str) -> None:
    """Zaloguje spotrebu tokenov a odhadnuté náklady pre jedno LLM volanie."""
    if not usage:
        return
    inp = getattr(usage, "prompt_token_count", 0) or 0
    out = getattr(usage, "candidates_token_count", 0) or 0
    price_in, price_out = _PRICING.get(model, (0.0, 0.0))
    cost_usd = (inp * price_in + out * price_out) / 1_000_000
    logger.info(
        f"[LLM] {label} | model={model} "
        f"in={inp:,} out={out:,} tok "
        f"cost=${cost_usd:.5f}"
    )

class AuditorReportData(BaseModel):
    nazor_auditora: str = Field(..., description="Typ názoru: 'Bez výhrad', 'S výhradou', 'Záporný', 'Odmietnutie vyjadriť názor'.")
    going_concern_riziko: bool = Field(..., description="True, ak audítor spomína významnú neistotu týkajúcu sa going concern. Inak False.")
    auditor_vyhrady_text: Optional[str] = Field(None, description="Zhrnutie výhrad audítora, ak existujú.")

class FinancialMetrics(BaseModel):
    rok_zavierky: int = Field(...)
    celkove_aktiva: float = Field(...)
    obezny_majetok: float = Field(0, description="Obežný majetok (current assets) — zásoby, pohľadávky, krátkodobý finančný majetok. Ak chýba, vráť 0.")
    vlastne_imanie_celkom: float = Field(...)
    kratkodobe_zavazky: float = Field(...)
    trzby_z_hlavnej_cinnosti: float = Field(...)
    zisk_alebo_strata_po_zdaneni: float = Field(...)
    peniaze_a_penazne_ekvivalenty_k_31_12: float = Field(...)
    ciste_penazne_toky_z_prevadzkovej_cinnosti: float = Field(...)

class CompanyFinancialExtraction(BaseModel):
    ico: str = Field(...)
    nazov_spolocnosti: str = Field(..., description="Oficiálny názov spoločnosti.")
    audit: AuditorReportData
    metriky: FinancialMetrics

SYSTEM_PROMPT = """Si expertný finančný a forenzný audítor. Tvojou úlohou je extrahovať fakty z IFRS účtovných závierok pre potreby advokátov, ktorí preverujú bonitu protistrany a hľadajú podozrivé aktivity (tzv. biele kone) alebo riziko úpadku.

KRÍTICKÉ PRAVIDLÁ PRE ČÍSELNÉ HODNOTY:
- Všetky finančné hodnoty extrahuj V EURÁCH (nie v tisícoch ani miliónoch EUR). Ak tabuľka uvádza "v tisícach EUR", vynásob hodnotu 1000. Ak uvádza "v miliónoch EUR", vynásob 1 000 000.
- Pri číslach v zátvorkách (napr. (1500)) ich konvertuj na negatívne float hodnoty (-1500.0).
- Ak narazíš na tabuľku s dvoma stĺpcami dát (rok X a rok X-1), extrahuj prioritne stĺpec pre rok X (aktuálne účtovné obdobie).
- Nikdy nehalucinuj. Ak údaj vo výkaze chýba, vráť 0 alebo null podľa Pydantic schémy."""

async def extract_financial_data(file_path: str, model: str = "gemini-2.5-flash") -> CompanyFinancialExtraction:
    """
    Nahrá PDF súbor (napr. skenovanú závierku) do Gemini File API, a použije Multimodal model 
    na extrakciu faktov priamo z obrázkov strán podľa Pydantic schémy.
    """
    import re
    
    # Skúsime vyčítať rok priamo z názvu súboru (ak bol dodaný scraperom)
    filename = os.path.basename(file_path)
    match = re.search(r'_(\d{4})_', filename)
    expected_year = int(match.group(1)) if match else None

    # Skúsime vyčítať IČO z názvu súboru (napr. IFRS_35876832_2024_0.pdf)
    ico_match = re.search(r'IFRS_(\d{8})_', filename)
    expected_ico = ico_match.group(1) if ico_match else None

    client = genai.Client()
    
    # Upload the file to Gemini via File API
    uploaded_file = client.files.upload(file=file_path)
    
    config = types.GenerateContentConfig(
        system_instruction=SYSTEM_PROMPT,
        response_mime_type="application/json",
        response_schema=CompanyFinancialExtraction,
        temperature=0.0
    )
    
    response = await client.aio.models.generate_content(
        model=model,
        contents=[uploaded_file],
        config=config,
    )
    _log_tokens(model, response.usage_metadata, "extract_financial_data")
    # Optionally delete the file from Google servers to keep workspace clean
    # client.files.delete(name=uploaded_file.name)
    
    data = CompanyFinancialExtraction.model_validate_json(response.text)
    
    # Prepíšeme rok, ak ho LLM nenašlo (vrátilo 0), alebo ak veríme viac metadátam z RÚZ
    if expected_year and (data.metriky.rok_zavierky == 0 or data.metriky.rok_zavierky != expected_year):
        data.metriky.rok_zavierky = expected_year

    # Prepíšeme IČO, ak ho LLM nenašlo (slicing mohol odrezať stránku s IČO)
    if expected_ico and (not data.ico or data.ico.strip() in ("", "0", "N/A", "null")):
        data.ico = expected_ico

    return data

from typing import Literal, List

class VestnikExtraction(BaseModel):
    typ_udalosti: str = Field(..., description="Napr. Konkurz, Exekúcia, Zmena štatutára, atď.")
    rizikovost: Literal["LOW", "MEDIUM", "HIGH", "CRITICAL"] = Field(...)
    zhrnutie: str = Field(..., description="Stručné a jasné zhrnutie udalosti.")
    red_flags: List[str] = Field(..., description="Zoznam identifikovaných varovných signálov.")

VESTNIK_SYSTEM_PROMPT = """Si špičkový forenzný analytik so špecializáciou na slovenské obchodné právo. Tvojou úlohou je analyzovať text z Obchodného vestníka a extrahovať z neho forenzne relevantné informácie.
Pravidlá:
1. Identifikuj typ udalosti (napr. 'Zmena konateľa', 'Konkurz', 'Exekúcia').
2. Priraď 'rizikovost':
* CRITICAL: Konkurz, reštrukturalizácia, exekúcia na majetok.
* HIGH: Náhla zmena štatutára v kombinácii s inými subjektmi, zmena sídla do virtuálnej kancelárie.
* MEDIUM: Rutinné zmeny, ktoré môžu naznačovať zmenu vlastníckej štruktúry.
* LOW: Bežné administratívne zmeny.
3. Vytvor stručné, jasné 'zhrnutie'.
4. Ak text obsahuje viacero subjektov, zameraj sa primárne na sledované IČO.
5. Ak ide o zmenu konateľa, prever, či nejde o osobu figurujúcu v iných firmách (ak to z textu vyplýva)."""

async def extract_vestnik_event(text: str, model: str = "gemini-2.5-flash") -> VestnikExtraction:
    """
    Spracuje surový textový blok z XML Obchodného vestníka a vráti Pydantic objekt VestnikExtraction.
    """
    client = genai.Client()
    
    config = types.GenerateContentConfig(
        system_instruction=VESTNIK_SYSTEM_PROMPT,
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

class NarrativeRiskAnalysis(BaseModel):
    management_changes: Optional[str] = Field(description="Zmeny v štatutárnych orgánoch alebo kľúčovom manažmente a ich forenzný dopad.")
    litigation_risks: Optional[str] = Field(description="Súdne spory, exekúcie alebo právne hrozby spomenuté v texte.")
    going_concern_doubts: bool = Field(description="Indície, že firma má problémy s likviditou alebo pokračovaním v činnosti.")
    planned_investments: Optional[str] = Field(description="Plánované investície, ktoré môžu naznačovať agresívny rast alebo naopak prípravu na predaj firmy.")
    forensic_red_flags: List[str] = Field(description="Zoznam identifikovaných rizikových indikátorov v texte správy.")
    synthesis: str = Field(description="Krátka syntéza: Je táto firma v stabilnom stave, alebo vykazuje známky nestability?")

NARRATIVE_SYSTEM_PROMPT = """Si forenzný analytik so špecializáciou na podnikové výročnej správy. Tvojou úlohou je extrahovať z dokumentu len informácie, ktoré majú právnu alebo finančnú relevanciu.
Tvoje pravidlá:
1. Ignoruj marketingový balast: Preskoč pasáže o 'víziách', 'spoločenskej zodpovednosti' alebo 'spokojnosti zamestnancov', pokiaľ nemajú priamy dopad na finančnú stabilitu.
2. Hľadaj 'Going Concern' signály: Buď mimoriadne citlivý na frázy o 'pochybnostiach o schopnosti pokračovať v činnosti', 'problémoch s financovaním' alebo 'závislosti od externých úverov'.
3. Forenzný postoj: Hľadaj nesúlad medzi tým, čo firma deklaruje (plánované investície) a realitou (zhoršené cashflow z IFRS výkazov).
4. Štruktúruj výstup: Použi priloženú Pydantic schému. Ak informácia v texte chýba, vráť null alebo false, nevymýšľaj si.
5. Buď kritický: Ak firma v texte bagatelizuje súdny spor, označ to ako litigation_risks a uveď, prečo je to riziko."""

async def extract_narrative_risk(file_path: str, model: str = "gemini-3.5-flash") -> NarrativeRiskAnalysis:
    """
    Spracuje celú Výročnú správu (VS_*.pdf) bez orezávania.
    Využíva dlhý kontext Gemini na odhalenie forenzných rizík a anomálií.
    """
    client = genai.Client()
    
    # Upload the file to Gemini via File API
    uploaded_file = client.files.upload(file=file_path)
    
    config = types.GenerateContentConfig(
        system_instruction=NARRATIVE_SYSTEM_PROMPT,
        response_mime_type="application/json",
        response_schema=NarrativeRiskAnalysis,
        temperature=0.0
    )
    
    # Zvýšený timeout, pretože ide o dlhý dokument
    # V Google GenAI SDK sa to posiela štandardne, timeout by sme inak definovali na úrovni klienta/transportu,
    # ale tu stačí predvolený (býva dosť dlhý).
    response = await client.aio.models.generate_content(
        model=model,
        contents=[uploaded_file],
        config=config,
    )
    _log_tokens(model, response.usage_metadata, "extract_narrative_risk")
    return NarrativeRiskAnalysis.model_validate_json(response.text)

class AuditVerdict(BaseModel):
    verifa_score: int = Field(..., ge=0, le=100, description="Finálne skóre integrity a zdravia.")
    risk_category: Literal["AAA", "A", "B", "C", "INSUFFICIENT_DATA"]
    debt_exposure_rating: int = Field(..., ge=0, le=10, description="Hodnotenie expozície voči verejným dlhom (0=čisté, 10=katastrofa).")
    final_verdict: str = Field(..., description="Jedna veta, ktorá zhrnie verdikt pre investora/právnika.")
    zdovodnenie: str = Field(..., description="Analytické zdôvodnenie skóre vrátane identifikovaných diskrepancií medzi zdrojmi.")
    kľúčové_riziko: str = Field(..., description="Najväčšia hrozba, ktorej firma čelí.")

CHIEF_AUDITOR_PROMPT = """Si hlavný forenzný audítor Verifa.sk. Tvojou úlohou nie je extrahovať dáta, ale vykonať definitívne vyhodnotenie integrity a finančného zdravia spoločnosti na základe vstupov od troch špecializovaných analytikov (Finančný, Právny, Naratívny) a priamo na základe priložených PDF výpisov o verejných záväzkoch (Dlhy, Exekúcie).

**Dôležité inštrukcie pre hodnotenie:**
1. Ak spoločnosť nemá finančné výkazy alebo je novo založená (napr. má iba 1 rok), hodnoť skóre primerane s ohľadom na absenciu histórie (typicky priemerné skóre okolo 50-60, ak nemá iné negatíva).
2. Vo vstupe dostaneš vypočítaný blok "_5_year_trend_analysis" (ak sú dáta k dispozícii). **Striktne sa riaď týmto abstraktom pri hodnotení trendov**. Ak trend ukazuje CAGR rast, považuj firmu za zdravú. Ak trend ukazuje súvislé straty alebo indikátory úpadku (napr. vlastné imanie < 0, rastúce dlhy prevyšujúce aktíva), rázne zníž Verifa skóre a priraď vysoké riziko.
3. Neanalyzuj surové účtovné dáta za každý rok izolovane, spoliehaj sa na "_5_year_trend_analysis", ktorý zosumarizoval 5-ročný vývoj.
4. Právne riziká (exekúcie, dlhy voči štátu) z PDF súborov predstavujú kritické riziko a mali by mať výrazný vplyv na zníženie skóre.

Tvoj výstup musí byť objektívny, nekompromisný a orientovaný na riziko.

PROCES HODNOTENIA:
1. KRÍŽOVÁ KONTROLA: Porovnaj "príbeh" (Narrative) s "číslami" (Financials). Ak manažment deklaruje rast, ale finančné metriky vykazujú pokles likvidity, je to silný indikátor nedôveryhodnosti (Red Flag).
2. VÁHOVANIE RIZIKA: 
   - Právne riziká (exekúcie, konkurzy z Vestníka) majú absolútnu prioritu a radikálne znižujú skóre.
   - Nedôveryhodnosť manažmentu (zistená skeptickým analytikom) je druhým najvýznamnejším faktorom.
   - Finančná strata je vnímaná v kontexte jej trendu (dočasná strata vs. štrukturálny úpadok).
3. ANALÝZA VEREJNÝCH ZÁVÄZKOV A EXEKÚCIÍ (Z PDF súborov):
   - Pomer dlhov k likvidite: Porovnaj celkovú sumu dlhov voči poisťovniam/štátu s aktuálnou hotovosťou vo finančných výkazoch.
   - História záväzkov: Ak sú exekúcie staršieho dáta a stále trvajú, je to signál chronickej platobnej neschopnosti, nie len náhodnej chyby.
   - Záverečná penalizácia: Ak súčet exekúcií a verejných dlhov presahuje 10 % z ročných tržieb, automaticky zníž skóre na úroveň 'C' (Kritické riziko), bez ohľadu na marketingové reči vo Výročnej správe.
   - Urči `debt_exposure_rating` (0-10), kde 0 znamená žiadne alebo zanedbateľné dlhy, a 10 znamená katastrofálnu dlhovú pascu.
4. VÝPOČET SKÓRE (0-100):
   - 90-100: AAA (Excelentná kondícia, žiadne riziká).
   - 70-89: A (Stabilná firma, drobné administratívne riziká).
   - 40-69: B (Varovný stav, nutná hĺbková previerka).
   - 0-39: C (Kritické riziko, vysoká pravdepodobnosť zániku alebo podvodu).

PRAVIDLÁ VÝSTUPU:
- Musíš vyplniť Pydantic schému `AuditVerdict`.
- V poli 'zdovodnenie' musíš explicitne uviesť, prečo si pridelil dané skóre a na akú diskrepanciu medzi dátami si narazil. Ak sú dáta medzi zdrojmi (napr. IFRS výkaz a naratívna správa) v priamom konflikte, uprednostni zistenia z právnych udalostí (Vestník, verejné záväzky z PDF) a audítorskej správy, a v poli 'zdovodnenie' túto diskrepanciu explicitne pomenuj.
- Ak nemáš dostatok dát, skóre neurčuj a uveď 'INSUFFICIENT_DATA'."""

import asyncio

async def evaluate_audit_verdict(data_json: str, debt_pdfs: list[str], model: str = "gemini-3.1-pro-preview") -> AuditVerdict:
    """
    Vykoná agregovanú analýzu (Chief Auditor) nad všetkými zozbieranými JSON dátami a textom extrahovaným z PDF súborov registrov.
    """
    import fitz

    client = genai.Client()

    # Príprava obsahu - začneme JSON dátami
    contents = [data_json]

    # Lokálne extrahujeme text z PDF súborov (namiesto nahrávania do Gemini File API)
    # Toto ušetrí ~100s nahrávania a čakania na processing.
    for pdf_path in debt_pdfs:
        try:
            doc = fitz.open(pdf_path)
            pdf_text = ""
            for page in doc:
                pdf_text += page.get_text("text")
            doc.close()

            if pdf_text.strip():
                label = os.path.basename(pdf_path)
                contents.append(f"\n--- PDF: {label} ---\n{pdf_text.strip()}\n")
        except Exception as e:
            logger.warning(f"Nepodarilo sa extrahovať text z {pdf_path}: {e}")
    
    config = types.GenerateContentConfig(
        system_instruction=CHIEF_AUDITOR_PROMPT,
        response_mime_type="application/json",
        response_schema=AuditVerdict,
        temperature=0.0
    )
    
    response = await client.aio.models.generate_content(
        model=model,
        contents=contents,
        config=config,
    )
    _log_tokens(model, response.usage_metadata, "evaluate_audit_verdict")
    return AuditVerdict.model_validate_json(response.text)

