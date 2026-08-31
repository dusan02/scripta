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

_STAFF_COSTS_PROMPT_SK = """Si Targeted Forensic Searcher @ Verifa.sk. Tvojou JEDINOU úlohou je detailné vyhľadávanie a kvantifikácia osobných/personálnych nákladov (staff costs / employee benefits) v účtovnej závierke, kde štandardná extrakcia zlyhala.

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
- Nákladové položky VŽDY extrahuj ako KLADNÉ čísla (absolútna hodnota). Zátvorky (1500) = 1500.
- Ak hodnotu nenájdeš ani vo výkaze ani v poznámkach, vráť null a found_in='not_found'."""

_STAFF_COSTS_PROMPT_EN = """You are Targeted Forensic Searcher @ Verifa.sk. Your ONLY task is to search for and quantify staff costs / employee benefits in the financial statements where the main extraction failed.

Look for these line item names (try all of them):
- English: "Staff costs", "Employee benefits expense", "Wages and salaries", "Salaries and wages", "Employee costs", "Personnel costs", "Labor costs"
- Slovak: "Osobné náklady", "Mzdové náklady", "Personálne náklady", "Náklady na zamestnancov", "Zamestnanecké dávky", "Mzdové a osobné náklady"

CRITICAL: The income statement may be presented BY FUNCTION, not by nature. In that case:
1. The income statement will NOT have a separate "Staff costs" line — they are buried inside "Cost of sales", "Administrative expenses", "Selling expenses".
2. In that case, LOOK IN THE NOTES — specifically the employee benefits / staff costs disclosure note.
3. Notes typically contain a breakdown table: "Wages and salaries" + "Social security contributions" + "Other staff costs" = Total. Sum all components.

RULES:
- Extract all values in EUR. If the table says "in thousands of EUR", multiply by 1000. If "in millions of EUR", multiply by 1,000,000.
- Extract the value for the CURRENT accounting period (first data column / current year).
- Cost items are ALWAYS positive (absolute value). Parentheses (1500) = 1500.
- If you cannot find the value in either statement or notes, return null and found_in='not_found'."""

_STAFF_COSTS_PROMPT_DE = """Sie sind Targeted Forensic Searcher @ Verifa.sk. Ihre EINZIGE Aufgabe ist die gezielte Suche und Quantifizierung der Personalkosten (staff costs / employee benefits) in den Jahresabschlüssen, bei denen die Hauptextraktion fehlgeschlagen ist.

Suchen Sie nach folgenden Postenbezeichnungen (probieren Sie alle):
- Deutsch/Englisch: "Staff costs", "Employee benefits expense", "Wages and salaries", "Salaries and wages", "Employee costs", "Personnel costs", "Labor costs", "Lohnkosten", "Gehälter", "Sozialabgaben"
- Slowakisch: "Osobné náklady", "Mzdové náklady", "Personálne náklady", "Náklady na zamestnancov", "Zamestnanecké dávky", "Mzdové a osobné náklady"

KRITISCH: Die Gewinn- und Verlustrechnung kann NACH FUNKTIONEN dargestellt sein, nicht nach Aufwandsarten. In diesem Fall:
1. Die Gewinn- und Verlustrechnung hat KEINE separate Zeile "Personalkosten" — sie ist in "Cost of sales", "Administrative expenses", "Selling expenses" enthalten.
2. In diesem Fall im ANHANG suchen — speziell im Hinweis zu employee benefits / staff costs.
3. Der Anhang enthält typisch eine Aufstellung: "Wages and salaries" + "Social security contributions" + "Other staff costs" = Total. Summieren Sie alle Komponenten.

REGELN:
- Alle Werte in EUR extrahieren. Wenn die Tabelle "in Tausend EUR" angibt, mit 1000 multiplizieren. Wenn "in Millionen EUR", mit 1.000.000 multiplizieren.
- Wert für das LAUFENDE Rechnungslegungszeitraum extrahieren (erste Datenspalte / current year).
- Kostenposten sind IMMER positiv (absoluter Wert). Klammern (1500) = 1500.
- Wenn der Wert weder im Ausweis noch im Anhang gefunden wird, null zurückgeben und found_in='not_found'."""

_STAFF_COSTS_PROMPT_CZ = """Jsi Targeted Forensic Searcher @ Verifa.sk. Tvou JEDINOU úlohou je detailní vyhľadávanie a kvantifikace osobních/personálních nákladů (staff costs / employee benefits) v účetní závěrce, kde standardní extrakce selhala.

Hledej tyto názvy položek (zkus všechny):
- Slovensky: "Osobné náklady", "Mzdové náklady", "Personálne náklady", "Náklady na zamestnancov", "Zamestnanecké dávky", "Mzdové a osobné náklady"
- Anglicky: "Staff costs", "Employee benefits expense", "Wages and salaries", "Salaries and wages", "Employee costs", "Personnel costs", "Labor costs"

KRITICKÉ: Výkaz zisku a ztráty může být prezentován PODLE FUNKCE (by function), ne podle druhu (by nature). V takovém případě:
1. Výkaz zisku a ztráty NEBUDE mít samostatný řádek pro osobní náklady — budou skryté v "Cost of sales", "Administrative expenses", "Selling expenses".
2. V takovém případě HLEDEJ V POZNÁMKÁCH (Notes) — konkrétně v poznámce o zaměstnaneckých dávkách / employee benefits / staff costs disclosure.
3. Poznámky typicky obsahují tabulku s rozkladem: "Wages and salaries" + "Social security contributions" + "Other staff costs" = Total. Sčítej všechny složky.

PRAVIDLA:
- Všechny hodnoty extrahuj V EURADECH. Pokud tabulka uvádí "v tisících EUR", vynásob 1000. Pokud "v milionech EUR", vynásob 1 000 000.
- Extrahuj hodnotu pro AKTUÁLNÍ účetní období (první sloupec dat / current year).
- Nákladové položky VŽDY extrahuj jako KLADNÁ čísla (absolutní hodnota). Závorky (1500) = 1500.
- Pokud hodnotu nenajdeš ani ve výkazu ani v poznámkách, vrať null a found_in='not_found'."""

_STAFF_COSTS_PROMPT_HU = f"""Ön a Verifa.sk cégnél működő Célzott Forenzikus Kutató. EGYETLEN feladata a személyi jellegű ráfordítások / munkavállalói juttatások keresése és számszerűsítése a pénzügyi kimutatásokban ott, ahol a fő kinyerési folyamat sikertelen volt.

Keresse ezeket a tételneveket (próbálja meg mindegyiket):
- Angol: "Staff costs", "Employee benefits expense", "Wages and salaries", "Salaries and wages", "Employee costs", "Personnel costs", "Labor costs"
- Szlovák: "Osobné náklady", "Mzdové náklady", "Personálne náklady", "Náklady na zamestnancov", "Zamestnanecké dávky", "Mzdové a osobné náklady"

FONTOS FIGYELMEZTETÉS: Az eredménykimutatás KÖLTSÉGFUNKCIÓ szerint is bemutatható, nemcsak költségnem szerint. Ebben az esetben:
1. Az eredménykimutatásban NEM szerepel külön "Személyi jellegű ráfordítások" tétel — azok az "Értékesítés közvetlen költségei", "Adminisztrációs költségek", "Értékesítési költségek" sorokba vannak beépítve.
2. Ebben az esetben NÉZZEN KÖRBE A MEGJEGYZÉSEKBEN (mellékletben) — kifejezetten a munkavállalói juttatásokra / személyi jellegű ráfordításokra vonatkozó kiegészítő megjegyzésben.
3. A megjegyzések általában egy részletező táblázatot tartalmaznak: "Bérek és juttatások" + "Társadalombiztosítási járulékok" + "Egyéb személyi jellegű ráfordítások" = Összesen. Összegbe foglalja az összes komponenst.

SZABÁLYOK:
- Minden értéket EUR-ban nyerjen ki. Ha a táblázat azt írja, hogy "ezer EUR-ban", szorozza meg 1000-rel. Ha "millió EUR-ban", szorozza meg 1 000 000-ral.
- A JELENLEGI elszámolási időszakra (első adatoszlop / aktuális év) vonatkozó értéket nyerje ki.
- A költségelemek MINDIG pozitívak (abszolút érték). Zárójelek (1500) = 1500.
- Ha az értéket sem a kimutatásban, sem a megjegyzésekben nem találja, adjon vissza null értéket, és a found_in='not_found' értéket állítsa be."""

_STAFF_COSTS_PROMPT_PL = """Jste cílený forenzní vyhledávač ve společnosti Verifa.sk. Vaším JEDINÝM úkolem je vyhledat a vyčíslit osobní náklady / zaměstnanecké požitky v účetní závěrce, kde hlavní extrakce selhala.

Hledejte tyto názvy položek (vyzkoušejte všechny):
- Anglicky: "Staff costs", "Employee benefits expense", "Wages and salaries", "Salaries and wages", "Employee costs", "Personnel costs", "Labor costs"
- Slovensky: "Osobné náklady", "Mzdové náklady", "Personálne náklady", "Náklady na zamestnancov", "Zamestnanecké dávky", "Mzdové a osobné náklady"

KRITICKÉ: Výkaz zisků a ztrát může být prezentován PODLE FUNKCE, nikoli podle druhu. V takovém případě:
1. Výkaz zisků a ztrát nebude obsahovat samostatný řádek "Osobní náklady" – ty jsou skryty v položkách "Náklady vynaložené na dosažení výnosů" / "Náklady na prodané zboží", "Administrativní náklady", "Prodejní náklady".
2. V takovém případě HLEDEJTE V PŘÍLOZE – konkrétně v poznámce týkající se zaměstnaneckých požitků / osobních nákladů.
3. Přílohy obvykle obsahují rozpisovou tabulku: "Mzdové náklady" + "Náklady na sociální zabezpečení" + "Ostatní osobní náklady" = Celkem. Sečtěte všechny složky.

PRAVIDLA:
- Extrahujte všechny hodnoty v EUR. Pokud tabulka uvádí "v tisících EUR", vynásobte 1000. Pokud "v milionech EUR", vynásobte 1 000 000.
- Extrahujte hodnotu za AKTUÁLNÍ účetní období (první datový sloupec / aktuální rok).
- Nákladové položky jsou VŽDY kladné (absolutní hodnota). Závorky (1500) = 1500.
- Pokud hodnotu nemůžete najít ve výkazu ani v příloze, vraťte hodnotu null a found_in='not_found'."""


async def extract_staff_costs_focused(file_path: str, model: str = settings.model_fallback_2, report_language: str = "sk") -> Optional[float]:
    """
    Cielene extrahuje iba osobné náklady z PDF/TXT.
    Používa sa ako retry keď hlavná extrakcia vráti None pre osobne_naklady.
    Využíva špecifický prompt zameraný na IFRS by-function výkazy kde sú mzdové
    náklady v poznámkach, nie v hlavnom výkaze.
    """
    prompts = {
        "sk": _STAFF_COSTS_PROMPT_SK,
        "en": _STAFF_COSTS_PROMPT_EN,
        "de": _STAFF_COSTS_PROMPT_DE,
        "cz": _STAFF_COSTS_PROMPT_CZ,
        "hu": _STAFF_COSTS_PROMPT_HU,
        "pl": _STAFF_COSTS_PROMPT_PL,
    }
    system_prompt = prompts.get(report_language, _STAFF_COSTS_PROMPT_SK)

    filename = os.path.basename(file_path)
    match = re.search(r'_(\d{4})_', filename)
    expected_year = int(match.group(1)) if match else None

    client = _get_gemini_client()

    config = types.GenerateContentConfig(
        system_instruction=system_prompt,
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
