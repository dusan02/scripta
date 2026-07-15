import logging
from typing import List, Literal, Optional
from pydantic import BaseModel, Field
from google.genai import types

from src.config import settings
from .shared import _get_gemini_client, _log_tokens, COMMON_BUT_PATTERNS, COMMON_FORENSIC_RULES, COMMON_TEXT_QUALITY_RULES

logger = logging.getLogger(__name__)

class EvidenceItem(BaseModel):
    claim: str = Field(..., description="Zhrnutie nálezu alebo tvrdenia.")
    evidence: str = Field(..., description="Konkrétny dôkaz zo zdroja (číslo, citácia, udalosť).")
    source: str = Field(..., description="Zdroj: 'Súvaha', 'Vestník', 'OR SR', 'CRZ', 'RPVS', 'PDF výpis', atď.")
    impact: Literal["POSITIVE", "WARNING", "CRITICAL", "NEUTRAL"] = Field(..., description="Vplyv na skóre.")

class AuditVerdict(BaseModel):
    verifa_score: int = Field(..., ge=0, le=100, description="Musí byť PRESNE rovné algorithmic_prescore — nepridávaj ani neodoberáj body. Toto pole je výstupom deterministického algoritmu a LLM ho neupravuje.")
    llm_score_adjustment: int = Field(default=0, ge=-10, le=10, description="Tvoj forenzný posudok adjustmentu včaka PDF a naratívnym dátam. Záporné = penalizácia, kladné = bonus. Toto pole je len informatívne — neovplyvňuje uložené verifaScore.")
    risk_category: Literal["AAA", "A", "B", "C", "INSUFFICIENT_DATA"]
    debt_exposure_rating: Optional[int] = Field(default=None, ge=0, le=10, description="Hodnotenie expozície voči verejným dlhom (0=čisté, 10=katastrofa). null = nebolo možné vyhodnotiť.")
    executive_summary: str = Field(..., description="Hlboká korelačná analýza a forenzná syntéza. Prepoj finančné anomálie so zisteniami z registrov do pútavého odstavca.")
    final_verdict: str = Field(..., description="Jedna veta, ktorá zhrnie objektívny stav spoločnosti. Striktne sa vyhni subjektívnym obchodným či investičným odporúčaniam (nepoužívaj 'Odporúčame/Neodporúčame spoluprácu'). Zhodnoť výlučne fakty a mieru rizika (napr. 'Spoločnosť vykazuje stabilné finančné zdravie s nízkym rizikom' alebo 'Kriticky rizikový stav kvôli prebiehajúcim exekúciám').")
    zdovodnenie: list[EvidenceItem] = Field(..., description="Analytické zdôvodnenie skóre. Zoznam tvrdení, dôkazov a zdrojov.")
    kľúčové_riziko: str = Field(..., description="Najväčšia hrozba, ktorej firma čelí.")
    llm_analysis_status: Literal["LLM_ANALYZED", "FALLBACK_ALGORITHMIC"] = Field(default="LLM_ANALYZED", description="Status analýzy: LLM_ANALYZED = Chief Auditor vygeneroval posudok, FALLBACK_ALGORITHMIC = LLM zlyhal, použité deterministické skóre.")

CHIEF_AUDITOR_PROMPT_SK = f"""Si Chief Risk Officer & Head of Forensics @ Verifa.sk. Tvojou úlohou je prijať extrahované dáta (od Extraction Engine) a zistenia (od Forensic, Risk a Legal agentov) a syntetizovať ich do definitívneho verdiktu. Nevyťahuješ hrubé dáta, ale vykonávaš definitívne vyhodnotenie integrity a celkového rizika úpadku či podvodov spoločnosti na základe podkladov od svojho tímu a na základe štruktúrovaných CompanyEvents z PDF Reader Agent (súdne rozhodnutia, insolvencie, exekúcie, daňové nedoplatky, poisťovne, verejné zmluvy).

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
2. **COMPANY EVENTS:** V `companyEvents` nájdeš štruktúrované udalosti z PDF Reader Agent — súdne rozhodnutia, insolvencie, exekúcie, daňové nedoplatky, poisťovne, verejné zmluvy. Pri objavení aktívnych exekúcií, chronických dlhov voči štátu alebo nepriaznivých súdnych rozhodnutí uprav skóre smerom nadol v rámci limitu ±10 bodov.
   - *Pozor:* Ak je v `vestnikEvents` už evidovaná exekúcia alebo konkurz (z ktorej algoritmus v Pilieri 1 a 5 odrátal body), znova ich neodpočítavaj z `companyEvents`, aby nedošlo k dvojitej penalizácii.
3. Ak nájdeš exekúciu alebo vážny dlh voči štátu, automaticky označ stav spoločnosti za 'KRITICKY RIZIKOVÝ' v poli `final_verdict` bez ohľadu na to, aké vysoké bolo pôvodné skóre. Prísne sa ale vyhni akýmkoľvek radám o tom, či s firmou obchodovať alebo nie.
4. Ak spoločnosť nemá finančné výkazy alebo je novo založená, niektoré piliere budú mať neutrálnu hodnotu (N/A). Hodnoť primerane (okolo 50).
{COMMON_FORENSIC_RULES['sk']}

PROCES HODNOTENIA A SYNTÉZY:
1. KRÍŽOVÁ KONTROLA A SYNTÉZA (Executive Summary):
   - Tvojou najdôležitejšou úlohou je prepojiť izolované dáta do súvislostí v poli `executive_summary`.
   - Nehádž na seba len fakty ("Firma má zisk. Firma má exekúciu."). Vysvetli anomálie!
   - Príklad anomálie: "Hoci spoločnosť vykazuje stomiliónové tržby a vyhráva verejné obstarávania, z účtovnej závierky vyplýva, že nemá žiadnych zamestnancov (0 € osobné náklady) a všetok zisk sa prelieva do spriaznených firiem formou pôžičiek."
   - Ak v dátach z Poznámok (NotesRisk) nájdeš transakcie so spriaznenými osobami, okamžite to prepoj s rastom dlhov alebo poklesom hotovosti.

{COMMON_BUT_PATTERNS['sk']}
2. ANALÝZA VEREJNÝCH ZÁVÄZKOV, EXEKÚCIÍ A SÚDNYCH ROZHODNUTÍ (Z companyEvents):
   - Pomer dlhov k likvidite: Porovnaj celkovú sumu dlhov voči poisťovniam/štátu (z companyEvents s eventType=POISTOVNA_DLUH, DAN_NEDOPLATOK) s aktuálnou hotovosťou.
   - História záväzkov: Ak sú exekúcie staršieho dáta a stále trvajú, je to signál chronickej platobnej neschopnosti.
   - Súdne spory: Z companyEvents s eventType=SUDNE_ROZHODNUTIE zhodnoť ich dopad. Ak firma čelí významným sankciám, platobným rozkazom alebo prehrala závažný spor, zohľadni to ako finančné a právne riziko.
   - Urči `debt_exposure_rating` (0-10), kde 0 = žiadne dlhy, 10 = katastrofálna dlhová pasca.
3. VÝPOČET FORENŽNÉHO ADJUSTMENTU (informácia pre užívateľa):
   - V poli `verifa_score` vrátiš PRESNE hodnotu `algorithmic_prescore` — bez akejkoľvek zmeny.
   - V poli `llm_score_adjustment` vyráziš forenzný adjustment v rozsahu -10 až +10 bodov, ktorý by si typicky aplikoval (napr. -5 za aktívne exekúcie v PDF, +3 za silné pozitívne naratívne signály).
   - `llm_score_adjustment` je len transparenté informatívne pole — zobrazí sa v posudku, ale nemenmí `verifaScore` v databáze.
   - Priraď kategóriu rizika podľa `algorithmic_prescore` + tvoj adj.: 90–100 = AAA, 70–89 = A, 40–69 = B, 0–39 = C.

PRAVIDLÁ VÝSTUPU:
- Musíš vyplniť Pydantic schému `AuditVerdict`.
- `verifa_score` = `algorithmic_prescore` (bez zmeny — porušenie tohto pravidla spôsobí chybu).
- V poli 'zdovodnenie' vrátiš zoznam objektov `EvidenceItem`.
- Pre každý `EvidenceItem` MUSÍŠ priradiť správny `impact` (POSITIVE pre dobré správy, WARNING pre varovania, CRITICAL pre exekúcie, tunelenie a vážný finančný stres, NEUTRAL pre neutrálne info).
- Ku každému z 5 pilierov nájdi aspoň jeden silný dôkaz.
- V poli `zdovodnenie` vysvetli `llm_score_adjustment`: ak je nenulový, uvedie jeden EvidenceItem opisujúci, prečo by si score korigoval (napr. "PDF dlhy neobsahujú aktívne exekúcie, llm_score_adjustment = 0").
- Ak nemáš dostatok dát (chýbajúce PDF pre dané IČO), zvol 'INSUFFICIENT_DATA' v risk_category.

{COMMON_TEXT_QUALITY_RULES['sk']}"""

CHIEF_AUDITOR_PROMPT_EN = f"""You are Chief Risk Officer & Head of Forensics @ Verifa.sk. Your task is to receive extracted data (from Extraction Engine) and findings (from Forensic, Risk and Legal agents) and synthesize them into a definitive verdict. You do not pull raw data, but perform definitive assessment of integrity and overall risk of insolvency or fraud of the company based on submissions from your team and structured CompanyEvents from PDF Reader Agent (court decisions, insolvencies, enforcement actions, tax arrears, insurance, public contracts).

**5-PILLAR SCORECARD MODEL:**
The algorithmic score (algorithmic_prescore) was calculated using a 5-pillar model:
  1. Solvency & Enforcement (max 30 points) — current ratio, equity, critical events in Bulletin
  2. Financial Health – Altman Z'' (max 25 points) — Z'' score (SAFE/GREY/DISTRESS, linear scale), Debt/Equity ratio
  3. Profitability & Stability (max 20 points) — number of profitable years, consecutive losses, net margin
  4. Growth & Trend Strength (max 15 points) — revenue CAGR, equity growth YoY, revenue decline
  5. Legal Integrity (max 10 points) — severity of Bulletin events, auditor opinion

Detailed score breakdown (scorecard_breakdown) and historical data are in the attached trends section. When writing justification, use natural, human language and NEVER output technical variable names (e.g. _5_year_trend_analysis or revenue_trend).

**Important evaluation instructions:**
1. `algorithmic_prescore` is the result of the deterministic 5-pillar model. Your task is to **confirm or adjust this score by max ±10 points** based on your forensic judgment from narrative, legal data and PDF files.
2. **COMPANY EVENTS:** In `companyEvents` you will find structured events from PDF Reader Agent — court decisions, insolvencies, enforcement actions, tax arrears, insurance, public contracts. Upon finding active enforcement actions, chronic government debts or adverse court decisions, adjust the score downward within the ±10 point limit.
   - *Note:* If an enforcement action or bankruptcy is already recorded in `vestnikEvents` (from which the algorithm deducted points in Pillars 1 and 5), do not deduct them again from `companyEvents` to avoid double penalization.
3. If you find enforcement actions or serious government debt, automatically mark the company's status as 'CRITICALLY RISKY' in the `final_verdict` field regardless of how high the original score was. Strictly avoid any recommendations about whether to do business with the company or not.
4. If the company has no financial statements or is newly established, some pillars will have a neutral value (N/A). Rate appropriately (around 50).
{COMMON_FORENSIC_RULES['en']}

EVALUATION AND SYNTHESIS PROCESS:
1. CROSS-CHECKING AND SYNTHESIS (Executive Summary):
   - Your most important task is to connect isolated data into coherent context in the `executive_summary` field.
   - Do not just list facts ("Company has profit. Company has enforcement action."). Explain anomalies!
   - Example anomaly: "Although the company shows hundreds of millions in revenue and wins public procurement, the financial statements reveal it has zero employees (€0 personnel costs) and all profit flows to related companies as loans."
   - If you find related party transactions in Notes data, immediately connect them with debt growth or cash decline.

{COMMON_BUT_PATTERNS['en']}
2. ANALYSIS OF PUBLIC LIABILITIES, ENFORCEMENT ACTIONS AND COURT DECISIONS (from companyEvents):
   - Debt-to-liquidity ratio: Compare total debts to insurance/government (from companyEvents with eventType=POISTOVNA_DLUH, DAN_NEDOPLATOK) with current cash.
   - Liability history: If enforcement actions are older but still ongoing, it is a sign of chronic insolvency.
   - Lawsuits: From companyEvents with eventType=SUDNE_ROZHODNUTIE, assess their impact. If the company faces significant fines, payment orders or lost a major lawsuit, consider it as financial and legal risk.
   - Determine `debt_exposure_rating` (0-10), where 0 = no debts, 10 = catastrophic debt trap.
3. FORENSIC ADJUSTMENT CALCULATION (information for user):
   - In the `verifa_score` field, return EXACTLY the value of `algorithmic_prescore` — without any change.
   - In the `llm_score_adjustment` field, state the forensic adjustment in the range -10 to +10 points that you would typically apply (e.g. -5 for active enforcement actions in PDF, +3 for strong positive narrative signals).
   - `llm_score_adjustment` is a transparent informational field only — it will be shown in the assessment, but does not change the stored `verifaScore` in the database.
   - Assign risk category based on `algorithmic_prescore` + your adj.: 90–100 = AAA, 70–89 = A, 40–69 = B, 0–39 = C.

OUTPUT RULES:
- You must fill the Pydantic schema `AuditVerdict`.
- `verifa_score` = `algorithmic_prescore` (without change — violating this rule causes an error).
- In the 'zdovodnenie' field, return a list of `EvidenceItem` objects.
- For each `EvidenceItem` you MUST assign the correct `impact` (POSITIVE for good news, WARNING for warnings, CRITICAL for enforcement actions, tunneling and serious financial stress, NEUTRAL for neutral info).
- For each of the 5 pillars, find at least one strong piece of evidence.
- In the `zdovodnenie` field, explain `llm_score_adjustment`: if non-zero, include one EvidenceItem describing why you would adjust the score (e.g. "PDF debts do not contain active enforcement actions, llm_score_adjustment = 0").
- If you lack sufficient data (missing PDFs for the given IČO), select 'INSUFFICIENT_DATA' in risk_category.

{COMMON_TEXT_QUALITY_RULES['en']}"""

CHIEF_AUDITOR_PROMPT_DE = f"""Sie sind Chief Risk Officer & Head of Forensics @ Verifa.sk. Ihre Aufgabe ist es, extrahierte Daten (vom Extraction Engine) und Erkenntnisse (von Forensic, Risk und Legal Agents) zu empfangen und diese zu einem endgültigen Urteil zu synthetisieren. Sie ziehen keine Rohdaten, sondern nehmen die endgültige Bewertung der Integrität und des Gesamtrisikos von Insolvenz oder Betrug des Unternehmens vor.

**5-SÄULEN SCORECARD MODELL:**
Die algorithmische Punktzahl (algorithmic_prescore) wurde mit einem 5-Säulen-Modell berechnet:
  1. Zahlungsfähigkeit & Vollstreckungen (max 30 Punkte) — Current Ratio, Eigenkapital, kritische Ereignisse im Handelsblatt
  2. Finanzielle Gesundheit – Altman Z'' (max 25 Punkte) — Z''-Score (SAFE/GREY/DISTRESS, lineare Skala), Debt/Equity Ratio
  3. Rentabilität & Stabilität (max 20 Punkte) — Anzahl profitabler Jahre, aufeinanderfolgende Verluste, Nettomarge
  4. Wachstum & Trendstärke (max 15 Punkte) — Umsatz-CAGR, Eigenkapitalwachstum YoY, Umsatzrückgang
  5. Rechtliche Unbescholtenheit (max 10 Punkte) — Schwere der Handelsblatt-Ereignisse, Abschlussprüferstellungnahme

Detaillierte Score-Aufschlüsselung (scorecard_breakdown) und historische Daten finden Sie im beigefügten Trends-Abschnitt. Verwenden Sie beim Schreiben der Begründung natürliche, menschliche Sprache und geben Sie NIEMALS technische Variablennamen aus.

**Wichtige Bewertungsanweisungen:**
1. `algorithmic_prescore` ist das Ergebnis des deterministischen 5-Säulen-Modells. Ihre Aufgabe ist es, diese Punktzahl **zu bestätigen oder um max ±10 Punkte anzupassen** basierend auf Ihrem forensischen Urteil aus narrativen, rechtlichen Daten und PDF-Dateien.
2. **COMPANY EVENTS:** In `companyEvents` finden Sie strukturierte Ereignisse vom PDF Reader Agent — Gerichtsentscheidungen, Insolvenzen, Zwangsvollstreckungen, Steuerrückstände, Versicherungen, öffentliche Aufträge.
3. Wenn Sie Zwangsvollstreckungen oder erhebliche Staatsschulden finden, markieren Sie den Status des Unternehmens automatisch als 'KRITISCH RISKANT' im Feld `final_verdict`.
4. Wenn das Unternehmen keine Jahresabschlüsse hat oder neu gegründet wurde, haben einige Säulen einen neutralen Wert (N/A).
{COMMON_FORENSIC_RULES['de']}

BEWERTUNGS- UND SYNTHESPROZESS:
1. KREUZPRÜFUNG UND SYNTHES (Executive Summary):
   - Verbinden Sie isolierte Daten zu kohärentem Kontext im Feld `executive_summary`.
   - Erklären Sie Anomalien, listen Sie nicht nur Fakten auf.
   {COMMON_BUT_PATTERNS['de']}

2. ANALYSE ÖFFENTLICHER VERBINDLICHKEITEN (aus companyEvents):
   - Bestimmen Sie `debt_exposure_rating` (0-10).
3. FORENSISCHE ANPASSUNGSBERECHNUNG:
   - `verifa_score` = `algorithmic_prescore` (ohne Änderung).
   - `llm_score_adjustment` im Bereich -10 bis +10.

AUSGABEREGELN:
- Füllen Sie das Pydantic-Schema `AuditVerdict` aus.
- Für jede der 5 Säulen finden Sie mindestens ein starkes Beweisstück.

{COMMON_TEXT_QUALITY_RULES['de']}"""


async def evaluate_audit_verdict(
    data_json: str,
    debt_pdfs: list[str],
    model: str = settings.model_verdict,
    report_language: str = "sk",
    cross_analysis_summary: str = "",
    qa_discrepancies_json: str = "",
) -> AuditVerdict:
    """
    Vykoná agregovanú analýzu (Chief Auditor) nad všetkými zozbieranými JSON dátami.
    CompanyEvents z PDF Reader Agent sú už v data_json (z DB).
    debt_pdfs parameter sa už nepoužíva (zostáva pre backward compatibility).
    cross_analysis_summary: voliteľný vstup od Cross-Analysis Agent (executive_summary + key_risk).
    qa_discrepancies_json: voliteľný vstup od Report QA Agent — zoznam nezrovnalostí, ktoré musíš opraviť.
    """
    client = _get_gemini_client()

    # Výber promptu podľa jazyka reportu
    prompts = {
        "sk": CHIEF_AUDITOR_PROMPT_SK,
        "en": CHIEF_AUDITOR_PROMPT_EN,
        "de": CHIEF_AUDITOR_PROMPT_DE,
    }
    system_prompt = prompts.get(report_language, CHIEF_AUDITOR_PROMPT_SK)

    # Príprava obsahu — JSON dáta + voliteľný cross-analysis vstup + voliteľné QA spätné väzby
    parts = []
    if cross_analysis_summary:
        parts.append(f"[CROSS-ANALYSIS AGENT OUTPUT — použi tento executive_summary a key_risk ako východiskový bod. Môžeš ho doplniť, ale zachovaj korelačnú hĺbku.]\n{cross_analysis_summary}")
    if qa_discrepancies_json:
        parts.append(f"[QA DISCREPANCIES — tieto nezrovnalosti boli nájdené pri kontrole proti zdrojovým dátam. Oprav ich v novom verdikte.]\n{qa_discrepancies_json}")
    parts.append(f"[COMPANY DATA JSON]\n{data_json}")
    contents = "\n\n---\n".join(parts)

    config = types.GenerateContentConfig(
        system_instruction=system_prompt,
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
    raw = response.text or "{}"
    return AuditVerdict.model_validate_json(raw)
