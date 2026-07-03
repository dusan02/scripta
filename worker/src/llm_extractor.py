import os
import re
import fitz
import logging
from contextlib import contextmanager
from pydantic import BaseModel, Field
from typing import Optional, Literal, List
from google import genai
from google.genai import types

from src.config import settings

logger = logging.getLogger(__name__)


def _get_gemini_client() -> genai.Client:
    """Vráti Gemini API klienta s API kľúčom z environment variables."""
    return genai.Client(api_key=os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY"))


@contextmanager
def _gemini_uploaded_file(client: genai.Client, file_path: str):
    """Context manager: uploadne PDF do Gemini File API a automaticky ho vymaže po použití."""
    uploaded = client.files.upload(file=file_path)
    try:
        yield uploaded
    finally:
        try:
            if uploaded.name:
                client.files.delete(name=uploaded.name)
        except Exception as e:
            logger.warning(f"Nepodarilo sa vymazať súbor z Gemini: {e}")


# ── Token cost accumulator ────────────────────────────────────────────
_token_stats: dict[str, dict] = {}

def reset_token_stats() -> None:
    """Reset accumulator na začiatku nového reportu."""
    _token_stats.clear()

def _log_tokens(model: str, usage, label: str) -> None:
    """Zaloguje spotrebu tokenov a odhadnuté náklady pre jedno LLM volanie."""
    if not usage:
        return
    from src.log_helpers import get_correlation_id
    inp = getattr(usage, "prompt_token_count", 0) or 0
    out = getattr(usage, "candidates_token_count", 0) or 0
    price_in, price_out = settings.llm_pricing.get(model, (0.0, 0.0))
    cost_usd = (inp * price_in + out * price_out) / 1_000_000
    cid = get_correlation_id() or "-"
    logger.info(
        f"[{cid}] LLM TOKENS: {label} | model={model} "
        f"in={inp:,} out={out:,} tok "
        f"cost=${cost_usd:.5f}"
    )
    # Accumulate
    if model not in _token_stats:
        _token_stats[model] = {"calls": 0, "input": 0, "output": 0, "cost": 0.0}
    _token_stats[model]["calls"] += 1
    _token_stats[model]["input"] += inp
    _token_stats[model]["output"] += out
    _token_stats[model]["cost"] += cost_usd

def log_token_summary() -> None:
    """Zaloguje súhrn token cost za celý report."""
    if not _token_stats:
        return
    from src.log_helpers import get_correlation_id
    cid = get_correlation_id() or "-"
    total_cost = 0.0
    total_in = 0
    total_out = 0
    parts = []
    for model, stats in _token_stats.items():
        total_cost += stats["cost"]
        total_in += stats["input"]
        total_out += stats["output"]
        parts.append(f"{model}: {stats['calls']} calls, {stats['input']:,}+{stats['output']:,} tok, ${stats['cost']:.4f}")
    logger.info(
        f"[{cid}] LLM SUMMARY: {len(_token_stats)} models, "
        f"{total_in:,}+{total_out:,} tok, ${total_cost:.4f} | "
        f"{' | '.join(parts)}"
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
    zasoby: Optional[float] = Field(..., description="Zásoby (Inventory/Stocks). Hľadaj 'Zásoby', 'Inventories', 'Stocks'. Ak chýba, vráť null.")
    odpisy: Optional[float] = Field(..., description="Odpisy dlhodobého nehmotného a hmotného majetku (Depreciation/Amortization). Hľadaj 'Odpisy', 'Depreciation', 'Amortization'. Ak chýba, vráť null.")
    investicny_cash_flow: Optional[float] = Field(..., description="Čisté peňažné toky z investičnej činnosti (Investing cash flow). Hľadaj 'Investičná činnosť', 'Investing activities'. Ak chýba, vráť null.")
    financny_cash_flow: Optional[float] = Field(..., description="Čisté peňažné toky z finančnej činnosti (Financing cash flow). Hľadaj 'Finančná činnosť', 'Financing activities'. Ak chýba, vráť null.")
    uroky: Optional[float] = Field(..., description="Náklady na úroky (Interest expense). Hľadaj 'Úroky', 'Interest expense', 'Finance costs'. Ak chýba, vráť null.")
    pocet_zamestnancov: Optional[int] = Field(..., description="Počet zamestnancov (ak je uvedený v závierke alebo poznámkach). Hľadaj 'Priemerný počet zamestnancov', 'Number of employees'. Ak chýba, vráť null.")
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
- VÝNIMKA: Nákladové položky (osobné náklady, odpisy, úroky, náklady na predaný tovar, mzdové náklady, sociálne poistenie) VŽDY extrahuj ako KLDNÉ čísla (absolútna hodnota). Náklady sú vždy kladné — znamienko mínus patrí len strate/zápornému hospodárskemu výsledku a záporným cash flow tokom. Ak je náklad v zátvorkách (1500), extrahuj ho ako 1500.0 (kladné).
- Ak narazíš na tabuľku s dvoma stĺpcami dát (rok X a rok X-1), extrahuj prioritne stĺpec pre rok X (aktuálne účtovné obdobie).
- Aj keď sa jedná o malú s.r.o. (Mikro účtovná jednotka) a dokument nemá hlavičku IFRS, MUSÍŠ extrahovať hodnoty do príslušných polí (Tržby, Zisk, Aktíva...). Neodmietaj extrakciu len preto, že to nie je IFRS!
- Malé firmy (Úč MUJ) NEPOTREBUJÚ audítora. Ak v dokumente nie je správa audítora, nastav `nazor_auditora` VŽDY na 'Bez výhrad' a nevykazuj žiadne výhrady ani going concern riziká.
- Malé firmy často nevykazujú "čisté peňažné toky z prevádzkovej činnosti" (Cash flow). Ak tento údaj v dokumente (Súvahe/Výkaze) nenájdeš, vráť null. NIKDY nedoplňuj nulu pre chýbajúce cash flow dáta — nula znamená "firmá má nulový cash flow", čo je forenzný red flag, kým null znamená "dáta neboli k dispozícii".

PRAVIDLÁ PRE NOVÉ POLIA A FORENZNÉ INDIKÁTORY:
- `dlhodobeZavazky` (Long-term liabilities): Hľadaj v Pasívach: "Dlhodobé záväzky", "Long-term borrowings", "Non-current liabilities", "Bonds payable", "Long-term loans".
- `hruba_marza` (Gross profit): V SK GAAP = Obchodná marža + Výrobná spotreba; v IFRS = Revenue - Cost of sales.
- `osobne_naklady` (Staff costs): KRITICKÉ — Hľadaj vo Výkaze ziskov a strát: "Osobné náklady", "Mzdové náklady", "Personálne náklady", "Náklady na zamestnancov", "Zamestnanecké dávky", "Staff costs", "Employee benefits expense", "Wages and salaries", "Salaries and wages", "Employee costs". Toto je súčet mzdových nákladov + sociálneho poistenia + odvodov. Pre výrobné firmy (Mobis, Kia, Volkswagen) sú to miliónové čiastky — ak nájdeš nulu alebo prázdne, skontroluj či naozaj chýbajú alebo sa len nepomenovali inak. NIKDY nevracaj null ak je hodnota fyzicky v tabuľke uvedená.
  KRITICKÉ PRE IFRS BY-FUNCTION: Mnoho IFRS závierok (najmä výrobné firmy ako Mobis, Kia, Volkswagen) prezentuje Výkaz ziskov a strát PODĽA FUNKCIE (by function), nie podľa druhu (by nature). V takom prípade Výkaz ziskov a strát NEOBSAHUJE samostatný riadok "Osobné náklady" / "Staff costs" — namiesto toho sú mzdové náklady súčasťou položiek ako "Cost of sales" / "Náklady na predaný tovar", "Administrative expenses" / "Verejnoprospešné náklady", "Selling expenses" / "Náklady na predaj". V takom prípade HĽADAJ osobné náklady V POZNÁMKACH (Notes) — konkrétne v poznámke o zamestnaneckých dávkach / employee benefits / staff costs disclosure, ktorá typicky uvádza rozklad nákladov podľa druhu. Ak nájdeš v poznámkach tabuľku s rozkladom "Wages and salaries" + "Social security" + "Other staff costs", sčítaj ich a vlož do `osobne_naklady`. Ak v poznámkach nájdeš iba jednu hodnotu pre "Employee benefits" alebo "Staff costs", použi ju priamo.
- `pohladavky_z_obchodneho_styku` a `zavazky_z_obchodneho_styku`: Hľadaj Trade receivables / Trade payables. Kľúčové pre likviditu.
- `zasoby` (Inventory): Hľadaj v Aktívach pod Obežný majetok: 'Zásoby', 'Inventories', 'Stocks'. Pre výrobné firmy kľúčové.
- `odpisy` (Depreciation/Amortization): Hľadaj v Výkaze ziskov a strát alebo Poznámkach: 'Odpisy dlhodobého nehmotného majetku', 'Odpisy hmotného majetku', 'Depreciation', 'Amortization'. Spolu obe odpisy ako jeden súčet.
- `investicny_cash_flow`: Hľadaj v Cash Flow výkaze: 'Investičná činnosť', 'Investing activities'. Čisté peňažné toky (môže byť záporné).
- `financny_cash_flow`: Hľadaj v Cash Flow výkaze: 'Finančná činnosť', 'Financing activities'. Čisté peňažné toky (môže byť záporné).
- `uroky` (Interest expense): Hľadaj vo Výkaze ziskov a strát: 'Úroky', 'Náklady na úroky', 'Interest expense', 'Finance costs', 'Interest payable'. Extrahuj VŽDY ako kladné číslo (náklad je kladný).
- `pocet_zamestnancov`: Hľadaj v Poznámkach: 'Priemerný počet zamestnancov', 'Number of employees'. Ak nie je uvedený, vráť null.
- `typ_zavierky`: Nastav 'IFRS' ak dokument uvádza 'International Financial Reporting Standards' alebo 'IFRS'. Nastav 'MICRO' pre Úč MUJ mikro jednotky. Inak nastav 'SK_GAAP'.
- KRÁTKE OBDOBIA: Ak dokument na prvej strane uvádza obdobie kratšie ako 12 mesiacov (napr. "01/2024 - 03/2024" = 3 mesiace), MUSÍŠ to reflektovať v poli `pocet_mesiacov_obdobia`. Ak v texte vidíš anotáciu "Dĺžka obdobia: X mesiacov", použi túto hodnotu. Nikdy neporovnávaj tržby alebo zisk z krátkeho obdobia s plným rokom — pokles tržieb z 3-mesačného obdobia oproti 12-mesačnému nie je negatívny trend, ale matematický dôsledok kratšieho obdobia.
- Nikdy nehalucinuj. Ak položka v závierke neexistuje alebo nie je uvedená, vráť null. Ak je fyzicky uvedená 0, vráť 0."""



async def extract_financial_data(file_path: str, model: str = settings.model_ifrs) -> CompanyFinancialExtraction:
    """
    Nahrá PDF súbor (napr. skenovanú závierku) do Gemini File API, a použije Multimodal model 
    na extrakciu faktov priamo z obrázkov strán podľa Pydantic schémy.
    Pre .txt súbory (HTML extrakcia z registeruz.sk) pošle text priamo ako prompt.
    """
    # Skúsime vyčítať rok priamo z názvu súboru (ak bol dodaný scraperom)
    filename = os.path.basename(file_path)
    match = re.search(r'_(\d{4})_', filename)
    expected_year = int(match.group(1)) if match else None

    # Skúsime vyčítať IČO z názvu súboru (napr. IFRS_35876832_2024_0.pdf)
    ico_match = re.search(r'IFRS_(\d{8})_', filename)
    expected_ico = ico_match.group(1) if ico_match else None

    client = _get_gemini_client()
    
    config = types.GenerateContentConfig(
        system_instruction=SYSTEM_PROMPT,
        response_mime_type="application/json",
        response_schema=CompanyFinancialExtraction,
        temperature=0.0
    )
    
    # Pre .txt súbory (HTML extrakcia) — pošli text priamo ako prompt
    if file_path.lower().endswith(".txt"):
        with open(file_path, "r", encoding="utf-8") as f:
            text_content = f.read()
        logger.info(f"[LLM] Spracovávam .txt súbor: {filename} ({len(text_content)} chars)")
        response = await client.aio.models.generate_content(
            model=model,
            contents=[text_content],
            config=config,
        )
        _log_tokens(model, response.usage_metadata, "extract_financial_data")
        data = CompanyFinancialExtraction.model_validate_json(response.text)
        # Apply sanity checks and overrides (same as PDF path below)
        m = data.metriky
        if expected_year and (m.rok_zavierky is None or m.rok_zavierky != expected_year):
            logger.info(f"[LLM] Prepisuj rok zavierky: {m.rok_zavierky} → {expected_year}")
            m.rok_zavierky = expected_year
        if expected_ico and (data.ico is None or data.ico != expected_ico):
            data.ico = expected_ico
        return data
    
    # Pre PDF súbory — upload do Gemini File API
    with _gemini_uploaded_file(client, file_path) as uploaded_file:
        response = await client.aio.models.generate_content(
            model=model,
            contents=[uploaded_file],
            config=config,
        )
        _log_tokens(model, response.usage_metadata, "extract_financial_data")

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
            _MONETARY_FIELDS = [
                "celkove_aktiva", "obezny_majetok", "vlastne_imanie_celkom",
                "kratkodobe_zavazky", "dlhodobeZavazky", "trzby_z_hlavnej_cinnosti",
                "hruba_marza", "zisk_alebo_strata_po_zdaneni",
                "peniaze_a_penazne_ekvivalenty_k_31_12",
                "ciste_penazne_toky_z_prevadzkovej_cinnosti",
                "osobne_naklady", "pohladavky_z_obchodneho_styku",
                "zavazky_z_obchodneho_styku", "zasoby", "odpisy",
                "investicny_cash_flow", "financny_cash_flow", "uroky",
            ]
            for field_name in _MONETARY_FIELDS:
                val = getattr(m, field_name, None)
                if val is not None:
                    setattr(m, field_name, val * multiplier)

    # Vždy prepíšeme rok a IČO metadátami z RÚZ (názvu súboru), ak sú k dispozícii.
    # Zamedzíme tým ukladaniu pod IČO audítora (napr. KPMG 31348238).
    if expected_year:
        data.metriky.rok_zavierky = expected_year

    if expected_ico:
        data.ico = expected_ico

    # Safety net: nákladové položky musia byť vždy kladné.
    # LLM môže napriek pokynom vrátiť záporné hodnoty (napr. zátvorky).
    for cost_field in ("osobne_naklady", "uroky", "odpisy", "hruba_marza"):
        val = getattr(data.metriky, cost_field, None)
        if val is not None and val < 0:
            logger.warning(f"[LLM] Prepisuj náklad {cost_field}={val} → {abs(val)} (náklad musí byť kladný)")
            setattr(data.metriky, cost_field, abs(val))

    return data


# ── Focused Staff Costs Extraction (retry keď hlavná extrakcia vráti None) ─────

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
    client = _get_gemini_client()
    
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

class AuditVerdict(BaseModel):
    verifa_score: int = Field(..., ge=0, le=100, description="Finálne skóre integrity a zdravia.")
    risk_category: Literal["AAA", "A", "B", "C", "INSUFFICIENT_DATA"]
    debt_exposure_rating: int = Field(..., ge=0, le=10, description="Hodnotenie expozície voči verejným dlhom (0=čisté, 10=katastrofa).")
    executive_summary: str = Field(..., description="Hlboká korelačná analýza a forenzná syntéza. Prepoj finančné anomálie so zisteniami z registrov do pútavého odstavca.")
    final_verdict: str = Field(..., description="Jedna veta, ktorá zhrnie objektívny stav spoločnosti. Striktne sa vyhni subjektívnym obchodným či investičným odporúčaniam (nepoužívaj 'Odporúčame/Neodporúčame spoluprácu'). Zhodnoť výlučne fakty a mieru rizika (napr. 'Spoločnosť vykazuje stabilné finančné zdravie s nízkym rizikom' alebo 'Kriticky rizikový stav kvôli prebiehajúcim exekúciám').")
    zdovodnenie: list[EvidenceItem] = Field(..., description="Analytické zdôvodnenie skóre. Zoznam tvrdení, dôkazov a zdrojov.")
    kľúčové_riziko: str = Field(..., description="Najväčšia hrozba, ktorej firma čelí.")
    llm_analysis_status: Literal["LLM_ANALYZED", "FALLBACK_ALGORITHMIC"] = Field(default="LLM_ANALYZED", description="Status analýzy: LLM_ANALYZED = Chief Auditor vygeneroval posudok, FALLBACK_ALGORITHMIC = LLM zlyhal, použité deterministické skóre.")

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
1. `algorithmic_prescore` je výsledok deterministického 5-pilierového modelu. Tvojou úlohou je toto skóre **potvrdiť alebo upraviť o max ±10 bodov** na základe tvojho forenzného úsudku z naratívnych, právnych dát a PDF súborov.
2. **PDF DÁTA:** Keďže algoritmus nevidí do priložených PDF súborov s dlhmi, pri objavení aktívnych exekúcií alebo chronických dlhov voči štátu uprav skóre smerom nadol v rámci limitu ±10 bodov.
   - *Pozor:* Ak je v `vestnikEvents` už evidovaná exekúcia alebo konkurz (z ktorej algoritmus v Pilieri 1 a 5 odrátal body), znova ich neodpočítavaj z PDF súborov, aby nedošlo k dvojitej penalizácii.
3. Ak nájdeš exekúciu alebo vážny dlh voči štátu, automaticky označ stav spoločnosti za 'KRITICKY RIZIKOVÝ' v poli `final_verdict` bez ohľadu na to, aké vysoké bolo pôvodné skóre. Prísne sa ale vyhni akýmkoľvek radám o tom, či s firmou obchodovať alebo nie.
4. Ak spoločnosť nemá finančné výkazy alebo je novo založená, niektoré piliere budú mať neutrálnu hodnotu (N/A). Hodnoť primerane (okeolo 50).
5. Zlaté klietky (Riziko tunelovania): Ak vidíš rast tržieb, ale výrazný pokles hotovosti a rast záväzkov voči prepojeným osobám, uprav skóre smerom nadol v rámci svojho limitu. POZOR: Pri medzinárodných korporáciách (skupiny ako Hyundai, Volkswagen, Siemens atď.) sú transakcie so spriaznenými osobami ŠTANDARDNÝ vnútro-skupinový tok (transfer pricing, zdieľané služby). Nepoužívaj termín "riziko tunelovania" pre takéto bežné operácie. Namiesto toho použi neutrálnejší opis: "vysoká miera transakcií so spriaznenými osobami". Termín "tunelovanie" rezervuj len pre prípady, kde je jasný dôkaz neštandardných cenových podmienok alebo odtoku prostriedkov bez hospodárskeho opodstatnenia.
6. CHÝBAJÚCE CASH FLOW DÁTA: Na Slovensku mnoho firiem nepodáva štruktúrovaný výkaz Cash Flow do RÚZ (často je súčasťou poznámok v PDF). Ak v dátach vidíš `operatingCashFlow: null` alebo `operatingCashFlow: 0` pri firme, ktorá má kladné tržby a zisk, NEPovažuj to za forenzný red flag ani znak tunelovania. Nulový alebo chýbajúci cash flow v dátach znamená "dáta neboli k dispozícii v štruktúrovanej forme", NIE "firma má nulový cash flow". Spomeň to ako obmedzenie dát, nie ako riziko firmy.
7. SEKTOROVÉ KONTEXTY (NACE): Pri hodnotení zohľadni NACE kód firmy. Veľkoobchod a maloobchod (NACE 46, 47) má štrukturálne nízke marže (0.5–3%) a vysoké D/E ratio (5–20), pretože ide o "prietokový" biznis s vysokým obratom a záväzkami voči dodávateľom. To, čo by u výrobnej firmy znamenalo kritický stres, je pre veľkoobchod normálne. Nepenalizuj firmy v týchto segmentoch za vysoké D/E alebo nízke marže, ak sú ziskové a majú stabilný obrat.
8. TRŽBY VS AKTÍVA: U výrobných firiem s vysokým obratom (automobilový priemysel, veľkoobchod) je bežné, že ročné tržby prevyšujú celkové aktíva. Tržby reprezentujú prietov (flow) za rok, aktíva sú stav (stock) k jednému dňu. Nepovažuj to za anomáliu ani nezrovnalosť.

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
   - Priraď kategóriu rizika: 90–100 = AAA, 70–89 = A, 40–69 = B, 0–39 = C.

PRAVIDLÁ VÝSTUPU:
- Musíš vyplniť Pydantic schému `AuditVerdict`.
- V poli 'zdovodnenie' vrátiš zoznam objektov `EvidenceItem`.
- Pre každý `EvidenceItem` MUSÍŠ priradiť správny `impact` (POSITIVE pre dobré správy, WARNING pre varovania, CRITICAL pre exekúcie, tunelovanie a vážny finančný stres, NEUTRAL pre neutrálne info).
- Ku každému z 5 pilierov nájdi aspoň jeden silný dôkaz.
- Ak sa tvoje skóre líši od 'algorithmic_prescore', vysvetli dôvod (napr. penalizácia za PDF dlhy, naratívne riziká).
- Ak nemáš dostatok dát (chýbajúce PDF pre dané IČO), skóre neurčuj a uveď 'INSUFFICIENT_DATA'.

PRAVIDLÁ PRE KVALITU TEXTU:
- VŽDY používaj správnu slovenčinu: "dlžník" (nie "dižnik"), "dlžníkov" (nie "dižnikov").
- V texte NIKDY neuvádzaj historické názvy spoločností z registrov (CRZ, UVO). Vždy použi aktuálny oficiálny názov spoločnosti. Rôzne historické formy názvu (napr. "KIA Motors Slovakia" vs "Kia Slovakia") pri rovnakom IČO sú tá istá spoločnosť — neupozorňuj na ne ako na nezrovnalosť.
- V executive_summary a key_risk MUSÍŠ reflektovať významné medziročné zmeny z `analyza_trendov.revenue_trend`. Ak tržby poklesli o viac ako 5% YoY, výslovne to spomeň medzi rizikami alebo upozorneniami. Nepíš o "dlhodobej ziskovosti" ak existuje významný pokles tržieb v poslednom roku.
- Ak tržby prevyšujú aktíva (bežné pri výrobných firmách s vysokým obratom), výslovne vysvetli, že tržby sú prietok za rok zatiaľ čo aktíva sú stav k jednému dňu — nie je to anomália.
- NIKDY nepoužívaj LaTeX syntax v texte. Nepoužívaj znak "$" pre matematické vzorce. Namiesto "E/D=1.69" píš "E/D = 1,69" (s medzerami a slovenskou desatinnou čiarkou). Namiesto "Z''=8.47" píš "Z'' = 8,47". Nepoužívaj "\\prime", "^{...}", ani iné LaTeX príkazy.
- Čísla v texte vždy formátuj so slovenskou desatinnou čiarkou (1,69 nie 1.69) a medzerou ako oddeľovačom tisícov (1 000 000 nie 1000000).
- NADMERNÝ ODPOČET DPH: Pri exportne orientovaných výrobných spoločnostiach (automobilový priemysel, elektronika) je pravidelný a vysoký nadmerný odpočet DPH úplne štandardný a legálny jav. Firma nakupuje komponenty s DPH, ale vyváža hotové výrobky do zahraničia so 0 % sadzbou DPH, čo prirodzene vedie k nadmernému odpočtu. Nepovažuj to za daňové riziko ani red flag.
- ALTMAN Z'' PRE VEĽKOOBCHOD/DISTRIBÚCIU: Ak firma má nízku čistú maržu (< 2 %) a vysoké obchodné záväzky voči dodávateľom, Altman Z''-Score môže indikovať falošné riziko úpadku aj u stabilných distribučných lídrov. Pridaj upozornenie: "Metodika Altman Z'' nie je plne optimalizovaná pre nízkomaržový veľkoobchodný model s vysokým podielom obchodných záväzkov, preto môže indikovať falošné riziko úpadku aj u stabilných distribučných lídrov."
- ZÁLOŽNÉ PRÁVA NA OBCHODNÝ PODIEL: Ak v NCRZP vidíš záložné právo na obchodný podiel od banky (napr. UniCredit Bank, Tatra banka, Slovenská sporiteľňa), je to štandardné zabezpečenie prevádzkových úverov, nie známka platobnej neschopnosti. Neoznačuj to ako kritické riziko.
- REŠTRUKTURALIZÁCIA Z ORSR: Ak v ORSR výpise (sekcia "Ďalšie právne skutočnosti") vidíš zmienku o reštrukturalizácii, konkurze alebo odpustení dlhov — aj keď už skončila — MUSÍŠ to spomenúť v posudku. Napríklad: "Spoločnosť v rokoch 2022–2023 prešla formálnou reštrukturalizáciou, ktorá bola súdom úspešne ukončená." NIKDY nepíš "nemá záznamy o reštrukturalizácii" ak ORSR jasne uvádza, že prebehla. RKR (Register konkurzov a reštrukturalizácií) zobrazuje len aktuálne prebiehajúce konania — ak už skončilo, RKR ho nezobrazí, ale to neznamená, že sa nikdy nekonal.
- KRÁTKE OBDOBIA (< 12 mesiacov): Ak v dátach vidíš `monthsInPeriod` s hodnotou menšou ako 12, NEinterpretuj pokles tržieb alebo zisku oproti predchádzajúcemu 12-mesačnému obdobiu ako negatívny trend. Pokles z 3-mesačného obdobia oproti 12-mesačnému je matematický dôsledok kratšieho obdobia, nie zhoršenie podnikania. V executive_summary výslovne spomeň, že ide o skrátené účtovné obdobie (napr. "Závierka za rok 2024 pokrýva len 3 mesiace, preto nie je porovnateľná s predchádzajúcimi plnými rokmi"). V Pilieri 4 (Rast & Trendová sila) neupravuj skóre nadol za pokles tržieb, ak je obdobie kratšie ako 11 mesiacov."""


async def evaluate_audit_verdict(data_json: str, debt_pdfs: list[str], model: str = settings.model_verdict) -> AuditVerdict:
    """
    Vykoná agregovanú analýzu (Chief Auditor) nad všetkými zozbieranými JSON dátami a textom extrahovaným z PDF súborov registrov.
    """
    client = _get_gemini_client()

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

