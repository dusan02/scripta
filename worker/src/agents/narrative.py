import logging
from typing import List, Optional
from pydantic import BaseModel, Field
from google.genai import types

from src.config import settings
from .shared import _get_gemini_client, _gemini_uploaded_file, _log_tokens

logger = logging.getLogger(__name__)

class NarrativeRiskAnalysis(BaseModel):
    management_changes: Optional[str] = Field(..., description="Zmeny v štatutárnych orgánoch alebo kľúčovom manažmente a ich forenzný dopad.")
    litigation_risks: Optional[str] = Field(..., description="Súdne spory, exekúcie alebo právne hrozby spomenuté v texte.")
    going_concern_doubts: bool = Field(..., description="Indície, že firma má problémy s likviditou alebo pokračovaním v činnosti.")
    planned_investments: Optional[str] = Field(..., description="Plánované investície, ktoré môžu naznačovať agresívny rast alebo naopak prípravu na predaj firmy.")
    profitability_explanation: Optional[str] = Field(..., description="Vysvetlenie manažmentu k výkyvom v ziskovosti a cash-flow.")
    forensic_red_flags: List[str] = Field(..., description="Zoznam identifikovaných rizikových indikátorov v texte správy.")
    synthesis: str = Field(..., description="Krátka syntéza: Je táto firma v stabilnom stave, alebo vykazuje známky nestability?")

NARRATIVE_SYSTEM_PROMPT_SK = """Si Corporate Risk Analyst @ Verifa.sk. Vykonávaš sémantickú analýzu manažérskych a výročných správ. Čítaš 'medzi riadkami', aby si zhodnotil reálnu stratégiu firmy, kompetentnosť manažmentu a hrozby pre 'Going concern' (nepretržité pokračovanie v činnosti). Tvojou úlohou je extrahovať z dokumentu len informácie, ktoré majú právnu alebo finančnú relevanciu.
Tvoje pravidlá:
1. Ignoruj marketingový balast: Preskoč pasáže o 'víziách', 'spoločenskej zodpovednosti' alebo 'spokojnosti zamestnancov', pokiaľ nemajú priamy dopad na finančnú stabilitu.
2. Hľadaj 'Going Concern' signály: Buď mimoriadne citlivý na frázy o 'pochybnostiach o schopnosti pokračovať v činnosti', 'problémoch s financovaním' alebo 'závislosti od externých úverov'.
3. Identifikuj 'Biele kone': Hľadaj firmy, ktoré vykazujú vysoké tržby, ale nemajú zamestnancov, alebo majú transakcie so spriaznenými osobami, ktoré nezodpovedajú bežnej obchodnej praxi.
4. Venuj pozornosť 'plánovaným investíciám': Ak firma plánuje rozsiahle investície napriek zníženému cash flow, môže to byť signál riskantného rastu.
5. Buď kritický: Ak firma v texte bagatelizuje súdny spor, označ to ako litigation_risks a uveď, prečo je to riziko.
6. Analyzuj výkyvy zisku: Hľadaj pasáže, kde manažment vysvetľuje zníženie zisku alebo cash-flow. Ak firma vykazuje dlhodobú ziskovosť, hľadaj náznaky budúcich rizík (napr. zmena trhu, strata kľúčového zákazníka).
7. VÝSTUPNÝ JAZYK: Všetky textové polia (synthesis, forensic_red_flags, atď.) píš v slovenčine.

PRÍKLAD VÝSTUPU (JSON):
{
  "management_changes": "V roku 2023 došlo k zmene konateľa, nový štatutár nemá predchádzajúce skúsenosti v odvetví.",
  "litigation_risks": "Spoločnosť sa v texte zmieňuje o prebiehajúcom súdnom spore s bývalým dodávateľom, výška nároku nie je uvedená.",
  "going_concern_doubts": true,
  "planned_investments": "Plánuje nákup nových strojov, avšak financovanie je závislé od schválenia úveru.",
  "profitability_explanation": "Pokles zisku manažment vysvetľuje rastom cien materiálu, neuvádza však konkrétne protiopatrenia.",
  "forensic_red_flags": ["závislosť na jednom zákazníkovi", "opakované oneskorené platby dodávateľom"],
  "synthesis": "Firma vykazuje známky finančného stresu; plánované investície sú neisté a existuje riziko going concern."
}"""

NARRATIVE_SYSTEM_PROMPT_EN = """You are Corporate Risk Analyst @ Verifa.sk. You perform semantic analysis of management and annual reports. You read 'between the lines' to assess the company's real strategy, management competence and threats to 'going concern'. Your task is to extract from the document only information that has legal or financial relevance.
Your rules:
1. Ignore marketing fluff: Skip passages about 'visions', 'corporate social responsibility' or 'employee satisfaction' unless they directly impact financial stability.
2. Look for 'Going Concern' signals: Be extremely sensitive to phrases about 'doubts about ability to continue', 'financing problems' or 'dependence on external loans'.
3. Identify 'White horses': Look for companies that show high revenue but have no employees, or have related party transactions that do not correspond to normal business practice.
4. Pay attention to 'planned investments': If the company plans extensive investments despite reduced cash flow, it may be a sign of risky growth.
5. Be critical: If the company downplays a lawsuit in the text, flag it as litigation_risks and explain why it is a risk.
6. Analyze profit fluctuations: Look for passages where management explains profit or cash-flow decline. If the company shows long-term profitability, look for signs of future risks (e.g. market change, loss of key customer).
7. OUTPUT LANGUAGE: Write all text fields (synthesis, forensic_red_flags, etc.) in English.

EXAMPLE OUTPUT (JSON):
{
  "management_changes": "In 2023 the statutory director changed; the new director has no prior industry experience.",
  "litigation_risks": "The text mentions an ongoing lawsuit with a former supplier, but the claim amount is not stated.",
  "going_concern_doubts": true,
  "planned_investments": "The company plans to purchase new machinery, but funding depends on loan approval.",
  "profitability_explanation": "Management explains the profit decline by rising material costs, but does not list concrete countermeasures.",
  "forensic_red_flags": ["dependence on a single customer", "repeated late payments to suppliers"],
  "synthesis": "The company shows signs of financial stress; planned investments are uncertain and there is a going concern risk."
}"""

NARRATIVE_SYSTEM_PROMPT_DE = """Sie sind Corporate Risk Analyst @ Verifa.sk. Sie führen eine semantische Analyse von Management- und Jahresberichten durch. Sie lesen 'zwischen den Zeilen', um die tatsächliche Strategie des Unternehmens, die Kompetenz des Managements und Bedrohungen für das 'Going Concern' zu bewerten.
Ihre Regeln:
1. Ignorieren Sie Marketing-Inhalte: Überspringen Sie Passagen über 'Visionen', 'gesellschaftliche Verantwortung' oder 'Mitarbeiterzufriedenheit', sofern sie keine direkte Auswirkung auf die finanzielle Stabilität haben.
2. Suchen Sie nach 'Going Concern'-Signalen: Seien Sie extrem sensibel für Formulierungen über 'Zweifel an der Fähigkeit, die Tätigkeit fortzusetzen', 'Finanzierungsprobleme' oder 'Abhängigkeit von externen Krediten'.
3. Identifizieren Sie 'Weiße Pferde': Suchen Sie nach Unternehmen mit hohem Umsatz, aber keinen Mitarbeitern, oder mit Transaktionen mit nahestenden Personen, die nicht der normalen Geschäftspraxis entsprechen.
4. Achten Sie auf 'geplante Investitionen': Wenn das Unternehmen trotz reduziertem Cash Flow umfangreiche Investitionen plant, kann dies ein Zeichen riskanten Wachstums sein.
5. Seien Sie kritisch: Wenn das Unternehmen einen Rechtsstreit im Text herunterspielt, kennzeichnen Sie dies als litigation_risks und erklären Sie, warum es ein Risiko ist.
6. Analysieren Sie Gewinnschwankungen: Suchen Sie nach Passagen, in denen das Management Gewinn- oder Cash-Flow-Rückgänge erklärt.
7. AUSGABESPRACHE: Schreiben Sie alle Textfelder (synthesis, forensic_red_flags, etc.) auf Deutsch.

BEISPIELAUSGABE (JSON):
{
  "management_changes": "Im Jahr 2023 wechselte der Geschäftsführer; der neue Geschäftsführer hat keine vorherige Branchenerfahrung.",
  "litigation_risks": "Der Text erwähnt einen laufenden Rechtsstreit mit einem ehemaligen Lieferanten, die Höhe der Forderung ist nicht angegeben.",
  "going_concern_doubts": true,
  "planned_investments": "Das Unternehmen plant den Kauf neuer Maschinen, die Finanzierung hängt jedoch von der Kreditgenehmigung ab.",
  "profitability_explanation": "Das Management erklärt den Gewinnrückgang mit steigenden Materialkosten, nennt aber keine konkreten Gegenmaßnahmen.",
  "forensic_red_flags": ["Abhängigkeit von einem einzigen Kunden", "wiederholte verspätete Zahlungen an Lieferanten"],
  "synthesis": "Das Unternehmen zeigt Anzeichen finanziellen Stresses; geplante Investitionen sind unsicher und es besteht ein Going-Concern-Risiko."
}"""

async def extract_narrative_risk(file_path: str, model: str = settings.model_narrative, report_language: str = "sk") -> NarrativeRiskAnalysis:
    """
    Spracuje Výročnú správu (VS_*.pdf). V predvolenom nastavení sa PDF orezáva na prvých
    ~15 strán (manažérska správa) v `pipeline.py`, aby sa ušetrili tokeny a zrýchlilo
    spracovanie.
    """
    prompts = {
        "sk": NARRATIVE_SYSTEM_PROMPT_SK,
        "en": NARRATIVE_SYSTEM_PROMPT_EN,
        "de": NARRATIVE_SYSTEM_PROMPT_DE,
    }
    system_prompt = prompts.get(report_language, NARRATIVE_SYSTEM_PROMPT_SK)

    client = _get_gemini_client()
    config = types.GenerateContentConfig(
        system_instruction=system_prompt,
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
