"""
Generuje používateľskú príručku Verifa.sk v PDF formáte (SK, EN, DE).
Spustenie: python -m worker.src.pdf.manual_generator
Výstup: frontend/public/documents/verifa-manual-{lang}.pdf
"""
from __future__ import annotations

import os
from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import mm, cm
from reportlab.pdfgen import canvas as rl_canvas
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, PageBreak, Table, TableStyle,
    ListFlowable, ListItem, HRFlowable,
)

# ─── Font registration ───
_FONT_DIR = Path(__file__).parent.parent.parent / "assets" / "fonts"

def _register_fonts():
    try:
        pdfmetrics.registerFont(TTFont("DejaVu", str(_FONT_DIR / "DejaVuSans.ttf")))
        pdfmetrics.registerFont(TTFont("DejaVu-Bold", str(_FONT_DIR / "DejaVuSans-Bold.ttf")))
        pdfmetrics.registerFont(TTFont("DejaVu-Oblique", str(_FONT_DIR / "DejaVuSans-Oblique.ttf")))
        return "DejaVu", "DejaVu-Bold", "DejaVu-Oblique"
    except Exception:
        return "Helvetica", "Helvetica-Bold", "Helvetica-Oblique"

_FONT_REG, _FONT_BOLD, _FONT_ITALIC = _register_fonts()

# ─── Colors ───
_ACCENT = colors.HexColor("#1e40af")
_ACCENT_LIGHT = colors.HexColor("#dbeafe")
_SLATE_700 = colors.HexColor("#334155")
_SLATE_500 = colors.HexColor("#64748b")
_SLATE_300 = colors.HexColor("#cbd5e1")
_SLATE_100 = colors.HexColor("#f1f5f9")
_EMERALD = colors.HexColor("#059669")
_AMBER = colors.HexColor("#d97706")
_ROSE = colors.HexColor("#dc2626")
_WHITE = colors.white

# ─── Content ───

CONTENT = {
    "sk": {
        "title": "Používateľská príručka Verifa.sk",
        "subtitle": "Due Diligence reporty zo slovenských štátnych registrov",
        "version": "Verzia 1.0 — Júl 2026",
        "toc_title": "Obsah",
        "sections": [
            {
                "title": "1. O aplikácii Verifa.sk",
                "body": [
                    "Verifa.sk je B2B SaaS platforma, ktorá automatizuje prípravu komplexných Due Diligence reportov. Zlúči výpisy zo slovenských štátnych registrov do jedného profesionálneho PDF dokumentu s analytickou titulnou stranou, finančným posudkom a farebnými semaformi nálezov.",
                    "Platforma je určená pre právnikov, advokátov, audítorov, bankových analytikov a compliance tímy, ktorí potrebujú rýchle a spoľahlivé overenie obchodných partnerov, klientov alebo investičných cieľov.",
                ],
            },
            {
                "title": "2. Štruktúra dokumentu",
                "body": [
                    "Vygenerovaný Verifa report pozostáva z nasledujúcich častí:",
                ],
                "list": [
                    "Titulná strana — subjekt overenia, Verifa skóre, kategória rizika, zoznam zdrojov so semaformi a odkazmi na stránky",
                    "Zhrnutie — algoritmické skóre, korekcia forenzného audítora, finálne forenzné skóre, 5-pilierový rozpis",
                    "Forenzný posudok — executive summary, kľúčové riziká, zistenia a dôkazy z registrov",
                    "Súvaha (Balance Sheet) — štruktúra aktív a záväzkov s grafom a kľúčovými ukazovateľmi",
                    "Výkaz ziskov a strát (P&L) — tržby, marže, zisk s grafom a ukazovateľmi rentability",
                    "Prehľad peňažných tokov (Cash Flow) — prevádzkový, investičný a finančný CF s grafom",
                    "Altman Z''-Score — tabuľka a graf vývoja finančného zdravia firmy",
                    "Finančný posudok — analytické zhodnotenie, názor audítora, forenzné red flags, poznámky pod čiarou",
                    "Výpisy z registrov — PDF prílohy z ORSR, ZRSR, Obchodného vestníka, exekúcií, insolvancie, RPVS, zdravotných poisťovní",
                ],
            },
            {
                "title": "3. Prínosy pre používateľa",
                "body": [
                    "Verifa.sk šetrí čas a znižuje riziko ľudského vynechania dôležitých informácií:",
                ],
                "list": [
                    "Rýchlosť — report je vygenerovaný za minúty namiesto hodín manuálneho vyhľadávania",
                    "Komplexnosť — 8+ štátnych registrov v jednom dokumente s automatickým krížovým overením",
                    "Objektivita — algoritmické hodnotenie na základe verejných dát, nie subjektívneho názoru",
                    "Audit trail — každý nález má zdroj a odkaz na originálny výpis v PDF",
                    "Finančná analýza — automatický výpočet 20+ ukazovateľov (ROE, ROA, EBITDA, Altman Z-Score, likvidita, zadlženosť)",
                    "Forenzné AI — LLM analýza výročných správ, poznámok pod čiarou a vestníka pre identifikáciu rizík",
                    "Tím — zdieľanie reportov v rámci tímu, história reportov, notifikácie",
                ],
            },
            {
                "title": "4. Čo môže aplikácia odhaliť",
                "body": [
                    "Verifa.sk automaticky deteguje a klasifikuje nasledujúce nálezy:",
                ],
                "list": [
                    "Aktívne exekúcie — z Centrálneho registra exekúcií (CRE)",
                    "Insolvancia a konkurz — z Registra úpadcov",
                    "Dlhy voči štátu — sociálna poisťovňa, zdravotné poisťovne (VšZP, Union, Dôvera)",
                    "Zmeny v obchodnom registri — z Obchodného vestníka (zmeny štatutárov, predmetu činnosti, sídla, konanie/konanie)",
                    "Nespôsobilosť plniť záväzky — Altman Z''-Score < 1.1 (núdzová zóna)",
                    "Going Concern pochybnosti — z názoru audítora alebo výročnej správy",
                    "Forenzné red flags — transakcie so spojenými osobami, mimobilančné záväzky, kontingentné riziká",
                    "Negatívny auditný názor — výhrady, zamietavé stanovisko, going concern",
                    "Pokles rentability — YoY porovnanie tržieb, marží a zisku",
                    "Zhoršenie likvidity — Current Ratio, Quick Ratio, Cash Ratio pod priemerom odvetvia",
                    "Vysoká zadlženosť — D/E Ratio, dlhodobé záväzky nad priemer",
                    "Zmeny vo vedení — z výročnej správy (fluktuácia managementu ako rizikový signál)",
                ],
            },
            {
                "title": "5. Zdroje a registre",
                "body": [
                    "Verifa.sk čerpá dáta z nasledujúcich verejných zdrojov:",
                ],
                "table": [
                    ["Zdroj", "Obsah", "Status"],
                    ["ORSR", "Obchodný register SR — firmy, štatutári, predmet činnosti", "Bezplatný"],
                    ["ZRSR", "Živnostenský register — živnostníci", "Bezplatný"],
                    ["Obchodný vestník", "Zmeny v registroch, konanie/konanie, zrušenie", "Bezplatný"],
                    ["Register úpadcov", "Insolvancia, konkurz, reštrukturalizácia", "Bezplatný"],
                    ["CRE", "Centrálny register exekúcií", "Platený (5 kreditov)"],
                    ["RPVS", "Register partnerov verejného sektora", "Bezplatný"],
                    ["RÚZ", "Rozvahy, výkazy ziskov a strát, cash flow", "Bezplatný"],
                    ["SP / ZP", "Sociálna a zdravotné poisťovne — dlžníci", "Bezplatný"],
                ],
            },
            {
                "title": "6. Verifa skóre — metodika",
                "body": [
                    "Verifa skóre je automatizované hodnotenie vypočítané podľa interného modelu na základe verejne dostupných údajov. Skóre sa skladá z 5 pilierov:",
                ],
                "table": [
                    ["Pilier", "Váha", "Popis"],
                    ["Platobná schopnosť", "30%", "Exekúcie, dlhy voči štátu, insolvancia"],
                    ["Finančné zdravie", "25%", "Altman Z-Score, likvidita, zadlženosť"],
                    ["Ziskovosť", "20%", "ROE, ROA, čistá marža, EBITDA"],
                    ["Rast", "15%", "YoY zmena tržieb, aktív, zisku"],
                    ["Právna bezúhonnosť", "10%", "Vestník udalosti, zmeny štatutárov, súdne spory"],
                ],
                "body_after_table": [
                    "Finálne skóre môže byť upravené forenzným audítorom o ±10 bodov na základe forenzného úsudku, alebo -30 bodov ak sú v PDF výpisoch nájdené aktívne exekúcie alebo chronické dlhy voči štátu.",
                    "Kategórie rizika: AAA (90-100, veľmi nízkke riziko), A (70-89, nízke), B (40-69, stredné), C (0-39, vysoké).",
                ],
            },
            {
                "title": "7. Slovník pojmov",
                "body": ["Terminológia používaná v Verifa reportoch, zoradená abecedne:"],
            },
        ],
        "glossary_title": "Slovník pojmov",
        "disclaimer": "Verifa skóre je automatizované hodnotenie vypočítané podľa interného modelu na základe verejne dostupných údajov. Slúži výhradne na informatívne účely a nenahrádza oficiálny audit, daňové, právne ani investičné poradenstvo. Verifa.sk nenesie zodpovednosť za presnosť ani úplnosť uvádzaných údajov. Používateľ si pri rozhodovaní povinne overí údaje u originálnych zdrojov.",
        "page_label": "Strana",
    },
    "en": {
        "title": "Verifa.sk User Manual",
        "subtitle": "Due Diligence reports from Slovak state registries",
        "version": "Version 1.0 — July 2026",
        "toc_title": "Table of Contents",
        "sections": [
            {
                "title": "1. About Verifa.sk",
                "body": [
                    "Verifa.sk is a B2B SaaS platform that automates the preparation of comprehensive Due Diligence reports. It merges extracts from Slovak state registries into a single professional PDF document with an analytical cover page, financial assessment, and color-coded finding semaphores.",
                    "The platform is designed for lawyers, auditors, banking analysts, and compliance teams who need fast and reliable verification of business partners, clients, or investment targets.",
                ],
            },
            {
                "title": "2. Document Structure",
                "body": [
                    "A generated Verifa report consists of the following sections:",
                ],
                "list": [
                    "Cover page — subject of verification, Verifa score, risk category, source list with semaphores and page links",
                    "Summary — algorithmic score, forensic auditor correction, final forensic score, 5-pillar breakdown",
                    "Forensic assessment — executive summary, key risks, findings and evidence from registries",
                    "Balance Sheet — asset and liability structure with chart and key ratios",
                    "P&L Statement — revenue, margins, profit with chart and profitability ratios",
                    "Cash Flow — operating, investing, and financing CF with chart",
                    "Altman Z''-Score — table and chart of financial health trend",
                    "Financial assessment — analytical evaluation, auditor opinion, forensic red flags, footnotes",
                    "Registry extracts — PDF appendices from ORSR, ZRSR, Commercial Bulletin, executions, insolvency, RPVS, health insurers",
                ],
            },
            {
                "title": "3. Benefits for the User",
                "body": [
                    "Verifa.sk saves time and reduces the risk of missing critical information:",
                ],
                "list": [
                    "Speed — report generated in minutes instead of hours of manual research",
                    "Comprehensiveness — 8+ state registries in one document with automatic cross-verification",
                    "Objectivity — algorithmic scoring based on public data, not subjective opinion",
                    "Audit trail — every finding has a source and link to the original PDF extract",
                    "Financial analysis — automatic calculation of 20+ ratios (ROE, ROA, EBITDA, Altman Z-Score, liquidity, leverage)",
                    "Forensic AI — LLM analysis of annual reports, footnotes, and commercial bulletin for risk identification",
                    "Team — share reports within teams, report history, notifications",
                ],
            },
            {
                "title": "4. What the Application Can Reveal",
                "body": [
                    "Verifa.sk automatically detects and classifies the following findings:",
                ],
                "list": [
                    "Active executions — from the Central Register of Executions (CRE)",
                    "Insolvency and bankruptcy — from the Register of Insolvencies",
                    "State debts — social insurance, health insurers (VšZP, Union, Dôvera)",
                    "Commercial register changes — from the Commercial Bulletin (changes in statutory bodies, business objects, address)",
                    "Inability to meet obligations — Altman Z''-Score < 1.1 (distress zone)",
                    "Going concern doubts — from auditor opinion or annual report",
                    "Forensic red flags — related party transactions, off-balance sheet liabilities, contingent risks",
                    "Negative audit opinion — qualifications, adverse opinion, going concern",
                    "Profitability decline — YoY comparison of revenue, margins, and profit",
                    "Liquidity deterioration — Current Ratio, Quick Ratio, Cash Ratio below industry average",
                    "High leverage — D/E Ratio, long-term liabilities above average",
                    "Management changes — from annual report (management turnover as risk signal)",
                ],
            },
            {
                "title": "5. Sources and Registries",
                "body": [
                    "Verifa.sk draws data from the following public sources:",
                ],
                "table": [
                    ["Source", "Content", "Status"],
                    ["ORSR", "Commercial Register SR — companies, statutory bodies, business objects", "Free"],
                    ["ZRSR", "Trade Register — sole traders", "Free"],
                    ["Commercial Bulletin", "Register changes, liquidation, dissolution", "Free"],
                    ["Insolvency Register", "Insolvency, bankruptcy, restructuring", "Free"],
                    ["CRE", "Central Register of Executions", "Paid (5 credits)"],
                    ["RPVS", "Register of Public Sector Partners", "Free"],
                    ["RÚZ", "Balance sheets, P&L, cash flow statements", "Free"],
                    ["SP / ZP", "Social and health insurance — debtors", "Free"],
                ],
            },
            {
                "title": "6. Verifa Score — Methodology",
                "body": [
                    "The Verifa score is an automated rating calculated using an internal model based on publicly available data. The score consists of 5 pillars:",
                ],
                "table": [
                    ["Pillar", "Weight", "Description"],
                    ["Payment capacity", "30%", "Executions, state debts, insolvency"],
                    ["Financial health", "25%", "Altman Z-Score, liquidity, leverage"],
                    ["Profitability", "20%", "ROE, ROA, net margin, EBITDA"],
                    ["Growth", "15%", "YoY change in revenue, assets, profit"],
                    ["Legal integrity", "10%", "Bulletin events, management changes, litigation"],
                ],
                "body_after_table": [
                    "The final score may be adjusted by the forensic auditor by ±10 points based on forensic judgment, or -30 points if active executions or chronic state debts are found in the PDF extracts.",
                    "Risk categories: AAA (90-100, very low risk), A (70-89, low), B (40-69, medium), C (0-39, high).",
                ],
            },
            {
                "title": "7. Glossary of Terms",
                "body": ["Terminology used in Verifa reports, sorted alphabetically:"],
            },
        ],
        "glossary_title": "Glossary of Terms",
        "disclaimer": "The Verifa score is an automated rating calculated using an internal model based on publicly available data. It is intended for informational purposes only and does not replace an official audit, tax, legal, or investment advice. Verifa.sk is not responsible for the accuracy or completeness of the data provided. The user is obliged to verify the data with the original sources when making decisions.",
        "page_label": "Page",
    },
    "de": {
        "title": "Verifa.sk Benutzerhandbuch",
        "subtitle": "Due Diligence Berichte aus slowakischen Staatsregistern",
        "version": "Version 1.0 — Juli 2026",
        "toc_title": "Inhaltsverzeichnis",
        "sections": [
            {
                "title": "1. Über Verifa.sk",
                "body": [
                    "Verifa.sk ist eine B2B SaaS-Plattform, die die Erstellung umfassender Due Diligence Berichte automatisiert. Sie führt Auszüge aus slowakischen Staatsregistern in einem professionellen PDF-Dokument mit analytischer Titelseite, finanzieller Bewertung und farbcodierten Ampeln für Feststellungen zusammen.",
                    "Die Plattform richtet sich an Anwälte, Wirtschaftsprüfer, Bankanalysten und Compliance-Teams, die eine schnelle und zuverlässige Überprüfung von Geschäftspartnern, Kunden oder Investitionszielen benötigen.",
                ],
            },
            {
                "title": "2. Dokumentstruktur",
                "body": [
                    "Ein generierter Verifa-Bericht besteht aus folgenden Abschnitten:",
                ],
                "list": [
                    "Titelseite — Prüfgegenstand, Verifa-Score, Risikokategorie, Quellenliste mit Ampeln und Seitenverweisen",
                    "Zusammenfassung — algorithmischer Score, Korrektur des forensischen Prüfers, endgültiger forensischer Score, 5-Säulen-Aufschlüsselung",
                    "Forensische Bewertung — Executive Summary, Hauptrisiken, Feststellungen und Beweise aus Registern",
                    "Bilanz — Vermögens- und Kapitalstruktur mit Diagramm und Kennzahlen",
                    "Gewinn- und Verlustrechnung — Umsatz, Margen, Gewinn mit Diagramm und Rentabilitätskennzahlen",
                    "Cashflow — operativer, investiver und finanzieller CF mit Diagramm",
                    "Altman Z''-Score — Tabelle und Diagramm der finanziellen Gesundheitstendenz",
                    "Finanzielle Bewertung — analytische Auswertung, Prüfermeinung, forensische Warnsignale, Fußnoten",
                    "Registerauszüge — PDF-Anhänge aus ORSR, ZRSR, Handelsregister, Vollstreckungen, Insolvenz, RPVS, Krankenkassen",
                ],
            },
            {
                "title": "3. Nutzen für den Benutzer",
                "body": [
                    "Verifa.sk spart Zeit und reduziert das Risiko, kritische Informationen zu übersehen:",
                ],
                "list": [
                    "Geschwindigkeit — Bericht in Minuten statt Stunden manueller Recherche",
                    "Vollständigkeit — 8+ Staatsregister in einem Dokument mit automatischer Kreuzprüfung",
                    "Objektivität — algorithmische Bewertung auf Basis öffentlicher Daten, nicht subjektiver Meinung",
                    "Audit-Trail — jede Feststellung hat eine Quelle und Verweis auf den Original-PDF-Auszug",
                    "Finanzanalyse — automatische Berechnung von 20+ Kennzahlen (ROE, ROA, EBITDA, Altman Z-Score, Liquidität, Verschuldung)",
                    "Forensische KI — LLM-Analyse von Geschäftsberichten, Fußnoten und Handelsregister für Risikoidentifikation",
                    "Team — Berichte im Team teilen, Berichtshistorie, Benachrichtigungen",
                ],
            },
            {
                "title": "4. Was die Anwendung aufdecken kann",
                "body": [
                    "Verifa.sk erkennt und klassifiziert automatisch folgende Feststellungen:",
                ],
                "list": [
                    "Aktive Vollstreckungen — aus dem Zentralregister der Vollstreckungen (CRE)",
                    "Insolvenz und Konkurs — aus dem Insolvenzregister",
                    "Staatsschulden — Sozialversicherung, Krankenkassen (VšZP, Union, Dôvera)",
                    "Handelsregisteränderungen — aus dem Handelsblatt (Änderungen von Vertretungsberechtigten, Geschäftsgegenstand, Sitz)",
                    "Zahlungsunfähigkeit — Altman Z''-Score < 1.1 (Krisenzone)",
                    "Going-Concern-Zweifel — aus Prüfermeinung oder Geschäftsbericht",
                    "Forensische Warnsignale — Geschäfte mit verbundenen Unternehmen, Eventualverbindlichkeiten, bedingte Risiken",
                    "Negativer Prüfungsvermerk — Einschränkungen, Ablehnung, Going-Concern",
                    "Rentabilitätsrückgang — YoY-Vergleich von Umsatz, Margen und Gewinn",
                    "Liquiditätsverschlechterung — Current Ratio, Quick Ratio, Cash Ratio unter Branchendurchschnitt",
                    "Hohe Verschuldung — D/E Ratio, langfristige Verbindlichkeiten über Durchschnitt",
                    "Führungswechsel — aus Geschäftsbericht (Managementfluktuation als Risikosignal)",
                ],
            },
            {
                "title": "5. Quellen und Register",
                "body": [
                    "Verifa.sk bezieht Daten aus folgenden öffentlichen Quellen:",
                ],
                "table": [
                    ["Quelle", "Inhalt", "Status"],
                    ["ORSR", "Handelsregister SR — Unternehmen, Vertretungsberechtigte", "Kostenlos"],
                    ["ZRSR", "Gewerberegister — Einzelunternehmer", "Kostenlos"],
                    ["Handelsblatt", "Registeränderungen, Liquidation, Auflösung", "Kostenlos"],
                    ["Insolvenzregister", "Insolvenz, Konkurs, Restrukturierung", "Kostenlos"],
                    ["CRE", "Zentralregister der Vollstreckungen", "Kostenpflichtig (5 Credits)"],
                    ["RPVS", "Register der Partner des öffentlichen Sektors", "Kostenlos"],
                    ["RÚZ", "Bilanzen, GuV, Cashflow-Auszüge", "Kostenlos"],
                    ["SP / ZP", "Sozial- und Krankenversicherung — Schuldner", "Kostenlos"],
                ],
            },
            {
                "title": "6. Verifa-Score — Methodik",
                "body": [
                    "Der Verifa-Score ist eine automatisierte Bewertung, die nach einem internen Modell auf Basis öffentlich verfügbarer Daten berechnet wird. Der Score besteht aus 5 Säulen:",
                ],
                "table": [
                    ["Säule", "Gewicht", "Beschreibung"],
                    ["Zahlungsfähigkeit", "30%", "Vollstreckungen, Staatsschulden, Insolvenz"],
                    ["Finanzielle Gesundheit", "25%", "Altman Z-Score, Liquidität, Verschuldung"],
                    ["Rentabilität", "20%", "ROE, ROA, Nettomarge, EBITDA"],
                    ["Wachstum", "15%", "YoY-Veränderung von Umsatz, Vermögen, Gewinn"],
                    ["Rechtliche Integrität", "10%", "Handelsblatt-Ereignisse, Führungswechsel, Rechtsstreitigkeiten"],
                ],
                "body_after_table": [
                    "Der endgültige Score kann vom forensischen Prüfer um ±10 Punkte basierend auf forensischem Urteil angepasst werden, oder -30 Punkte wenn aktive Vollstreckungen oder chronische Staatsschulden in den PDF-Auszügen gefunden werden.",
                    "Risikokategorien: AAA (90-100, sehr niedriges Risiko), A (70-89, niedrig), B (40-69, mittel), C (0-39, hoch).",
                ],
            },
            {
                "title": "7. Glossar der Fachbegriffe",
                "body": ["In Verifa-Berichten verwendete Terminologie, alphabetisch geordnet:"],
            },
        ],
        "glossary_title": "Glossar der Fachbegriffe",
        "disclaimer": "Der Verifa-Score ist eine automatisierte Bewertung, die nach einem internen Modell auf Basis öffentlich verfügbarer Daten berechnet wird. Er dient ausschließlich Informationszwecken und ersetzt keine offizielle Prüfung, steuerliche, rechtliche oder Anlageberatung. Verifa.sk übernimmt keine Verantwortung für die Richtigkeit oder Vollständigkeit der bereitgestellten Daten. Der Benutzer ist verpflichtet, die Daten bei den Originalquellen zu überprüfen, wenn er Entscheidungen trifft.",
        "page_label": "Seite",
    },
}

# ─── Glossary terms (alphabetical, trilingual) ───

GLOSSARY = {
    "sk": [
        ("Altman Z''-Score", "Prediktívny model finančného zdravia firmy vyvinutý Edwardom Altmanom. Verifa používa modifikovanú verziu Z'' pre neamerické firmy. Z'' > 2.6 = bezpečná zóna, 1.1–2.6 = šedá zóna, < 1.1 = núdzová zóna (finančný stres). Čím vyššie skóre, tým menšia pravdepodobnosť bankrotu."),
        ("Cash Ratio", "Pomer hotovosti a peňažných ekvivalentov ku krátkodobým záväzkom. Najprísnejšia miera likvidity — ukazuje, či firma dokáže uhradiť všetky krátkodobé záväzky okamžite z hotovosti. Hodnota > 0.5 sa považuje za dobrú."),
        ("Current Ratio", "Pomer obežného majetku ku krátkodobým záväzkom. Ukazuje schopnosť firmy uhradiť krátkodobé záväzky z obežného majetku. Hodnota > 1.5 sa považuje za zdravú, < 1 signalizuje problémy s likviditou."),
        ("D/E Ratio (Debt-to-Equity)", "Pomer celkových záväzkov k vlastnému imaniu. Meria stupeň zadlženia firmy. Vysoká hodnota znamená vysoké riziko — firma závisí na cudzom kapitále. Priemerná hodnota sa líši podľa odvetvia, ale > 2 je všeobecne považované za rizikové."),
        ("DSO (Days Sales Outstanding)", "Priemerný počet dní, ktoré firma potrebuje na inkaso pohľadávok od zákazníkov. Nižšia hodnota = rýchlejšie inkaso = lepšia likvidita. DSO > 90 dní môže signalizovať problémy s platobnou schopnosťou zákazníkov."),
        ("DPO (Days Payable Outstanding)", "Priemerný počet dní, ktoré firma potrebuje na úhradu svojich záväzkov voči dodávateľom. Vyššia hodnota = firma drží hotovosť dlhšie, ale môže poškodiť vzťahy s dodávateľmi."),
        ("EBITDA", "Zisk pred úrokmi, zdanením, odpisami a amortizáciou (Earnings Before Interest, Taxes, Depreciation, and Amortization). Meria prevádzkovú výkonnosť firmy bez vplyvu finančných a účtovných rozhodnutí."),
        ("Equity (Vlastné imanie)", "Časť majetku firmy, ktorá patrí vlastníkom. Rovná sa celkovým aktívam mínus celkové záväzky. Pozitívne vlastné imanie je základnou podmienkou going concern."),
        ("Forenzné red flags", "Varovné signály identifikované AI analýzou, ktoré môžu indikovať podvod, manipuláciu alebo skryté riziká. Príklady: transakcie so spojenými osobami, mimobilančné záväzky, náhle zmeny v účtovných politikách."),
        ("Going Concern", "Princíp, že firma bude pokračovať v činnosti v dohľadnej budúcnosti (minimálne 12 mesiacov). Ak audítor vyjadrí pochybnosti o going concern, znamená to závažné riziko zániku firmy."),
        ("Insolvencia", "Stav, keď firma nie je schopná plniť svoje splatné záväzky. Registr úpadcov zaznamenáva konania o insolventnosti, konkurze a reštrukturalizácii."),
        ("Likvidita", "Schopnosť firmy previesť svoje aktíva na hotovosť na úhradu záväzkov. Meria sa pomocou Current Ratio, Quick Ratio a Cash Ratio."),
        ("Názor audítora", "Vyjadrenie nezávislého audítora o správnosti finančných výkazov. Typy: bez výhrad (čistý), s výhradami, zamietavý, nezistený. Výhrady alebo zamietavý názor sú silné negatívne signály."),
        ("Net Profit Margin (Čistá marža)", "Pomer čistého zisku k tržbám. Ukazuje, koľko z každého eura tržieb zostane firme po všetkých nákladoch a daniach. Hodnota > 5% je zdravá, < 0% znamená stratu."),
        ("Operating Cash Flow (Prevádzkový CF)", "Hotovostné toky z hlavnej činnosti firmy. Pozitívny OCF znamená, že firma generuje hotovosť z operácií. Negatívny OCF je vážny signál — firma 'páli' hotovosť."),
        ("Quick Ratio", "Pomer obežného majetku bez zásob ku krátkodobým záväzkom. Prísnejšia miera likvidity ako Current Ratio, pretože zásoby sú menej likvidné. Hodnota > 1 je považovaná za dobrú."),
        ("ROA (Return on Assets)", "Návratnosť aktív — pomer čistého zisku k celkovým aktívam. Ukazuje, ako efektívne firma využíva svoj majetok na generovanie zisku. Hodnota > 5% je zdravá."),
        ("ROE (Return on Equity)", "Návratnosť vlastného imania — pomer čistého zisku k vlastnému imaniu. Ukazuje, koľko zisku firma generuje pre svojich vlastníkov za každé investované euro. Hodnota > 10% je považovaná za dobrú."),
        ("Verifa Score", "Kompozitné hodnotenie firmy od 0 do 100, založené na 5 pilieroch: platobná schopnosť (30%), finančné zdravie (25%), ziskovosť (20%), rast (15%), právna bezúhonnosť (10%). Môže byť upravené forenzným audítorom."),
        ("Working Capital (Pracovný kapitál)", "Rozdiel medzi obežným majetkom a krátkodobými záväzkami. Pozitívny pracovný kapitál znamená, že firma má dostatok krátkodobých zdrojov na pokrytie krátkodobých záväzkov."),
        ("YoY (Year-over-Year)", "Medziročné porovnanie — percentuálna zmena hodnoty medzi rovnakým obdobím v dvoch po sebe nasledujúcich rokoch. Používa sa na meranie rastu tržieb, zisku, aktív atď."),
    ],
    "en": [
        ("Altman Z''-Score", "A predictive model of corporate financial health developed by Edward Altman. Verifa uses the modified Z'' version for non-US firms. Z'' > 2.6 = safe zone, 1.1–2.6 = grey zone, < 1.1 = distress zone. Higher scores indicate lower probability of bankruptcy."),
        ("Cash Ratio", "Ratio of cash and cash equivalents to current liabilities. The strictest liquidity measure — shows whether a firm can pay all short-term obligations immediately from cash. Value > 0.5 is considered good."),
        ("Current Ratio", "Ratio of current assets to current liabilities. Shows the firm's ability to pay short-term obligations from current assets. Value > 1.5 is considered healthy, < 1 signals liquidity problems."),
        ("D/E Ratio (Debt-to-Equity)", "Ratio of total liabilities to equity. Measures the degree of leverage. High values indicate high risk — the firm depends on external capital. Average varies by industry, but > 2 is generally considered risky."),
        ("DSO (Days Sales Outstanding)", "Average number of days the firm needs to collect receivables from customers. Lower = faster collection = better liquidity. DSO > 90 days may signal customer payment problems."),
        ("DPO (Days Payable Outstanding)", "Average number of days the firm takes to pay its suppliers. Higher = the firm holds cash longer, but may damage supplier relationships."),
        ("EBITDA", "Earnings Before Interest, Taxes, Depreciation, and Amortization. Measures operating performance without the influence of financing and accounting decisions."),
        ("Equity", "The portion of the firm's assets that belongs to owners. Equals total assets minus total liabilities. Positive equity is a basic requirement for going concern."),
        ("Forensic Red Flags", "Warning signs identified by AI analysis that may indicate fraud, manipulation, or hidden risks. Examples: related party transactions, off-balance sheet liabilities, sudden changes in accounting policies."),
        ("Going Concern", "The assumption that a firm will continue operating in the foreseeable future (at least 12 months). If an auditor expresses going concern doubts, it signals a serious risk of business failure."),
        ("Insolvency", "A state where a firm is unable to meet its due obligations. The Register of Insolvencies records proceedings on insolvency, bankruptcy, and restructuring."),
        ("Liquidity", "The ability of a firm to convert assets into cash to meet obligations. Measured by Current Ratio, Quick Ratio, and Cash Ratio."),
        ("Auditor Opinion", "Statement by an independent auditor on the accuracy of financial statements. Types: unqualified (clean), qualified, adverse, disclaimer. Qualifications or adverse opinions are strong negative signals."),
        ("Net Profit Margin", "Ratio of net profit to revenue. Shows how much of every euro of revenue remains after all costs and taxes. Value > 5% is healthy, < 0% means a loss."),
        ("Operating Cash Flow", "Cash flows from a firm's core operations. Positive OCF means the firm generates cash from operations. Negative OCF is a serious signal — the firm is burning cash."),
        ("Quick Ratio", "Ratio of current assets excluding inventory to current liabilities. A stricter liquidity measure than Current Ratio, because inventory is less liquid. Value > 1 is considered good."),
        ("ROA (Return on Assets)", "Ratio of net profit to total assets. Shows how efficiently a firm uses its assets to generate profit. Value > 5% is healthy."),
        ("ROE (Return on Equity)", "Ratio of net profit to equity. Shows how much profit a firm generates for its owners per euro invested. Value > 10% is considered good."),
        ("Verifa Score", "A composite rating from 0 to 100, based on 5 pillars: payment capacity (30%), financial health (25%), profitability (20%), growth (15%), legal integrity (10%). May be adjusted by the forensic auditor."),
        ("Working Capital", "The difference between current assets and current liabilities. Positive working capital means the firm has sufficient short-term resources to cover short-term obligations."),
        ("YoY (Year-over-Year)", "Year-on-year comparison — percentage change in a value between the same period in two consecutive years. Used to measure growth in revenue, profit, assets, etc."),
    ],
    "de": [
        ("Altman Z''-Score", "Ein prädiktives Modell der finanziellen Gesundheit von Unternehmen, entwickelt von Edward Altman. Verifa verwendet die modifizierte Z''-Version für nicht-amerikanische Firmen. Z'' > 2.6 = sichere Zone, 1.1–2.6 = graue Zone, < 1.1 = Krisenzone. Höhere Scores zeigen eine geringere Insolvenzwahrscheinlichkeit."),
        ("Cash Ratio", "Verhältnis von Bargeld und Zahlungsmitteln zu kurzfristigen Verbindlichkeiten. Strengste Liquiditätskennzahl — zeigt, ob ein Unternehmen alle kurzfristigen Verbindlichkeiten sofort aus Bargeld decken kann. Wert > 0.5 gilt als gut."),
        ("Current Ratio", "Verhältnis von Umlaufvermögen zu kurzfristigen Verbindlichkeiten. Zeigt die Fähigkeit, kurzfristige Verbindlichkeiten aus dem Umlaufvermögen zu decken. Wert > 1.5 gilt als gesund, < 1 signalisiert Liquiditätsprobleme."),
        ("D/E Ratio (Debt-to-Equity)", "Verhältnis der Gesamtschulden zum Eigenkapital. Misst den Verschuldungsgrad. Hohe Werte bedeuten hohes Risiko — das Unternehmen ist von Fremdkapital abhängig. Branchenabhängig, aber > 2 gilt allgemein als riskant."),
        ("DSO (Days Sales Outstanding)", "Durchschnittliche Anzahl Tage, die ein Unternehmen benötigt, um Forderungen von Kunden einzuziehen. Niedriger = schnellerer Einzug = bessere Liquidität. DSO > 90 Tage kann Zahlungsprobleme von Kunden signalisieren."),
        ("DPO (Days Payable Outstanding)", "Durchschnittliche Anzahl Tage, die ein Unternehmen benötigt, um seine Verbindlichkeiten gegenüber Lieferanten zu begleichen. Höher = das Unternehmen hält Bargeld länger, kann aber Lieferantenbeziehungen schädigen."),
        ("EBITDA", "Gewinn vor Zinsen, Steuern, Abschreibungen und Amortisation. Misst die operative Leistung ohne Einfluss von Finanzierungs- und Buchhaltungsentscheidungen."),
        ("Equity (Eigenkapital)", "Der Teil des Unternehmensvermögens, der den Eigentümern gehört. Entspricht Gesamtvermögen minus Gesamtschulden. Positives Eigenkapital ist eine Grundvoraussetzung für Going Concern."),
        ("Forensische Warnsignale", "Durch KI-Analyse identifizierte Warnsignale, die auf Betrug, Manipulation oder verborgene Risiken hindeuten können. Beispiele: Geschäfte mit verbundenen Unternehmen, Eventualverbindlichkeiten, plötzliche Änderungen der Bilanzierungspolitik."),
        ("Going Concern", "Die Annahme, dass ein Unternehmen in absehbarer Zukunft (mindestens 12 Monate) weiterbetrieben wird. Wenn ein Prüfer Going-Concern-Zweifel äußert, signalisiert dies ein ernsthaftes Risiko des Unternehmenszusammenbruchs."),
        ("Insolvenz", "Ein Zustand, in dem ein Unternehmen seine fälligen Verbindlichkeiten nicht erfüllen kann. Das Insolvenzregister verzeichnet Verfahren über Insolvenz, Konkurs und Restrukturierung."),
        ("Liquidität", "Die Fähigkeit eines Unternehmens, Vermögenswerte in Bargeld umzuwandeln, um Verbindlichkeiten zu erfüllen. Gemessen durch Current Ratio, Quick Ratio und Cash Ratio."),
        ("Prüfermeinung", "Äußerung eines unabhängigen Prüfers zur Richtigkeit der Jahresabschlüsse. Typen: ohne Einschränkung (sauber), mit Einschränkung, ablehnend, Versagungsvermerk. Einschränkungen oder ablehnende Meinungen sind starke Negativsignale."),
        ("Net Profit Margin (Nettomarge)", "Verhältnis von Reingewinn zum Umsatz. Zeigt, wie viel von jedem Euro Umsatz nach allen Kosten und Steuern verbleibt. Wert > 5% ist gesund, < 0% bedeutet Verlust."),
        ("Operating Cash Flow (Operativer CF)", "Cashflows aus dem Kerngeschäft des Unternehmens. Positiver OCF bedeutet, dass das Unternehmen Cash aus dem operativen Geschäft generiert. Negativer OCF ist ein ernstes Signal — das Unternehmen verbrennt Cash."),
        ("Quick Ratio", "Verhältnis von Umlaufvermögen ohne Vorräte zu kurzfristigen Verbindlichkeiten. Strengere Liquiditätskennzahl als Current Ratio, da Vorräte weniger liquide sind. Wert > 1 gilt als gut."),
        ("ROA (Return on Assets)", "Verhältnis von Reingewinn zu Gesamtvermögen. Zeigt, wie effizient ein Unternehmen sein Vermögen zur Gewinnerzielung einsetzt. Wert > 5% ist gesund."),
        ("ROE (Return on Equity)", "Verhältnis von Reingewinn zu Eigenkapital. Zeigt, wie viel Gewinn ein Unternehmen pro investiertem Euro für seine Eigentümer generiert. Wert > 10% gilt als gut."),
        ("Verifa Score", "Eine zusammengesetzte Bewertung von 0 bis 100, basierend auf 5 Säulen: Zahlungsfähigkeit (30%), finanzielle Gesundheit (25%), Rentabilität (20%), Wachstum (15%), rechtliche Integrität (10%). Kann vom forensischen Prüfer angepasst werden."),
        ("Working Capital (Betriebskapital)", "Die Differenz zwischen Umlaufvermögen und kurzfristigen Verbindlichkeiten. Positives Betriebskapital bedeutet, dass das Unternehmen ausreichend kurzfristige Ressourcen hat."),
        ("YoY (Year-over-Year)", "Jahresvergleich — prozentuale Veränderung eines Wertes zwischen demselben Zeitraum in zwei aufeinanderfolgenden Jahren. Wird zur Messung von Wachstum bei Umsatz, Gewinn, Vermögen etc. verwendet."),
    ],
}


# ─── PDF Builder ───

def _build_styles(lang: str) -> dict:
    base = getSampleStyleSheet()
    c = CONTENT[lang]
    styles = {
        "title": ParagraphStyle("title", parent=base["Title"], fontName=_FONT_BOLD, fontSize=24, textColor=_ACCENT, spaceAfter=6, leading=30),
        "subtitle": ParagraphStyle("subtitle", parent=base["Normal"], fontName=_FONT_REG, fontSize=12, textColor=_SLATE_500, spaceAfter=4, leading=16),
        "version": ParagraphStyle("version", parent=base["Normal"], fontName=_FONT_ITALIC, fontSize=9, textColor=_SLATE_500, spaceAfter=30),
        "h1": ParagraphStyle("h1", parent=base["Heading1"], fontName=_FONT_BOLD, fontSize=15, textColor=_ACCENT, spaceBefore=20, spaceAfter=10, leading=20),
        "h2": ParagraphStyle("h2", parent=base["Heading2"], fontName=_FONT_BOLD, fontSize=12, textColor=_SLATE_700, spaceBefore=12, spaceAfter=6, leading=16),
        "body": ParagraphStyle("body", parent=base["Normal"], fontName=_FONT_REG, fontSize=10, textColor=_SLATE_700, spaceAfter=6, leading=15, alignment=4),  # justified
        "bullet": ParagraphStyle("bullet", parent=base["Normal"], fontName=_FONT_REG, fontSize=10, textColor=_SLATE_700, spaceAfter=3, leading=14, leftIndent=6),
        "toc_item": ParagraphStyle("toc_item", parent=base["Normal"], fontName=_FONT_REG, fontSize=10, textColor=_SLATE_700, spaceAfter=4, leading=14),
        "term": ParagraphStyle("term", parent=base["Normal"], fontName=_FONT_BOLD, fontSize=10, textColor=_ACCENT, spaceAfter=2, leading=14),
        "def": ParagraphStyle("def", parent=base["Normal"], fontName=_FONT_REG, fontSize=9.5, textColor=_SLATE_700, spaceAfter=8, leading=14, leftIndent=6),
        "disclaimer": ParagraphStyle("disclaimer", parent=base["Normal"], fontName=_FONT_ITALIC, fontSize=8, textColor=_SLATE_500, spaceAfter=4, leading=12),
        "table_header": ParagraphStyle("th", parent=base["Normal"], fontName=_FONT_BOLD, fontSize=9, textColor=_WHITE, leading=12),
        "table_cell": ParagraphStyle("tc", parent=base["Normal"], fontName=_FONT_REG, fontSize=9, textColor=_SLATE_700, leading=12),
    }
    return styles


def _header_footer(canvas: rl_canvas.Canvas, doc, lang: str):
    c = CONTENT[lang]
    canvas.saveState()
    # Footer line
    canvas.setStrokeColor(_SLATE_300)
    canvas.setLineWidth(0.5)
    canvas.line(20 * mm, 15 * mm, A4[0] - 20 * mm, 15 * mm)
    # Footer text
    canvas.setFont(_FONT_REG, 8)
    canvas.setFillColor(_SLATE_500)
    canvas.drawString(20 * mm, 10 * mm, "Verifa.sk")
    canvas.drawRightString(A4[0] - 20 * mm, 10 * mm, f"{c['page_label']} {doc.page}")
    canvas.restoreState()


def _cover_page(canvas: rl_canvas.Canvas, doc, lang: str):
    c = CONTENT[lang]
    canvas.saveState()
    # Background bar
    canvas.setFillColor(_ACCENT)
    canvas.rect(0, A4[1] - 60 * mm, A4[0], 60 * mm, fill=1, stroke=0)
    # Logo text
    canvas.setFillColor(_WHITE)
    canvas.setFont(_FONT_BOLD, 28)
    canvas.drawString(25 * mm, A4[1] - 30 * mm, "Verifa.sk")
    canvas.setFont(_FONT_REG, 11)
    canvas.drawString(25 * mm, A4[1] - 38 * mm, c["subtitle"])
    # Title
    canvas.setFillColor(_SLATE_700)
    canvas.setFont(_FONT_BOLD, 20)
    canvas.drawString(25 * mm, A4[1] - 90 * mm, c["title"])
    canvas.setFont(_FONT_ITALIC, 10)
    canvas.setFillColor(_SLATE_500)
    canvas.drawString(25 * mm, A4[1] - 98 * mm, c["version"])
    # Accent line
    canvas.setStrokeColor(_ACCENT)
    canvas.setLineWidth(2)
    canvas.line(25 * mm, A4[1] - 105 * mm, 80 * mm, A4[1] - 105 * mm)
    canvas.restoreState()


def generate_manual(lang: str, output_path: Path):
    c = CONTENT[lang]
    s = _build_styles(lang)

    doc = SimpleDocTemplate(
        str(output_path),
        pagesize=A4,
        leftMargin=25 * mm,
        rightMargin=25 * mm,
        topMargin=25 * mm,
        bottomMargin=25 * mm,
        title=c["title"],
        author="Verifa.sk",
    )

    story = []

    # Cover page spacer
    story.append(Spacer(1, 120 * mm))

    # TOC
    story.append(Paragraph(c["toc_title"], s["h1"]))
    story.append(HRFlowable(width="100%", thickness=0.5, color=_SLATE_300, spaceAfter=10))
    for sec in c["sections"]:
        story.append(Paragraph(sec["title"], s["toc_item"]))
    story.append(PageBreak())

    # Sections
    for sec in c["sections"]:
        story.append(Paragraph(sec["title"], s["h1"]))
        story.append(HRFlowable(width="100%", thickness=0.5, color=_SLATE_300, spaceAfter=8))

        for para in sec.get("body", []):
            story.append(Paragraph(para, s["body"]))

        if sec.get("list"):
            items = [ListItem(Paragraph(item, s["bullet"]), value="•") for item in sec["list"]]
            story.append(ListFlowable(items, bulletType="bullet", start="•", leftIndent=12, bulletFontSize=8, spaceAfter=6))
            story.append(Spacer(1, 4))

        if sec.get("table"):
            tdata = sec["table"]
            tbl_data = []
            for i, row in enumerate(tdata):
                style = s["table_header"] if i == 0 else s["table_cell"]
                tbl_data.append([Paragraph(str(cell), style) for cell in row])
            col_widths = [50 * mm, 80 * mm, 30 * mm] if len(tdata[0]) == 3 else None
            tbl = Table(tbl_data, colWidths=col_widths, repeatRows=1)
            tbl.setStyle(TableStyle([
                ("BACKGROUND", (0, 0), (-1, 0), _ACCENT),
                ("TEXTCOLOR", (0, 0), (-1, 0), _WHITE),
                ("FONTNAME", (0, 0), (-1, 0), _FONT_BOLD),
                ("FONTSIZE", (0, 0), (-1, 0), 9),
                ("ALIGN", (0, 0), (-1, 0), "LEFT"),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("ROWBACKGROUNDS", (0, 1), (-1, -1), [_WHITE, _SLATE_100]),
                ("GRID", (0, 0), (-1, -1), 0.5, _SLATE_300),
                ("TOPPADDING", (0, 0), (-1, -1), 5),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
                ("LEFTPADDING", (0, 0), (-1, -1), 6),
                ("RIGHTPADDING", (0, 0), (-1, -1), 6),
            ]))
            story.append(Spacer(1, 6))
            story.append(tbl)
            story.append(Spacer(1, 6))

        for para in sec.get("body_after_table", []):
            story.append(Paragraph(para, s["body"]))

        story.append(Spacer(1, 8))

    # Glossary
    glossary = GLOSSARY[lang]
    story.append(Paragraph(c["sections"][-1]["title"], s["h1"]))
    story.append(HRFlowable(width="100%", thickness=0.5, color=_SLATE_300, spaceAfter=8))
    for para in c["sections"][-1].get("body", []):
        story.append(Paragraph(para, s["body"]))
    story.append(Spacer(1, 6))

    for term, definition in glossary:
        story.append(Paragraph(term, s["term"]))
        story.append(Paragraph(definition, s["def"]))

    # Disclaimer
    story.append(Spacer(1, 12))
    story.append(HRFlowable(width="100%", thickness=0.5, color=_SLATE_300, spaceAfter=6))
    story.append(Paragraph(c["disclaimer"], s["disclaimer"]))

    # Build with cover page
    def first_page(canvas, doc):
        _cover_page(canvas, doc, lang)

    def later_pages(canvas, doc):
        _header_footer(canvas, doc, lang)

    doc.build(story, onFirstPage=first_page, onLaterPages=later_pages)
    print(f"Generated: {output_path}")


def main():
    output_dir = Path(__file__).parent.parent.parent.parent / "frontend" / "public" / "documents"
    output_dir.mkdir(parents=True, exist_ok=True)

    for lang in ("sk", "en", "de"):
        output_path = output_dir / f"verifa-manual-{lang}.pdf"
        generate_manual(lang, output_path)

    print(f"\nAll manuals generated in: {output_dir}")


if __name__ == "__main__":
    main()
