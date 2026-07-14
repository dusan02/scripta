import os
import re
import logging
from typing import Optional
from google.genai import types

from src.config import settings
from .shared import (
    _get_gemini_client,
    _gemini_uploaded_file,
    _log_tokens,
    CompanyFinancialExtraction,
    VerificationExtraction,
)

logger = logging.getLogger(__name__)

SYSTEM_PROMPT = """Si Lead Data Extraction Specialist @ Verifa.sk. Tvojou úlohou je chirurgicky presná extrakcia štruktúrovaných finančných metrík z neštruktúrovaných účtovných závierok (vrátane IFRS, národných štandardov a Mikro účtovných jednotiek - Úč MUJ). Tvojou úlohou nie je hodnotiť zdravie firmy, ale zabezpečiť 100% presnosť a dátovú čistotu pre ďalšie modely a pre potreby advokátov, ktorí preverujú bonitu protistrany a hľadajú podozrivé aktivity (tzv. biele kone) alebo riziko úpadku.

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
- `dlhodobe_zavazky` (Long-term liabilities): Hľadaj v Pasívach: "Dlhodobé záväzky", "Long-term borrowings", "Non-current liabilities", "Bonds payable", "Long-term loans".
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
- KRITICKÉ SÚČTOVÉ UZLY: `celkove_aktiva`, `obezny_majetok` a `vlastne_imanie_celkom` sú hlavné súčtové riadky v Súvaha (Balance Sheet). Aj keď vidíš čiastkové položky (zásoby, pohľadávky, hotovosť), MUSÍŠ vyhľadať a extrahovať aj súčtové riadky "Celkové aktíva" / "Total assets" / "Spolu aktíva", "Obežný majetok" / "Current assets" / "Spolu obežný majetok", a "Vlastné imanie celkom" / "Total equity" / "Spolu vlastné imanie". Tieto súčty sú zvyčajne na rovnakej strane ako čiastkové položky, často ako posledný riadok v danej sekcii. Ak vidíš čiastkové položky ale chýba súčet, SČÍTAJ ich ako fallback.
- Nikdy nehalucinuj. Ak položka v závierke neexistuje alebo nie je uvedená, vráť null. Ak je fyzicky uvedená 0, vráť 0."""


async def extract_financial_data(file_path: str, model: str = settings.model_ifrs, chunk_meta: dict = None) -> CompanyFinancialExtraction:
    """
    Nahrá PDF súbor (napr. skenovanú závierku) do Gemini File API, a použije Multimodal model
    na extrakciu faktov priamo z obrázkov strán podľa Pydantic schémy.
    Pre .txt súbory (HTML extrakcia z registeruz.sk) pošle text priamo ako prompt.
    """
    # Pridanie metadát do promptu ak existujú (pre chunking logiku)
    prompt_text = SYSTEM_PROMPT
    if chunk_meta:
        prompt_text += f"\n\n[METADATA CHUNKU]\nToto je chunk č. {chunk_meta.get('chunk_id')} zo zdrojového dokumentu '{chunk_meta.get('source_pdf')}'. "
        prompt_text += f"Obsahuje strany {chunk_meta.get('page_range')}. "
        prompt_text += "Extrahuj len hodnoty, ktoré sa fyzicky nachádzajú na týchto stranách."

    # Skúsime vyčítať rok priamo z názvu súboru (ak bol dodaný scraperom)
    filename = os.path.basename(file_path)
    match = re.search(r'_(\d{4})_', filename)
    expected_year = int(match.group(1)) if match else None

    # Skúsime vyčítať IČO z názvu súboru (napr. IFRS_35876832_2024_0.pdf alebo VS_00604381_...)
    ico_match = re.search(r'(?:IFRS|VS|TXT)_(\d{8})_', filename)
    expected_ico = ico_match.group(1) if ico_match else None

    client = _get_gemini_client()

    config = types.GenerateContentConfig(
        system_instruction=prompt_text,
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
            logger.info(f"[LLM] Prepisujem rok zavierky: {m.rok_zavierky} → {expected_year}")
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
                "kratkodobe_zavazky", "dlhodobe_zavazky", "trzby_z_hlavnej_cinnosti",
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
            logger.warning(f"[LLM] Prepisujem náklad {cost_field}={val} → {abs(val)} (náklad musí byť kladný)")
            setattr(data.metriky, cost_field, abs(val))

    return data

async def verify_critical_numbers_blind(file_path: str, model: str = settings.model_fallback) -> VerificationExtraction:
    """
    Slepá verifikácia kľúčových polí na celom PDF.
    Používa sa pre lacnejší model (Flash), na overenie OCR z prvého behu.
    """
    client = _get_gemini_client()
    prompt_text = (
        "Si finančný audítor. V priloženom dokumente nájdi presné hodnoty pre týchto 5 polí. "
        "Ak si nie si istý alebo hodnotu nevieš nájsť, vráť null. "
        "Nezabudni na pravidlá pre 'v tisícoch EUR' alebo 'v miliónoch EUR' (vtedy hodnoty vynásob príslušne)."
    )
    
    config = types.GenerateContentConfig(
        system_instruction=prompt_text,
        response_mime_type="application/json",
        response_schema=VerificationExtraction,
        temperature=0.0
    )
    
    with _gemini_uploaded_file(client, file_path) as uploaded_file:
        response = await client.aio.models.generate_content(
            model=model,
            contents=[uploaded_file],
            config=config,
        )
        _log_tokens(model, response.usage_metadata, "verify_critical_numbers_blind")
        
    data = VerificationExtraction.model_validate_json(response.text)

    # Sanity check: rovnaká logika ako v extract_financial_data —
    # ak Flash ignoroval "v tisícoch EUR", násobíme ×1000 alebo ×1 000 000.
    _MONETARY_FIELDS = [
        "celkove_aktiva", "trzby_z_hlavnej_cinnosti",
        "zisk_alebo_strata_po_zdaneni", "vlastne_imanie_celkom",
        "ciste_penazne_toky_z_prevadzkovej_cinnosti",
    ]
    if data.celkove_aktiva is not None and data.celkove_aktiva > 0:
        if data.celkove_aktiva < 100:
            logger.warning(f"[VERIFY SANITY] celkove_aktiva={data.celkove_aktiva} < 100 — násobím ×1 000 000")
            multiplier = 1_000_000
        elif data.celkove_aktiva < 10000:
            logger.warning(f"[VERIFY SANITY] celkove_aktiva={data.celkove_aktiva} < 10 000 — násobím ×1 000")
            multiplier = 1_000
        else:
            multiplier = 1
        if multiplier > 1:
            for field_name in _MONETARY_FIELDS:
                val = getattr(data, field_name, None)
                if val is not None:
                    setattr(data, field_name, val * multiplier)

    return data
