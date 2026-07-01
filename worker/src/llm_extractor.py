import os
import logging
from pydantic import BaseModel, Field
from typing import Optional
from google import genai
from google.genai import types

from src.config import settings

logger = logging.getLogger(__name__)

def _log_tokens(model: str, usage, label: str) -> None:
    """Zaloguje spotrebu tokenov a odhadnuté náklady pre jedno LLM volanie."""
    if not usage:
        return
    inp = getattr(usage, "prompt_token_count", 0) or 0
    out = getattr(usage, "candidates_token_count", 0) or 0
    price_in, price_out = settings.llm_pricing.get(model, (0.0, 0.0))
    cost_usd = (inp * price_in + out * price_out) / 1_000_000
    logger.info(
        f"[LLM] {label} | model={model} "
        f"in={inp:,} out={out:,} tok "
        f"cost=${cost_usd:.5f}"
    )

class AuditorReportData(BaseModel):
    nazor_auditora: str = Field(..., description="Typ názoru: 'Bez výhrad', 'S výhradou', 'Záporný', 'Odmietnutie vyjadriť názor'.")
    going_concern_riziko: bool = Field(..., description="True, ak audítor spomína významnú neistotu týkajúcu sa going concern. Inak False.")
    auditor_vyhrady_text: Optional[str] = Field(..., description="Zhrnutie výhrad audítora, ak existujú.")

class FinancialMetrics(BaseModel):
    rok_zavierky: int = Field(...)
    celkove_aktiva: Optional[float] = Field(..., description="Celkové aktíva (Total assets). Ak údaj chýba v závierke, vráť null.")
    obezny_majetok: Optional[float] = Field(..., description="Obežný majetok (current assets) — zásoby, pohľadávky, krátkodobý finančný majetok. Ak chýba, vráť null.")
    vlastne_imanie_celkom: Optional[float] = Field(..., description="Vlastné imanie celkom (Total equity). Ak chýba, vráť null.")
    kratkodobe_zavazky: Optional[float] = Field(..., description="Krátkodobé záväzky (Short-term liabilities). Ak chýba, vráť null.")
    dlhodobeZavazky: Optional[float] = Field(..., description="Dlhodobé záväzky (long-term liabilities) — bankové úvery, dlhopisy, lízingové záväzky > 1 rok. Ak chýba, vráť null.")
    trzby_z_hlavnej_cinnosti: Optional[float] = Field(..., description="Tržby z hlavnej činnosti (Revenue/Turnover). Ak chýba, vráť null.")
    hruba_marza: Optional[float] = Field(..., description="Hrubý zisk = Tržby - Náklady na predaný tovar (COGS). Ak chýba, vráť null.")
    zisk_alebo_strata_po_zdaneni: Optional[float] = Field(..., description="Čistý zisk alebo strata (Net profit/loss). Ak chýba, vráť null.")
    peniaze_a_penazne_ekvivalenty_k_31_12: Optional[float] = Field(..., description="Peniaze a peňažné ekvivalenty (Cash and equivalents). Ak chýba, vráť null.")
    ciste_penazne_toky_z_prevadzkovej_cinnosti: Optional[float] = Field(..., description="Čisté peňažné toky z prevádzkovej činnosti (Operating cash flow). Ak chýba, vráť null.")
    osobne_naklady: Optional[float] = Field(..., description="Personálne/osobné náklady (Staff costs). Ak chýba, vráť null.")
    pohladavky_z_obchodneho_styku: Optional[float] = Field(..., description="Pohľadávky z obchodného styku (Trade receivables). Ak chýba, vráť null.")
    zavazky_z_obchodneho_styku: Optional[float] = Field(..., description="Záväzky z obchodného styku (Trade payables). Ak chýba, vráť null.")
    mena: str = Field(..., description="Mena výkazu: 'EUR', 'CZK', 'USD'. Ak výkaz uvádza 'v tisícoch EUR', mena je stále EUR.")
    typ_zavierky: str = Field(..., description="Typ závierky: 'IFRS' ak dokument explicitne uvádza IFRS, 'MICRO' pre Úč MUJ mikro jednotky, inak 'SK_GAAP'.")
    pocet_mesiacov_obdobia: Optional[int] = Field(..., description="Zisti počet mesiacov (od - do) na prvej strane dokumentu. Dôkladne zisti, či výkaz pokrýva 12 mesiacov alebo kratšie/dlhšie obdobie. Ak to nie je možné určiť, vráť null.")
    is_consolidated: bool = Field(..., description="Dôkladne prever prvú stranu. True ak ide o konsolidovanú závierku (hľadaj slová 'konsolidovaná', 'consolidated'). Zbystri pozornosť ak názov firmy obsahuje 'Holding' alebo 'Group'. Ak je to individuálna (samostatná) závierka, vráť False.")

class CompanyFinancialExtraction(BaseModel):
    ico: str = Field(...)
    nazov_spolocnosti: str = Field(..., description="Oficiálny názov spoločnosti.")
    audit: AuditorReportData
    metriky: FinancialMetrics

SYSTEM_PROMPT = """Si expertný Finančný analytik Verifa.sk. Tvojou úlohou je extrahovať fakty z účtovných závierok (vrátane IFRS, národných štandardov a Mikro účtovných jednotiek - Úč MUJ) pre potreby advokátov, ktorí preverujú bonitu protistrany a hľadajú podozrivé aktivity (tzv. biele kone) alebo riziko úpadku.

UPOZORNENIE PRE ANGLICKÉ IFRS ZÁVIERKY:
Mnoho veľkých a nadnárodných spoločností (ako napr. OMV) zverejňuje IFRS závierky výlučne v anglickom jazyku. Ak je dokument v angličtine, aktívne vyhľadávaj anglické ekvivalenty pre požadované metriky (napr. Total Assets pre aktíva, Revenue/Turnover pre tržby, Net Profit/Loss pre zisk, Total Equity pre vlastné imanie). Neextrahuj nuly len preto, že nenájdeš slovenské pojmy! Dôkladne prezri PDF.

KRÍTICKÉ PRAVIDLÁ PRE ČÍSELNÉ HODNOTY:
- Všetky finančné hodnoty extrahuj V EURÁCH (nie v tisícoch ani miliónoch EUR). Ak tabuľka uvádza "v tisícoch EUR" (alebo anglicky "in thousands of EUR" / "EUR '000" / "in ths. EUR"), vynásob hodnotu 1000. Ak uvádza "v miliónoch EUR" (alebo "in millions of EUR" / "EUR mn"), vynásob 1 000 000.
- VÝNIMKA MENA: Ak je výkaz v CZK alebo USD (nie EUR), extrahuj čísla bez konverzie a nastav pole `mena` na 'CZK' alebo 'USD'. Ak je výkaz v EUR, nastav `mena` na 'EUR'.
- Pri číslach v zátvorkách (napr. (1500)) ich konvertuj na negatívne float hodnoty (-1500.0).
- Ak narazíš na tabuľku s dvoma stĺpcami dát (rok X a rok X-1), extrahuj prioritne stĺpec pre rok X (aktuálne účtovné obdobie).
- Aj keď sa jedná o malú s.r.o. (Mikro účtovná jednotka) a dokument nemá hlavičku IFRS, MUSÍŠ extrahovať hodnoty do príslušných polí (Tržby, Zisk, Aktíva...). Neodmietaj extrakciu len preto, že to nie je IFRS!
- Malé firmy (Úč MUJ) NEPOTREBUJÚ audítora. Ak v dokumente nie je správa audítora, nastav `nazor_auditora` VŽDY na 'Bez výhrad' a nevykazuj žiadne výhrady ani going concern riziká.
- Malé firmy často nevykazujú "čisté peňažné toky z prevádzkovej činnosti" (Cash flow). Ak tento údaj v dokumente (Súvahe/Výkaze) nenájdeš, doplň nulu, ale NEPOVAŽUJ to za negatívny indikátor v ďalších analýzach.

PRAVIDLÁ PRE NOVÉ POLIA A FORENZNÉ INDIKÁTORY:
- `dlhodobeZavazky` (Long-term liabilities): Hľadaj v Pasívach: "Dlhodobé záväzky", "Long-term borrowings", "Non-current liabilities", "Bonds payable", "Long-term loans".
- `hruba_marza` (Gross profit): V SK GAAP = Obchodná marža + Výrobná spotreba; v IFRS = Revenue - Cost of sales.
- `osobne_naklady` (Staff costs): Hľadaj "Osobné náklady", "Mzdové náklady". Slúži na detekciu schránkových firiem.
- `pohladavky_z_obchodneho_styku` a `zavazky_z_obchodneho_styku`: Hľadaj Trade receivables / Trade payables. Kľúčové pre likviditu.
- `typ_zavierky`: Nastav 'IFRS' ak dokument uvádza 'International Financial Reporting Standards' alebo 'IFRS'. Nastav 'MICRO' pre Úč MUJ mikro jednotky. Inak nastav 'SK_GAAP'.
- Nikdy nehalucinuj. Ak položka v závierke neexistuje alebo nie je uvedená, vráť null. Ak je fyzicky uvedená 0, vráť 0."""



async def extract_financial_data(file_path: str, model: str = settings.model_ifrs) -> CompanyFinancialExtraction:
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

    client = genai.Client(api_key=os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY"))
    
    # Upload the file to Gemini via File API
    uploaded_file = client.files.upload(file=file_path)
    
    config = types.GenerateContentConfig(
        system_instruction=SYSTEM_PROMPT,
        response_mime_type="application/json",
        response_schema=CompanyFinancialExtraction,
        temperature=0.0
    )
    
    try:
        response = await client.aio.models.generate_content(
            model=model,
            contents=[uploaded_file],
            config=config,
        )
        _log_tokens(model, response.usage_metadata, "extract_financial_data")
    finally:
        # Vždy vymazať súbor z Google serverov, aby sa neplatilo za zbytočný storage
        try:
            client.files.delete(name=uploaded_file.name)
        except Exception as e:
            logger.warning(f"Nepodarilo sa vymazať súbor z Gemini: {e}")
    
    data = CompanyFinancialExtraction.model_validate_json(response.text)
    
    # Sanity Check: Order of magnitude error (v tisícoch alebo miliónoch EUR odignorované)
    m = data.metriky
    if m.typ_zavierky != 'MICRO' and m.celkove_aktiva is not None:
        multiplier = 1
        if 0 < m.celkove_aktiva < 100 and m.typ_zavierky == 'IFRS' and (m.trzby_z_hlavnej_cinnosti is not None and m.trzby_z_hlavnej_cinnosti > 0):
            logger.warning(f"Sanity Check [ICO={expected_ico}]: celkove_aktiva={m.celkove_aktiva} je pod 100. LLM odignorovalo 'v miliónoch'. Násobím hodnoty x1000000.")
            multiplier = 1_000_000
        elif 0 < m.celkove_aktiva < 10000 and (m.trzby_z_hlavnej_cinnosti is not None and m.trzby_z_hlavnej_cinnosti > 0):
            logger.warning(f"Sanity Check [ICO={expected_ico}]: celkove_aktiva={m.celkove_aktiva} je pod 10,000. LLM odignorovalo 'v tisícoch'. Násobím hodnoty x1000.")
            multiplier = 1_000
            
        if multiplier > 1:
            if m.celkove_aktiva is not None: m.celkove_aktiva *= multiplier
            if m.obezny_majetok is not None: m.obezny_majetok *= multiplier
            if m.vlastne_imanie_celkom is not None: m.vlastne_imanie_celkom *= multiplier
            if m.kratkodobe_zavazky is not None: m.kratkodobe_zavazky *= multiplier
            if m.dlhodobeZavazky is not None: m.dlhodobeZavazky *= multiplier
            if m.trzby_z_hlavnej_cinnosti is not None: m.trzby_z_hlavnej_cinnosti *= multiplier
            if m.hruba_marza is not None: m.hruba_marza *= multiplier
            if m.zisk_alebo_strata_po_zdaneni is not None: m.zisk_alebo_strata_po_zdaneni *= multiplier
            if m.peniaze_a_penazne_ekvivalenty_k_31_12 is not None: m.peniaze_a_penazne_ekvivalenty_k_31_12 *= multiplier
            if m.ciste_penazne_toky_z_prevadzkovej_cinnosti is not None: m.ciste_penazne_toky_z_prevadzkovej_cinnosti *= multiplier
            if m.osobne_naklady is not None: m.osobne_naklady *= multiplier
            if m.pohladavky_z_obchodneho_styku is not None: m.pohladavky_z_obchodneho_styku *= multiplier
            if m.zavazky_z_obchodneho_styku is not None: m.zavazky_z_obchodneho_styku *= multiplier

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

VESTNIK_SYSTEM_PROMPT = """Si expertný Finančný analytik Verifa.sk. Tvojou úlohou je analyzovať text z Obchodného vestníka a extrahovať z neho forenzne relevantné informácie.
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

async def extract_vestnik_event(text: str, model: str = settings.model_vestnik) -> VestnikExtraction:
    """
    Spracuje surový textový blok z XML Obchodného vestníka a vráti Pydantic objekt VestnikExtraction.
    """
    client = genai.Client(api_key=os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY"))
    
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
3. Forenzný postoj: Hľadaj nesúlad medzi tým, čo firma deklaruje (plánované investície) a realitou (zhoršené cashflow z IFRS výkazov).
4. Štruktúruj výstup: Použi priloženú Pydantic schému. Ak informácia v texte chýba, vráť null alebo false, nevymýšľaj si.
5. Buď kritický: Ak firma v texte bagatelizuje súdny spor, označ to ako litigation_risks a uveď, prečo je to riziko.
6. Analyzuj výkyvy zisku: Hľadaj pasáže, kde manažment vysvetľuje zníženie zisku alebo cash-flow. Ak firma vykazuje dlhodobú ziskovosť, hľadaj náznaky budúcich rizík (napr. zmena trhu, strata kľúčového zákazníka)."""

async def extract_narrative_risk(file_path: str, model: str = settings.model_narrative) -> NarrativeRiskAnalysis:
    """
    Spracuje Výročnú správu (VS_*.pdf). V predvolenom nastavení sa PDF orezáva na prvých
    ~15 strán (manažérska správa) v `pipeline.py`, aby sa ušetrili tokeny a zrýchlilo 
    vyhodnocovanie cez model 2.5-flash.
    """
    client = genai.Client(api_key=os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY"))
    
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
    try:
        response = await client.aio.models.generate_content(
            model=model,
            contents=[uploaded_file],
            config=config,
        )
        _log_tokens(model, response.usage_metadata, "extract_narrative_risk")
    finally:
        # Vždy vymazať súbor z Google serverov pre úsporu nákladov na storage
        try:
            client.files.delete(name=uploaded_file.name)
        except Exception as e:
            logger.warning(f"Nepodarilo sa vymazať súbor z Gemini: {e}")
    return NarrativeRiskAnalysis.model_validate_json(response.text)

class EvidenceItem(BaseModel):
    tvrdenie: str = Field(..., description="Stručné tvrdenie (napr. 'Firma má aktívne exekúcie', 'Silný rast tržieb', 'Nízka likvidita')")
    dokaz: str = Field(..., description="Konkrétny dôkaz a hodnota (napr. '2 aktívne záznamy od 12.5.2023', 'CAGR +15% YoY')")
    zdroj: str = Field(..., description="Názov sekcie alebo registra (napr. 'Slovenská komora exekútorov', 'Analýza trendov')")
    impact: Literal["POSITIVE", "NEUTRAL", "WARNING", "CRITICAL"] = Field(..., description="Závažnosť zistenia.")

class NotesRiskAnalysis(BaseModel):
    related_party_transactions: Optional[str] = Field(..., description="Akékoľvek zmienky o pôžičkách spoločníkom, prepojeným firmám alebo neštandardných nákupoch služieb od spriaznených osôb.")
    off_balance_sheet_liabilities: Optional[str] = Field(..., description="Podsúvahové záväzky (ručenia, vystavené bankové záruky, lízingové garancie).")
    contingent_risks: Optional[str] = Field(..., description="Prebiehajúce súdne spory a potenciálne záväzky z nich plynúce.")

NOTES_SYSTEM_PROMPT = """Si expertný Forenzný analytik. Analyzuješ "Poznámky k účtovnej závierke" (Notes).
Tvojou jedinou úlohou je odhaliť riziká tunelovania, skrytých dlhov a právnych hrozieb, ktoré sa nepíšu priamo v číslach.
1. Zameraj sa primárne na "Transakcie so spriaznenými osobami" (Related Party Transactions). Hľadaj, komu firma požičiava peniaze (vlastníkom, dcérskym firmám) a od koho nakupuje manažérske služby. Toto je najčastejšia metóda tunelovania.
2. Hľadaj podsúvahové záväzky (garancie za iné firmy).
3. Hľadaj prebiehajúce súdne spory (contingent liabilities).
Ak v texte nenájdeš nič relevantné, vráť null. Nikdy si nevymýšľaj."""

async def extract_notes_risks(file_path: str, model: str = settings.model_narrative) -> NotesRiskAnalysis:
    """Extrahuje riziká z Poznámok k závierke (Related party transactions, atď)."""
    client = genai.Client(api_key=os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY"))
    uploaded_file = client.files.upload(file=file_path)
    config = types.GenerateContentConfig(
        system_instruction=NOTES_SYSTEM_PROMPT,
        response_mime_type="application/json",
        response_schema=NotesRiskAnalysis,
        temperature=0.0
    )
    try:
        response = await client.aio.models.generate_content(
            model=model,
            contents=[uploaded_file],
            config=config,
        )
        _log_tokens(model, response.usage_metadata, "extract_notes_risks")
    finally:
        try:
            client.files.delete(name=uploaded_file.name)
        except Exception:
            pass
    return NotesRiskAnalysis.model_validate_json(response.text)

class AuditVerdict(BaseModel):
    verifa_score: int = Field(..., ge=0, le=100, description="Finálne skóre integrity a zdravia.")
    risk_category: Literal["AAA", "A", "B", "C", "INSUFFICIENT_DATA"]
    debt_exposure_rating: int = Field(..., ge=0, le=10, description="Hodnotenie expozície voči verejným dlhom (0=čisté, 10=katastrofa).")
    executive_summary: str = Field(..., description="Hlboká korelačná analýza a forenzná syntéza. Prepoj finančné anomálie so zisteniami z registrov do pútavého odstavca.")
    final_verdict: str = Field(..., description="Jedna veta, ktorá zhrnie objektívny stav spoločnosti. Striktne sa vyhni subjektívnym obchodným či investičným odporúčaniam (nepoužívaj 'Odporúčame/Neodporúčame spoluprácu'). Zhodnoť výlučne fakty a mieru rizika (napr. 'Spoločnosť vykazuje stabilné finančné zdravie s nízkym rizikom' alebo 'Kriticky rizikový stav kvôli prebiehajúcim exekúciám').")
    zdovodnenie: list[EvidenceItem] = Field(..., description="Analytické zdôvodnenie skóre. Zoznam tvrdení, dôkazov a zdrojov.")
    kľúčové_riziko: str = Field(..., description="Najväčšia hrozba, ktorej firma čelí.")

CHIEF_AUDITOR_PROMPT = """Si Forenzný Sudca Verifa.sk. Tvojou úlohou nie je extrahovať dáta, ale vykonať definitívne vyhodnotenie integrity a finančného zdravia spoločnosti na základe podkladov od Finančného analytika a priamo na základe priložených PDF výpisov o verejných záväzkoch (Dlhy, Exekúcie).

**NOVÝ 5-PILIEROVÝ SCORECARD MODEL:**
Algoritmické skóre (algorithmic_prescore) bolo vypočítané pomocou 5-pilierového modelu:
  1. Platobná schopnosť & Exekúcie  (max 30 bodov) — current ratio, vlastné imanie, kritické udalosti vo Vestníku
  2. Finančné zdravie – Altman Z''  (max 25 bodov) — Z'' skóre (SAFE/GREY/DISTRESS, lineárna škála), Debt/Equity ratio
  3. Ziskovosť & Stabilita          (max 20 bodov) — počet ziskových rokov, po-sebe idúce straty, čistá marža
  4. Rast & Trendová sila           (max 15 bodov) — CAGR tržieb, rast vlastného imania YoY, pokles tržieb
  5. Právna bezúhonnosť             (max 10 bodov) — závažnosť udalostí vo Vestníku, audítorský posudok

Podrobný rozpis skóre (scorecard_breakdown) a historické dáta nájdeš v priloženej sekcii s trendmi. Pri tvorbe zdôvodnenia píš prirodzeným, ľudským jazykom a NIKDY do textu nevypisuj technické názvy premenných (ako napr. _5_year_trend_analysis alebo revenue_trend).

**Dôležité inštrukcie pre hodnotenie:**
1. `algorithmic_prescore` je výsledok deterministického 5-pilierového modelu. Tvojou úlohou je toto skóre **potvrdiť alebo upraviť o max ±10 bodov** na základe tvojho forenzného úsudku z naratívnych a právnych dát.
2. **VÝNIMKA PRE PDF DÁTA:** Keďže algoritmus nevidí do priložených PDF súborov s dlhmi, máš povinnosť z tohto skóre strhnúť **-30 bodov**, ak v PDFkách objavíš aktívne exekúcie alebo chronické dlhy voči štátu.
   - *Pozor:* Ak je v `vestnikEvents` už evidovaná exekúcia alebo konkurz (z ktorej algoritmus v Pilieri 1 a 5 odrátal body), znova ich neodpočítavaj z PDF súborov, aby nedošlo k dvojitej penalizácii.
3. Ak nájdeš exekúciu alebo vážny dlh voči štátu, automaticky označ stav spoločnosti za 'KRITICKY RIZIKOVÝ' v poli `final_verdict` bez ohľadu na to, aké vysoké bolo pôvodné skóre. Prísne sa ale vyhni akýmkoľvek radám o tom, či s firmou obchodovať alebo nie.
4. Ak spoločnosť nemá finančné výkazy alebo je novo založená, niektoré piliere budú mať neutrálnu hodnotu (N/A). Hodnoť primerane (okeolo 50).
5. Zlaté klietky (Riziko tunelovania): Ak vidíš rast tržieb, ale výrazný pokles hotovosti a rast záväzkov voči prepojeným osobám, uprav skóre smerom nadol v rámci svojho limitu.

PROCES HODNOTENIA A SYNTÉZY:
1. KRÍŽOVÁ KONTROLA A SYNTÉZA (Executive Summary):
   - Tvojou najdôležitejšou úlohou je prepojiť izolované dáta do súvislostí v poli `executive_summary`.
   - Nehádž na seba len fakty ("Firma má zisk. Firma má exekúciu."). Vysvetli anomálie!
   - Príklad anomálie: "Hoci spoločnosť vykazuje stámiliónové tržby a vyhráva verejné obstarávania, z účtovnej závierky vyplýva, že nemá žiadnych zamestnancov (0 € osobné náklady) a všetok zisk sa prelieva do spriaznených firiem formou pôžičiek."
   - Ak v dátach z Poznámok (NotesRisk) nájdeš transakcie so spriaznenými osobami, okamžite to prepoj s rastom dlhov alebo poklesom hotovosti.
2. ANALÝZA VEREJNÝCH ZÁVÄZKOV A EXEKÚCIÍ (Z PDF súborov):
   - Pomer dlhov k likvidite: Porovnaj celkovú sumu dlhov voči poisťovniam/štátu s aktuálnou hotovosťou.
   - História záväzkov: Ak sú exekúcie staršieho dáta a stále trvajú, je to signál chronickej platobnej neschopnosti.
   - Urči `debt_exposure_rating` (0-10), kde 0 = žiadne dlhy, 10 = katastrofálna dlhová pasca.
3. VÝPOČET FINÁLNEHO SKÓRE (0-100):
   - Vezmi `algorithmic_prescore` (výsledok 5-pilierového modelu, rozsah 0–100).
   - Pridaj/Odober max ±10 bodov podľa forenzného úsudku (naratíva, právne riziká, PDF analýza).
   - Odober -30 bodov, ak sú v PDF objavené vážne exekúcie/dlhy (a neboli už zachytené v Pilieri 1 prescore).
   - Priraď kategóriu rizika: 90–100 = AAA, 70–89 = A, 40–69 = B, 0–39 = C.

PRAVIDLÁ VÝSTUPU:
- Musíš vyplniť Pydantic schému `AuditVerdict`.
- V poli 'zdovodnenie' vrátiš zoznam objektov `EvidenceItem`.
- Pre každý `EvidenceItem` MUSÍŠ priradiť správny `impact` (POSITIVE pre dobré správy, WARNING pre varovania, CRITICAL pre exekúcie, tunelovanie a bankrot, NEUTRAL pre neutrálne info).
- Ku každému z 5 pilierov nájdi aspoň jeden silný dôkaz.
- Ak sa tvoje skóre líši od 'algorithmic_prescore', vysvetli dôvod (napr. penalizácia za PDF dlhy, naratívne riziká).
- Ak nemáš dostatok dát (chýbajúce PDF pre dané IČO), skóre neurčuj a uveď 'INSUFFICIENT_DATA'."""


import asyncio

async def evaluate_audit_verdict(data_json: str, debt_pdfs: list[str], model: str = settings.model_verdict) -> AuditVerdict:
    """
    Vykoná agregovanú analýzu (Chief Auditor) nad všetkými zozbieranými JSON dátami a textom extrahovaným z PDF súborov registrov.
    """
    import fitz

    client = genai.Client(api_key=os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY"))

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

