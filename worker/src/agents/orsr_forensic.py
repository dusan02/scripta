import logging
from typing import Optional
from google.genai import types

from src.config import settings
from .shared import _get_gemini_client, _log_tokens
from src.models import OrsrForensics

logger = logging.getLogger(__name__)

ORSR_FORENSIC_PROMPT_SK = """Si forenzný dátový analytik pre slovenský Obchodný register (ORSR). 
Tvojou úlohou je analyzovať čistý text "Úplného výpisu" z ORSR a spočítať frekvenciu historických zmien. 
Zameriavaš sa na dve kľúčové sekcie:
1. "Štatutárny orgán" (konatelia, predstavenstvo)
2. "Sídlo"

V týchto sekciách hľadaj dátumy v zátvorkách vo formáte (od: DD.MM.YYYY do: DD.MM.YYYY) alebo výrazy "vymazané". 
Na základe toho urči:
- statutory_changes_count: Koľkokrát sa v histórii firmy zmenil štatutárny orgán (odchod/príchod konateľa).
- address_changes_count: Koľkokrát firma zmenila svoje sídlo v histórii.
- high_turnover_risk: Nastav na True iba vtedy, ak sa štatutár zmenil aspoň 3-krát za posledné 2 roky (alebo podobne podozrivá frekvencia). Inak False.

Vráť výlučne JSON odpovedajúci Pydantic schéme, nič viac. Zvyšné hodnoty (has_virtual_seat, has_foreign_statutory) nemeníš a necháš na predvolených hodnotách False, tie sa doplňujú systémovo v Pythone.
"""

ORSR_FORENSIC_PROMPT_EN = """You are forensic data analyst for the Slovak Commercial Register (ORSR).
Your task is to analyze the plain text of the "Full Extract" from ORSR and count the frequency of historical changes.
Focus on two key sections:
1. "Statutory body" (directors, board members)
2. "Registered office"

In these sections, look for dates in parentheses in the format (from: DD.MM.YYYY to: DD.MM.YYYY) or expressions like "deleted".
Based on this, determine:
- statutory_changes_count: How many times the statutory body changed in the company's history (departure/arrival of a director).
- address_changes_count: How many times the company changed its registered office in its history.
- high_turnover_risk: Set to True only if the statutory body changed at least 3 times in the last 2 years (or similarly suspicious frequency). Otherwise False.

Return exclusively JSON matching the Pydantic schema, nothing more. Leave remaining values (has_virtual_seat, has_foreign_statutory) at their default False values — these are set programmatically in Python.
"""

ORSR_FORENSIC_PROMPT_DE = """Sie sind forensischer Datenanalyst für das slowakische Handelsregister (ORSR).
Ihre Aufgabe ist es, den Klartext des "Vollständigen Auszugs" aus dem ORSR zu analysieren und die Häufigkeit historischer Änderungen zu zählen.
Konzentrieren Sie sich auf zwei Schlüsselabschnitte:
1. "Statutarisches Organ" (Geschäftsführer, Vorstand)
2. "Sitz"

In diesen Abschnitten suchen Sie nach Daten in Klammern im Format (von: DD.MM.YYYY bis: DD.MM.YYYY) oder Ausdrücken wie "gelöscht".
Bestimmen Sie basierend darauf:
- statutory_changes_count: Wie oft sich das statutarische Organ in der Geschichte des Unternehmens geändert hat (Abgang/Ankunft eines Geschäftsführers).
- address_changes_count: Wie oft das Unternehmen seinen Sitz in seiner Geschichte geändert hat.
- high_turnover_risk: Setzen Sie auf True, nur wenn sich der Statutar mindestens 3-mal in den letzten 2 Jahren geändert hat (oder ähnlich verdächtige Häufigkeit). Sonst False.

Geben Sie ausschließlich JSON zurück, das zum Pydantic-Schema passt, nichts weiter. Lassen Sie verbleibende Werte (has_virtual_seat, has_foreign_statutory) auf ihren Standardwerten False — diese werden programmatisch in Python gesetzt.
"""

ORSR_FORENSIC_PROMPT_CZ = """Jsi forenzní datový analytik pro slovenský Obchodní registr (ORSR). 
Tvojím úkolem je analyzovat čistý text "Úplného výpisu" z ORSR a spočítat frekvenci historických změn. 
Zaměřuješ se na dvě klíčové sekce:
1. "Štatutárny orgán" (konatelia, predstavenstvo)
2. "Sídlo"

V těchto sekcích hledej datumy v závorkách ve formátu (od: DD.MM.YYYY do: DD.MM.YYYY) nebo výrazy "vymazané". 
Na základě toho urči:
- statutory_changes_count: Kolikrát se v historii firmy změnil statutární orgán (odchod/příchod jednatele).
- address_changes_count: Kolikrát firma změnila své sídlo v historii.
- high_turnover_risk: Nastav na True pouze tehdy, pokud se statutár změnil alespoň 3krát za poslední 2 roky (nebo podobně podezřelá frekvence). Jinak False.

Vrať výlučně JSON odpovídající Pydantic schématu, nic víc. Zbývající hodnoty (has_virtual_seat, has_foreign_statutory) neměníš a necháš na výchozích hodnotách False, ty se doplňují systémově v Pythonu.
"""

ORSR_FORENSIC_PROMPT_HU = f"""Ön igazságügyi adatelemző a Szlovák Cégjegyzékhez (ORSR).
Az Ön feladata, hogy elemezze az ORSR-ből származó "Teljes kivonat" sima szövegét, és megszámolja a történelmi változások gyakoriságát.
Fókuszáljon két kulcsfontosságú szekcióra:
1. "Statutárny orgán" (ügyvezetők, igazgatósági tagok)
2. "Sídlo" (székhely)

Ezekben a szekciókban keressen zárójelben lévő dátumokat (from: DD.MM.YYYY to: DD.MM.YYYY) formátumban, vagy olyan kifejezéseket, mint a "deleted" (törölve).
Ez alapján határozza meg:
- statutory_changes_count: Hányszor változott a szerv a cég történetében (ügyvezető távozása/érkezése).
- address_changes_count: Hányszor változtatta meg a cég a székhelyét a története során.
- high_turnover_risk: Csak akkor legyen True, ha a szerv az elmúlt 2 évben legalább 3 alkalommal megváltozott (vagy hasonlóan gyanús gyakorisággal). Egyébként False.

Kizárólag a Pydantic sémának megfelelő JSON-t adjon vissza, semmi mást. A többi értéket (has_virtual_seat, has_foreign_statutory) hagyja meg az alapértelmezett False értéken — ezeket programozottan állítjuk be Pythonban.
"""

ORSR_FORENSIC_PROMPT_PL = f"""Jste forenzní datový analytik pro Obchodní register (ORSR).
Vaším úkolem je analyzovat prostý text "Úplného výpisu" z ORSR a spočítat frekvenci historických změn.
Zaměřte se na dvě klíčové sekce:
1. "Statutární orgán" (jednatelé, členové představenstva)
2. "Sídlo"

V těchto sekcích vyhledejte data v závorkách ve formátu (od: DD.MM.YYYY do: DD.MM.YYYY) nebo výrazy jako "vymazán".
Na základě toho určete:
- statutory_changes_count: Kolikkrát se v historii společnosti změnil statutární orgán (odchod/příchod jednatele).
- address_changes_count: Kolikkrát v historii společnost změnil své sídlo.
- high_turnover_risk: Nastavte na True pouze v případě, že se statutární orgán změnil alespoň 3krát za poslední 2 roky (nebo s podobně podezřelou frekvencí). Jinak False.

Vraťte výhradně JSON odpovídající schématu Pydantic, nic jiného. Ponechte zbývající hodnoty (has_virtual_seat, has_foreign_statutory) na jejich výchozích hodnotách False — tyto jsou nastaveny programově v Pythonu.
"""


async def analyze_orsr_history(
    full_text: str,
    model: str = settings.model_fallback,
    report_language: str = "sk",
) -> OrsrForensics:
    """Analyzuje úplný výpis z ORSR a vráti základné forenzné metriky."""
    if not full_text:
        return OrsrForensics()

    prompts = {
        "sk": ORSR_FORENSIC_PROMPT_SK,
        "en": ORSR_FORENSIC_PROMPT_EN,
        "de": ORSR_FORENSIC_PROMPT_DE,
        "cz": ORSR_FORENSIC_PROMPT_CZ,
        "hu": ORSR_FORENSIC_PROMPT_HU,
        "pl": ORSR_FORENSIC_PROMPT_PL,
    }
    system_prompt = prompts.get(report_language, ORSR_FORENSIC_PROMPT_SK)

    client = _get_gemini_client()

    config = types.GenerateContentConfig(
        system_instruction=system_prompt,
        response_mime_type="application/json",
        response_schema=OrsrForensics,
        temperature=0.0
    )

    try:
        response = await client.aio.models.generate_content(
            model=model,
            contents=full_text,
            config=config,
        )
        _log_tokens(model, response.usage_metadata, "analyze_orsr_history")
        raw = response.text or "{}"
        return OrsrForensics.model_validate_json(raw)
    except Exception as e:
        logger.error(f"Error v analyze_orsr_history: {e}")
        return OrsrForensics()
