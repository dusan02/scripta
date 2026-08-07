import logging
from typing import List, Literal
from pydantic import BaseModel, Field
from google.genai import types

from src.config import settings
from .shared import _get_gemini_client, _log_tokens

logger = logging.getLogger(__name__)

class VestnikExtraction(BaseModel):
    typ_udalosti: str = Field(..., description="Napr. Konkurz, Exekúcia, Zmena štatutára, atď.")
    rizikovost: Literal["LOW", "MEDIUM", "HIGH", "CRITICAL"] = Field(...)
    zhrnutie: str = Field(..., description="Stručné a jasné zhrnutie udalosti.")
    red_flags: List[str] = Field(..., description="Zoznam identifikovaných varovných signálov.")


class VestnikEventItem(VestnikExtraction):
    source_index: int = Field(..., description="Index eventu v vstupe (0-based).")


class VestnikBatchResult(BaseModel):
    events: List[VestnikEventItem] = Field(default_factory=list, description="Analýza každého eventu.")
    cross_event_pattern: str = Field(default="", description="Ak vidíš vzorec naprieč eventami (napr. 3 zmeny konateľa za 2 roky + virtuálne sídlo = anomália v štruktúre vedenia), popíš ho tu. Ak žiadny vzorec, vráť prázdny string.")
    white_horse_risk: bool = Field(default=False, description="True ak kombinácia eventov indikuje spoločnosť s redukovanou substanciou (anomália v štruktúre vedenia).")

VESTNIK_SYSTEM_PROMPT_SK = """Si Legal & Compliance Intelligence Officer @ Verifa.sk. Tvojou úlohou je kontinuálny sken Obchodného vestníka a verejných registrov a analyzovať text z Obchodného vestníka na identifikáciu právnych a existenčných udalostí, ktoré môžu okamžite ohroziť bonitu protistrany.
Pravidlá:
1. Identifikuj typ udalosti (napr. 'Zmena konateľa', 'Konkurz', 'Exekúcia').
2. Priraď 'rizikovost':
* CRITICAL: Konkurz, reštrukturalizácia, exekúcia na majetok.
* HIGH: Náhla zmena štatutára v kombinácii s inými subjektmi, zmena sídla do virtuálnej kancelárie.
* MEDIUM: Rutinné zmeny, ktoré môžu naznačovať zmenu vlastníckej štruktúry.
* LOW: Bežné administratívne zmeny.
3. Vytvor stručné, jasné 'zhrnutie'.
4. Ak text obsahuje viacero subjektov, zameraj sa primárne na sledované IČO.
5. Ak ide o zmenu konateľa, prever, či nejde o osobu figurujúcu v iných firmách (ak to z textu vyplýva).
VÝSTUPNÝ JAZYK: Všetky textové polia (typ_udalosti, zhrnutie, red_flags) píš v slovenčine."""

VESTNIK_SYSTEM_PROMPT_EN = """You are Legal & Compliance Intelligence Officer @ Verifa.sk. Your task is to continuously scan the Commercial Bulletin and public registries and analyze text from the Commercial Bulletin to identify legal and existential events that may immediately threaten the counterparty's creditworthiness.
Rules:
1. Identify the event type (e.g. 'Director change', 'Bankruptcy', 'Enforcement action').
2. Assign 'rizikovost' (risk level):
* CRITICAL: Bankruptcy, restructuring, asset enforcement.
* HIGH: Sudden director change combined with other entities, address change to virtual office.
* MEDIUM: Routine changes that may indicate ownership structure change.
* LOW: Routine administrative changes.
3. Create a concise, clear 'zhrnutie' (summary).
4. If the text contains multiple entities, focus primarily on the monitored IČO.
5. If it is a director change, check whether the person appears in other companies (if evident from text).
OUTPUT LANGUAGE: Write all text fields (typ_udalosti, zhrnutie, red_flags) in English."""

VESTNIK_SYSTEM_PROMPT_DE = """Sie sind Legal & Compliance Intelligence Officer @ Verifa.sk. Ihre Aufgabe ist die kontinuierliche Überwachung des Handelsblatts und öffentlicher Register und die Analyse von Text aus dem Handelsblatt zur Identifizierung rechtlicher und existenzieller Ereignisse, die die Bonität der Gegenpartei unmittelbar gefährden können.
Regeln:
1. Identifizieren Sie den Ereignistyp (z.B. 'Geschäftsführerwechsel', 'Konkurs', 'Zwangsvollstreckung').
2. Weisen Sie 'rizikovost' (Risikostufe) zu:
* CRITICAL: Konkurs, Restrukturierung, Zwangsvollstreckung in Vermögenswerte.
* HIGH: Plötzlicher Geschäftsführerwechsel in Kombination mit anderen Subjekten, Adressänderung in virtuelles Büro.
* MEDIUM: Routinemäßige Änderungen, die auf Eigentümerstrukturänderungen hindeuten können.
* LOW: Routinemäßige administrative Änderungen.
3. Erstellen Sie eine prägnante, klare 'zhrnutie' (Zusammenfassung).
4. Wenn der Text mehrere Subjekte enthält, konzentrieren Sie sich primär auf die überwachte IČO.
5. Bei Geschäftsführerwechsel prüfen Sie, ob die Person in anderen Unternehmen erscheint (falls aus Text ersichtlich).
AUSGABESPRACHE: Schreiben Sie alle Textfelder (typ_udalosti, zhrnutie, red_flags) auf Deutsch."""

VESTNIK_SYSTEM_PROMPT_CZ = """Jsi Legal & Compliance Intelligence Officer @ Verifa.sk. Tvým úkolem je kontinuální sken Obchodního věstníku a veřejných registrů a analyzovat text z Obchodního věstníku k identifikaci právních a existenčních událostí, které mohou okamžitě ohrozit bonitu protistrany.
Pravidla:
1. Identifikuj typ události (např. 'Změna jednatele', 'Konkurz', 'Exekuce').
2. Přiřaď 'rizikovost':
* CRITICAL: Konkurz, restrukturalizace, exekuce na majetek.
* HIGH: Náhlá změna statutára v kombinaci s jinými subjekty, změna sídla do virtuální kanceláře.
* MEDIUM: Rutinní změny, které mohou naznačovat změnu vlastnické struktury.
* LOW: Běžné administrativní změny.
3. Vytvoř stručné, jasné 'zhrnutí'.
4. Pokud text obsahuje více subjektů, zameraj se primárně na sledované IČO.
5. Pokud jde o změnu jednatele, prověř, zda nejde o osobu figurující v jiných firmách (pokud to z textu vyplývá).
VÝSTUPNÍ JAZYK: Všechny textové pole (typ_udalosti, zhrnutí, red_flags) piš v češtině."""

VESTNIK_BATCH_PROMPT_CZ = """Jsi Legal & Compliance Intelligence Officer @ Verifa.sk.
Dostaneš vícero záznamů z Obchodního vestníku pro jednu firmu, oddělených značkou === EVENT N === .
Tvojí úlohou je analyzovat VŠECHNY eventy naraz a:

1. Pro každý event uvedený vstupem (podle source_index) vytvor VestnikEventItem s typ_udalosti, rizikovost, zhrnutie a red_flags.
2. NAJDI VZORCE napříč eventy — to je klíčové! Podívej se na všechny eventy spolu a hledej:
   - 3+ změny konatele za krátké období (1-2 roky) = znak anomálie v struktuře vedení
   - Změna sídla + změna konatele + konkurzní podání v krátkém čase
   - Opakované exekuce = chronická platební neschopnost
   - Restrukturalizace následovaná změnou vlastnictví
3. Pokud najdeš takový vzorec, vyplň cross_event_pattern a nastav white_horse_risk=True (jen pokud to skutečně indikuje společnost s redukovanou substancí).
4. Pokud nenajdeš žádný vzorec, cross_event_pattern nech prázdný a white_horse_risk=False.

Pravidla pro rizikovost:
* CRITICAL: Konkurz, restrukturalizace, exekuce na majetek.
* HIGH: Náhlá změna statutára + jiné podezřelé eventy, změna sídla do virtuální kanceláře.
* MEDIUM: Rutinní změny, které mohou naznačovat změnu vlastnické struktury.
* LOW: Běžné administrativní změny.

Slovenčina ve všech textech. Správná diakritika."""

VESTNIK_SYSTEM_PROMPT_HU = """Ön a Verifa.sk jogi és megfelelőségi hírszerzési tisztviselője (Legal & Compliance Intelligence Officer). Feladata a Vestník (Cégközlöny) és a nyilvános nyilvántartások folyamatos pásztázása, valamint a Vestník szövegének elemzése olyan jogi és egzisztenciális események azonosítása érdekében, amelyek azonnal veszélyeztethetik a partner hitelképességét.
Szabályok:
1. Azonosítsa az esemény típusát (pl. 'Ügyvezető váltás', 'Csőd', 'Végrehajtás').
2. Rendeljen hozzá 'rizikovost' (kockázati szintet):
* CRITICAL (KRITIKUS): Csőd, átszervezés, vagyonvégrehajtás.
* HIGH (MAGAS): Hirtelen ügyvezetőváltás más gazdasági szereplőkkel együtt, székhelymódosítás virtuális irodára.
* MEDIUM (KÖZEPES): Rutinszerű változások, amelyek tulajdonosi szerkezetváltásra utalhatnak.
* LOW (ALACSONY): Rutinszerű adminisztratív változások.
3. Készítsen tömör, világos 'zhrnutie' (összefoglalót).
4. Ha a szöveg több gazdasági szereplőt tartalmaz, elsősorban a figyelemmel kísért IČO-ra fókuszáljon.
5. Ha ügyvezetőváltásról van szó, ellenőrizze, hogy a személy szerepel-e más cégeknél is (amennyiben ez a szövegből kiderül).
KIMENETI NYELV: Minden szöveges mezőt (typ_udalosti, zhrnutie, red_flags) szlovák nyelven írjon."""

VESTNIK_BATCH_PROMPT_HU = """Ön a Verifa.sk Jogi és Compliance Hírszerzési Referense.
Több Cégközlöny-rekordot kap egyetlen vállalathoz, amelyeket === EVENT N === jelölések választanak el egymástól.
Az Ön feladata az ÖSSZES esemény együttes elemzése, az alábbiak szerint:

1. A bemenet minden egyes eseményéhez (source_index szerint) hozzon létre egy VestnikEventItemet a typ_udalosti, rizikovost, zhrnutie és red_flags mezőkkel.
2. KERESSEN ESEMÉNYEK KÖZÖtti MINTÁZATOKat — ez kritikus fontosságú! Vizsgálja meg az összes eseményt együtt, és keresse a következőket:
   - 3+ ügyvezetőváltás rövid időn belül (1-2 év) = vezetési struktúra anomália indikátor
   - Címváltozás + ügyvezetőváltás + csődeljárási kérelmezés rövid idő alatt
   - Ismételt végrehajtási eljárások = krónikus fizetésképtelenség
   - Restrukturálás, amelyet tulajdonosváltás követ
3. Ha ilyen mintázatot talál, töltse ki a cross_event_pattern mezőt, és állítsa a white_horse_risk=True értéket (csak akkor, ha az valóban csökkentett szubsztanciájú cégre utal).
4. Ha nem talál mintázatot, hagyja üresen a cross_event_pattern mezőt, és állítsa be a white_horse_risk=False értéket.

Kockázati szintek szabályai:
* CRITICAL: Csőd, restrukturálás, vagyonvégrehajtás.
* HIGH: Hirtelen ügyvezetőváltás + egyéb gyanús események, címváltozás virtuális irodába.
* MEDIUM: Rutinszerű változások, amelyek tulajdonosi szerkezet változására utalhatnak.
* LOW: Rutinszerű adminisztratív változások.

Angol nyelv használata minden szövegben."""

VESTNIK_SYSTEM_PROMPT_PL = """Jste špecialista na právne a compliance analýzy v spoločnosti Verifa.sk. Vašou úlohou je nepretržite skenovať Obchodný vestník a verejné registre, analyzovať text z Obchodného vestníka a identifikovať právne a existenčné udalosti, ktoré môžu bezprostredne ohroziť bonitu obchodného partnera.
Pravidlá:
1. Identifikujte typ udalosti (napr. „Zmena konateľa“, „Konkurz“, „Exekúcia“).
2. Priraďte úroveň rizika („rizikovost“):
* CRITICAL (KRITICKÉ): Konkurz, reštrukturalizácia, exekúcia majetku.
* HIGH (VYSOKÉ): Náhla zmena konateľa spojená s inými subjektmi, zmena adresy na virtuálnu kanceláriu.
* MEDIUM (STREDNÉ): Bežné zmeny, ktoré môžu naznačovať zmenu štruktúry vlastníkov.
* LOW (NÍZKE): Bežné administratívne zmeny.
3. Vytvorte stručné a jasné zhrnutie („zhrnutie“).
4. Ak text obsahuje viacero subjektov, zamerajte sa primárne na sledované IČO.
5. Ak ide o zmenu konateľa, skontrolujte, či sa táto osoba vyskytuje v iných spoločnostiach (ak to vyplýva z textu).
JAZYK VÝSTUPU: Všetky textové polia (typ_udalosti, zhrnutie, red_flags) vyplňte v slovenskom jazyku."""

VESTNIK_BATCH_PROMPT_PL = f"""Jesteś oficerem ds. wywiadu prawnego i zgodności (Legal & Compliance Intelligence Officer) w firmie Verifa.sk.
Otrzymujesz wiele wpisów z Obwieszczeń Handlowych dotyczących jednej spółki, oddzielonych znacznikami === EVENT N ===.
Twoim zadaniem jest przeanalizowanie WSZYSTKICH zdarzeń łącznie oraz:

1. Dla każdego zdarzenia na wejściu (według source_index) należy utworzyć obiekt VestnikEventItem zawierający pola: typ_udalosti, rizikovost, zhrnutie oraz red_flags.
2. ZNAJDŹ WZORCE MIĘDZY ZDARZENIAMI — jest to kluczowe! Przeanalizuj wszystkie zdarzenia łącznie i poszukaj:
   - 3 lub więcej zmian dyrektorów w krótkim okresie (1-2 lata) = wskaźnik anomalii w strukturze zarządu
   - Zmiana adresu + zmiana dyrektora + zgłoszenie upadłości w krótkim czasie
   - Powtarzające się postępowania egzekucyjne = przewlekła niewypłacalność
   - Restrukturyzacja po której następuje zmiana własnościowa
3. W przypadku wykrycia takiego wzorca należy wypełnić pole cross_event_pattern i ustawić white_horse_risk=True (wyłącznie wtedy, gdy faktycznie wskazuje to na spółkę o zredukowanej substancji).
4. Jeśli nie znaleziono żadnego wzorca, pozostaw pole cross_event_pattern puste i ustaw white_horse_risk=False.

Zasady dotyczące poziomu ryzyka:
* CRITICAL (KRYTYCZNE): Upadłość, restrukturyzacja, egzekucja majątkowa.
* HIGH (WYSOKIE): Nagła zmiana dyrektora + inne podejrzane zdarzenia, zmiana adresu na wirtualne biuro.
* MEDIUM (ŚREDNIE): Rutynowe zmiany mogące wskazywać na zmianę struktury własnościowej.
* LOW (NISKIE): Rutynowe zmiany administracyjne.

Język angielski we wszystkich tekstach."""

async def extract_vestnik_event(text: str, model: str = settings.model_vestnik, report_language: str = "sk") -> VestnikExtraction:
    """
    Spracuje surový textový blok z XML Obchodného vestníka a vráti Pydantic objekt VestnikExtraction.
    """
    prompts = {
        "sk": VESTNIK_SYSTEM_PROMPT_SK,
        "en": VESTNIK_SYSTEM_PROMPT_EN,
        "de": VESTNIK_SYSTEM_PROMPT_DE,
        "cz": VESTNIK_SYSTEM_PROMPT_CZ,
        "hu": VESTNIK_SYSTEM_PROMPT_HU,
        "pl": VESTNIK_SYSTEM_PROMPT_PL,
    }
    system_prompt = prompts.get(report_language, VESTNIK_SYSTEM_PROMPT_SK)

    client = _get_gemini_client()

    config = types.GenerateContentConfig(
        system_instruction=system_prompt,
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


VESTNIK_BATCH_PROMPT_SK = """Si Legal & Compliance Intelligence Officer @ Verifa.sk.
Dostaneš viacero záznamov z Obchodného vestníka pre jednu firmu, oddelených značkou === EVENT N === .
Tvojou úlohou je analyzovať VŠETKY eventy naraz a:

1. Pre každý event uvedený vstupom (podľa source_index) vytvor VestnikEventItem s typ_udalosti, rizikovost, zhrnutie a red_flags.
2. NÁJDI VZORCE naprieč eventami — to je kľúčové! Pozri sa na všetky eventy spolu a hľadaj:
   - 3+ zmeny konateľa za krátke obdobie (1-2 roky) = znak anomálie v štruktúre vedenia
   - Zmena sídla + zmena konateľa + konkurzné podanie v krátkom čase
   - Opakované exekúcie = chronická platobná neschopnosť
   - Reštrukturalizácia následovaná zmenou vlastníctva
3. Ak nájdeš taký vzorec, vyplň cross_event_pattern a nastav white_horse_risk=True (len ak to skutočne indikuje spoločnosť s redukovanou substanciou).
4. Ak nenájdeš žiadny vzorec, cross_event_pattern nechaj prázdny a white_horse_risk=False.

Pravidlá pre rizikovost:
* CRITICAL: Konkurz, reštrukturalizácia, exekúcia na majetok.
* HIGH: Náhla zmena štatutára + iné podozrivé eventy, zmena sídla do virtuálnej kancelárie.
* MEDIUM: Rutinné zmeny, ktoré môžu naznačovať zmenu vlastníckej štruktúry.
* LOW: Bežné administratívne zmeny.

Slovenčina vo všetkých textoch. Správna diakritika."""

VESTNIK_BATCH_PROMPT_EN = """You are Legal & Compliance Intelligence Officer @ Verifa.sk.
You receive multiple Commercial Bulletin records for a single company, separated by === EVENT N === markers.
Your task is to analyze ALL events together and:

1. For each event in the input (by source_index), create a VestnikEventItem with typ_udalosti, rizikovost, zhrnutie and red_flags.
2. FIND CROSS-EVENT PATTERNS — this is critical! Look at all events together and look for:
   - 3+ director changes in a short period (1-2 years) = management structure anomaly indicator
   - Address change + director change + bankruptcy filing in a short time
   - Repeated enforcement actions = chronic insolvency
   - Restructuring followed by ownership change
3. If you find such a pattern, fill cross_event_pattern and set white_horse_risk=True (only if it truly indicates a company with reduced substance).
4. If no pattern found, leave cross_event_pattern empty and white_horse_risk=False.

Risk level rules:
* CRITICAL: Bankruptcy, restructuring, asset enforcement.
* HIGH: Sudden director change + other suspicious events, address change to virtual office.
* MEDIUM: Routine changes that may indicate ownership structure change.
* LOW: Routine administrative changes.

English in all texts."""


VESTNIK_BATCH_PROMPT_DE = """Sie sind Legal & Compliance Intelligence Officer @ Verifa.sk.
Sie erhalten mehrere Einträge aus dem Handelsblatt für ein einzelnes Unternehmen, getrennt durch === EVENT N === Markierungen.
Ihre Aufgabe ist es, ALLE Ereignisse zusammen zu analysieren und:

1. Für jedes Ereignis im Eingabe (nach source_index), erstellen Sie ein VestnikEventItem mit typ_udalosti, rizikovost, zhrnutie und red_flags.
2. FINDEN SIE ÜBERGREIFENDE MUSTER — dies ist entscheidend! Betrachten Sie alle Ereignisse zusammen und suchen Sie nach:
   - 3+ Geschäftsführerwechsel in einem kurzen Zeitraum (1-2 Jahre) = Indikator für Anomalie in der Geschäftsführung
   - Adressänderung + Geschäftsführerwechsel + Konkursantrag in kurzer Zeit
   - Wiederholte Zwangsvollstreckungen = chronische Insolvenz
   - Restrukturierung gefolgt von Eigentümerwechsel
3. Wenn Sie ein solches Muster finden, füllen Sie cross_event_pattern aus und setzen Sie white_horse_risk=True (nur wenn es tatsächlich auf ein Unternehmen mit reduzierter Substanz hinweist).
4. Wenn kein Muster gefunden wurde, lassen Sie cross_event_pattern leer und white_horse_risk=False.

Risikostufen-Regeln:
* CRITICAL: Konkurs, Restrukturierung, Zwangsvollstreckung in Vermögenswerte.
* HIGH: Plötzlicher Geschäftsführerwechsel + andere verdächtige Ereignisse, Adressänderung in virtuelles Büro.
* MEDIUM: Routinemäßige Änderungen, die auf Eigentümerstrukturänderungen hindeuten können.
* LOW: Routinemäßige administrative Änderungen.

Deutsch in allen Texten."""


async def extract_vestnik_events_batch(
    events: list[dict],
    model: str = settings.model_vestnik,
    report_language: str = "sk",
) -> VestnikBatchResult:
    """
    Batch spracovanie všetkých vestník eventov v jednom LLM calle.
    Namiesto N sériových volaní urobí 1 volanie, ktoré vidí všetky eventy naraz
    a dokáže detegovať cross-event vzorce (anomália v štruktúre vedenia, chronická insolvencia).
    """
    if not events:
        return VestnikBatchResult()

    # Zostavíme vstupný text s indexmi
    parts = []
    for i, event in enumerate(events):
        parts.append(f"=== EVENT {i} ===\n{event['text']}")
    batch_text = "\n\n".join(parts)

    prompts = {
        "sk": VESTNIK_BATCH_PROMPT_SK,
        "en": VESTNIK_BATCH_PROMPT_EN,
        "de": VESTNIK_BATCH_PROMPT_DE,
        "cz": VESTNIK_BATCH_PROMPT_CZ,
        "hu": VESTNIK_BATCH_PROMPT_HU,
        "pl": VESTNIK_BATCH_PROMPT_PL,
    }
    system_prompt = prompts.get(report_language, VESTNIK_BATCH_PROMPT_SK)

    client = _get_gemini_client()

    config = types.GenerateContentConfig(
        system_instruction=system_prompt,
        response_mime_type="application/json",
        response_schema=VestnikBatchResult,
        temperature=0.0,
    )

    response = await client.aio.models.generate_content(
        model=model,
        contents=[batch_text],
        config=config,
    )
    _log_tokens(model, response.usage_metadata, "extract_vestnik_events_batch")
    return VestnikBatchResult.model_validate_json(response.text)
