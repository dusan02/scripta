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

SYSTEM_PROMPT = """Si expertný finančný a forenzný audítor. Tvojou úlohou je extrahovať fakty z účtovných závierok (vrátane IFRS, národných štandardov a Mikro účtovných jednotiek - Úč MUJ) pre potreby advokátov, ktorí preverujú bonitu protistrany a hľadajú podozrivé aktivity (tzv. biele kone) alebo riziko úpadku.

KRÍTICKÉ PRAVIDLÁ PRE ČÍSELNÉ HODNOTY:
- Všetky finančné hodnoty extrahuj V EURÁCH (nie v tisícoch ani miliónoch EUR). Ak tabuľka uvádza "v tisícach EUR", vynásob hodnotu 1000. Ak uvádza "v miliónoch EUR", vynásob 1 000 000.
- Pri číslach v zátvorkách (napr. (1500)) ich konvertuj na negatívne float hodnoty (-1500.0).
- Ak narazíš na tabuľku s dvoma stĺpcami dát (rok X a rok X-1), extrahuj prioritne stĺpec pre rok X (aktuálne účtovné obdobie).
- Aj keď sa jedná o malú s.r.o. (Mikro účtovná jednotka) a dokument nemá hlavičku IFRS, MUSÍŠ extrahovať hodnoty do príslušných polí (Tržby, Zisk, Aktíva...). Neodmietaj extrakciu len preto, že to nie je IFRS!
- Malé firmy (Úč MUJ) NEPOTREBUJÚ audítora. Ak v dokumente nie je správa audítora, nastav `nazor_auditora` VŽDY na 'Bez výhrad' a nevykazuj žiadne výhrady ani going concern riziká.
- Malé firmy často nevykazujú "čisté peňažné toky z prevádzkovej činnosti" (Cash flow). Ak tento údaj v dokumente (Súvahe/Výkaze) nenájdeš, doplň nulu, ale NEPOVAŽUJ to za negatívny indikátor v ďalších analýzach.
- Nikdy nehalucinuj. Ak iný údaj vo výkaze skutočne chýba, vráť 0 alebo null podľa Pydantic schémy."""

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
    
    # Vždy prepíšeme rok a IČO metadátami z RÚZ (názvu súboru), ak sú k dispozícii.
    # Zamedzíme tým ukladaniu pod IČO audítora (napr. KPMG 31348238).
    if expected_year:
        data.metriky.rok_zavierky = expected_year

    if expected_ico:
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
    profitability_explanation: Optional[str] = Field(default=None, description="Vysvetlenie manažmentu k výkyvom v ziskovosti a cash-flow.")
    forensic_red_flags: List[str] = Field(description="Zoznam identifikovaných rizikových indikátorov v texte správy.")
    synthesis: str = Field(description="Krátka syntéza: Je táto firma v stabilnom stave, alebo vykazuje známky nestability?")

NARRATIVE_SYSTEM_PROMPT = """Si forenzný analytik so špecializáciou na podnikové výročnej správy. Tvojou úlohou je extrahovať z dokumentu len informácie, ktoré majú právnu alebo finančnú relevanciu.
Tvoje pravidlá:
1. Ignoruj marketingový balast: Preskoč pasáže o 'víziách', 'spoločenskej zodpovednosti' alebo 'spokojnosti zamestnancov', pokiaľ nemajú priamy dopad na finančnú stabilitu.
2. Hľadaj 'Going Concern' signály: Buď mimoriadne citlivý na frázy o 'pochybnostiach o schopnosti pokračovať v činnosti', 'problémoch s financovaním' alebo 'závislosti od externých úverov'.
3. Forenzný postoj: Hľadaj nesúlad medzi tým, čo firma deklaruje (plánované investície) a realitou (zhoršené cashflow z IFRS výkazov).
4. Štruktúruj výstup: Použi priloženú Pydantic schému. Ak informácia v texte chýba, vráť null alebo false, nevymýšľaj si.
5. Buď kritický: Ak firma v texte bagatelizuje súdny spor, označ to ako litigation_risks a uveď, prečo je to riziko.
6. Analyzuj výkyvy zisku: Hľadaj pasáže, kde manažment vysvetľuje zníženie zisku alebo cash-flow. Ak firma vykazuje dlhodobú ziskovosť, hľadaj náznaky budúcich rizík (napr. zmena trhu, strata kľúčového zákazníka)."""

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

class EvidenceItem(BaseModel):
    tvrdenie: str = Field(..., description="Tvrdenie o riziku alebo fakte.")
    dokaz: str = Field(..., description="Konkrétne číslo alebo fakt z dát (napr. z výkazov alebo z PDF).")
    zdroj: str = Field(..., description="Zdroj informácie (napr. názov súboru, 'analytics' alebo 'Vestník').")

class AuditVerdict(BaseModel):
    verifa_score: int = Field(..., ge=0, le=100, description="Finálne skóre integrity a zdravia.")
    risk_category: Literal["AAA", "A", "B", "C", "INSUFFICIENT_DATA"]
    debt_exposure_rating: int = Field(..., ge=0, le=10, description="Hodnotenie expozície voči verejným dlhom (0=čisté, 10=katastrofa).")
    final_verdict: str = Field(..., description="Jedna veta, ktorá zhrnie verdikt pre investora/právnika.")
    zdovodnenie: list[EvidenceItem] = Field(..., description="Analytické zdôvodnenie skóre. Zoznam tvrdení, dôkazov a zdrojov.")
    kľúčové_riziko: str = Field(..., description="Najväčšia hrozba, ktorej firma čelí.")

CHIEF_AUDITOR_PROMPT = """Si hlavný forenzný audítor Verifa.sk. Tvojou úlohou nie je extrahovať dáta, ale vykonať definitívne vyhodnotenie integrity a finančného zdravia spoločnosti na základe vstupov od troch špecializovaných analytikov (Finančný, Právny, Naratívny) a priamo na základe priložených PDF výpisov o verejných záväzkoch (Dlhy, Exekúcie).

**Dôležité inštrukcie pre hodnotenie:**
1. Vo vstupe dostaneš '_5_year_trend_analysis' -> 'algorithmic_prescore'. **Toto je Základná Scorecard (Hard Score)**, ktorú vypočítal algoritmus z finančných výkazov a Vestníka. Tvojou úlohou je toto skóre **potvrdiť alebo upraviť o max +/- 10 bodov** na základe tvojho forenzného úsudku.
2. **VÝNIMKA PRE PDF DÁTA:** Keďže algoritmus nevidí do priložených PDF súborov s dlhmi, máš povinnosť z tohto skóre strhnúť **-30 bodov**, ak v PDFkách objavíš aktívne exekúcie alebo chronické dlhy voči štátu. 
   - *Pozor:* Ak je v `vestnikEvents` už evidovaná exekúcia alebo konkurz (z ktorej Python odrátal body a prescore je nízke), znova ich neodpočítavaj z PDF súborov, aby nedošlo k dvojitej penalizácii.
3. Ak nájdeš exekúciu alebo vážny dlh voči štátu, automaticky zmeň odporúčanie na 'NEODPORÚČA SA OBCHODOVAŤ' v poli `final_verdict` bez ohľadu na to, aké vysoké bolo pôvodné skóre alebo zisk.
4. Ak spoločnosť nemá finančné výkazy alebo je novo založená, `algorithmic_prescore` bude zrejme nízke alebo chýbať, hodnoť primerane (okolo 50).
5. Zlaté klietky (Riziko tunelovania): Ak vidíš rast tržieb, ale výrazný pokles hotovosti a rast záväzkov voči prepojeným osobám, uprav skóre smerom nadol v rámci svojho limitu.

Tvoj výstup musí byť objektívny, nekompromisný a orientovaný na riziko.

PROCES HODNOTENIA:
1. KRÍŽOVÁ KONTROLA: Porovnaj "príbeh" (Narrative) s "číslami" (Financials). Zohľadni aj profitability_explanation. 
2. ANALÝZA VEREJNÝCH ZÁVÄZKOV A EXEKÚCIÍ (Z PDF súborov):
   - Pomer dlhov k likvidite: Porovnaj celkovú sumu dlhov voči poisťovniam/štátu s aktuálnou hotovosťou vo finančných výkazoch.
   - História záväzkov: Ak sú exekúcie staršieho dáta a stále trvajú, je to signál chronickej platobnej neschopnosti, nie len náhodnej chyby.
   - Urči `debt_exposure_rating` (0-10), kde 0 znamená žiadne alebo zanedbateľné dlhy, a 10 znamená katastrofálnu dlhovú pascu.
3. VÝPOČET SKÓRE (0-100):
   - Vezmi `algorithmic_prescore`.
   - Pridaj/Odober max 10 bodov podľa forenzného úsudku.
   - Odober 30 bodov, ak sú v PDF objavené vážne exekúcie/dlhy (a neboli už započítané v prescore).
   - Priraď kategóriu rizika (90-100: AAA, 70-89: A, 40-69: B, 0-39: C).

PRAVIDLÁ VÝSTUPU:
- Musíš vyplniť Pydantic schému `AuditVerdict`.
- V poli 'zdovodnenie' vrátiš zoznam objektov `EvidenceItem`. 
- V každom `EvidenceItem` musíš explicitne uviesť: 
  Tvrdenie (tvoj záver), Dôkaz (konkrétne číslo alebo fakt) a Zdroj (z ktorého PDF/poľa to máš).
- Ak sa tvoje skóre líši od 'algorithmic_prescore', vysvetli dôvod v jednom z bodov (napríklad penalizácia za PDF dlhy).
- Ak nemáš dostatok dát (napr. chýbajúce PDF súbory pre dané IČO), skóre neurčuj a uveď 'INSUFFICIENT_DATA'."""

import asyncio

async def evaluate_audit_verdict(data_json: str, debt_pdfs: list[str], model: str = "gemini-2.5-flash") -> AuditVerdict:
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

