"""Spoločné forenzné úryvky promptov používané cross-analysis a chief-auditor agentmi."""

COMMON_BUT_PATTERNS = {
    'sk': '''**KRÍŽOVÁ ANALÝZA — VZORY "ale" (MUSÍŠ APLIKOVAŤ):**
   Tvoja analýza nesmie byť len sumarizácia faktov. Musíš aktívne hľadať rozpory a napätia medzi indikátormi. Používaj vzor "X je pozitívne, ale Y to komplikuje, čo môže znamenať Z". Tieto závery majú najväčšiu hodnotu, pretože spájajú viacero dátových zdrojov.

   Konkrétne vzory, ktoré MUSÍŠ skontrolovať a v prípade nájdenia ich reflektovať v executive_summary:

   a) LIKVIDITA vs POHĽADÁVKY: "Firma má výbornú likviditu (Current Ratio > 2), ale pohľadávky rastú rýchlejšie ako tržby za posledné 2 roky. To môže znamenať, že firma predáva na faktúru, ale zákazníci neplavia — kvalita aktív sa zhoršuje."

   b) EBITDA vs MARŽA: "EBITDA rastie medziročne, ale čistá marža klesá. Rast EBITDA je teda poháňaný vyšším obratom, nie efektivitou — firma zarabá menej na každé euro tržieb."

   c) ZISK vs CASH FLOW: "Firma vykazuje vysoký čistý zisk, ale prevádzkový cash flow je záporný alebo oveľa nižší. To môže znamenať, že zisk je papierový — peniaze reálne neprichádzajú, prípadne sa viažu v rastúcich pohľadávkach alebo zásobách."

   d) RAST TRŽIEB vs ZÁVÄZKY: "Tržby rastú, ale krátkodobé záväzky rastú ešte rýchlejšie. Rast je teda financovaný z dlhu, nie z vlastných zdrojov — pri poklese tržieb môže firma facingovať likviditnú krízu."

   e) ALTMAN Z″ vs SEKTOR: "Altman Z″ indikuje šedú zónu, ale firma pôsobí v NACE 46 (veľkoobchod), kde je vysoké D/E a nízka marža štrukturálne normálne. Skóre môže byť mierne zavádzajúce."

   f) KONCENTRÁCIA vs DIVERZIFIKÁCIA: "Firma je výborná finančne, ale ak z poznámok alebo naratívnych dát vyplýva vysoká závislosť na jednom odberateľovi alebo dodávateľovi, je to strategické riziko — strata jedného partnera môže znamenať kolaps."

   g) POZITÍVNE REGISTRE vs NEGATÍVNE TRENDY: "V registroch je firma čistá (žiadne exekúcie, žiadny konkurz), ale finančné trendy ukazujú pokles vlastného imania a rastúce straty — právna bezúhonnosť nie je garanciou finančnej stability."

   h) AUDIT vs BEZ AUDITU: "Firma nemá audit, ale vykazuje vysoké tržby a zisk. Bez nezávislého overenia nie je možné potvrdiť vernosť týchto čísel — dôveryhodnosť závierky je obmedzená."

   Tieto vzory nie sú vyčerpávajúce — aktívne hľadaj AJ ďalšie rozpory v konkrétnych dátach firmy. Čím viac krížových súvislostí nájdeš, tým vyššia kvalita posudku.

   DÔLEŽITÉ: V finálnom texte používaj "ale" malými písmenami (nie "ALE"). "ALE" veľkými písmenami znie neprirodzene a roboticky. NIKDY nepoužívaj "ALE" veľkými písmenami v texte — vždy len "ale" na začiatku vety alebo v strede vety. Napríklad správne: "Firma je zisková, ale tržby klesajú." Nesprávne: "Firma je zisková, ALE tržby klesajú."''',
    'en': '''**CROSS-ANALYSIS — "BUT" PATTERNS (MUST APPLY):**
   Your analysis must not be just a summary of facts. You must actively look for contradictions and tensions between indicators. Use the pattern "X is positive, BUT Y complicates it, which may mean Z". These conclusions have the highest value because they connect multiple data sources.

   Specific patterns you MUST check and reflect in executive_summary if found:

   a) LIQUIDITY vs RECEIVABLES: "The company has excellent liquidity (Current Ratio > 2), BUT receivables are growing faster than revenue over the last 2 years. This may mean the company sells on credit but customers are not paying — asset quality is deteriorating."

   b) EBITDA vs MARGIN: "EBITDA is growing year-over-year, BUT net margin is declining. EBITDA growth is driven by higher turnover, not efficiency — the company earns less on every euro of revenue."

   c) PROFIT vs CASH FLOW: "The company shows high net profit, BUT operating cash flow is negative or much lower. This may mean the profit is paper-based — money is not actually coming in, or is tied up in growing receivables or inventory."

   d) REVENUE GROWTH vs LIABILITIES: "Revenue is growing, BUT short-term liabilities are growing even faster. Growth is financed by debt, not equity — if revenue declines, the company may face a liquidity crisis."

   e) ALTMAN Z″ vs SECTOR: "Altman Z″ indicates a grey zone, BUT the company operates in NACE 46 (wholesale), where high D/E and low margins are structurally normal. The score may be slightly misleading."

   f) CONCENTRATION vs DIVERSIFICATION: "The company is financially excellent, BUT if notes or narrative data show high dependence on a single customer or supplier, it is a strategic risk — losing one partner could mean collapse."

   g) CLEAN REGISTRIES vs NEGATIVE TRENDS: "The company is clean in registries (no enforcement actions, no bankruptcy), BUT financial trends show declining equity and growing losses — legal integrity is not a guarantee of financial stability."

   h) AUDIT vs NO AUDIT: "The company has no audit, BUT shows high revenue and profit. Without independent verification, it is not possible to confirm the accuracy of these figures — the credibility of the financial statements is limited."

   These patterns are not exhaustive — actively look for OTHER contradictions in the company's specific data. The more cross-connections you find, the higher the quality of the assessment.''',
    'de': '''**KREUZANALYSE — "ABER" MUSTER (MÜSSEN ANGEWENDET WERDEN):**
Suchen Sie aktiv nach Widersprüchen zwischen Indikatoren. Verwenden Sie das Muster "X ist positiv, ABER Y kompliziert es, was Z bedeuten kann".

Muster, die Sie PRÜFEN MÜSSEN:
a) LIQUIDITÄT vs FORDERUNGEN: Current Ratio > 2, ABER Forderungen wachsen schneller als Umsatz.
b) EBITDA vs MARGE: EBITDA wächst, ABER Nettomarge sinkt.
c) GEWINN vs CASH FLOW: Hoher Nettogewinn, ABER operativer Cash Flow ist negativ.
d) UMSATZWACHSTUM vs VERBINDLICHKEITEN: Umsatz wächst, ABER kurzfristige Verbindlichkeiten wachsen schneller.
e) ALTMAN Z″ vs SEKTOR: Z″ zeigt graue Zone, ABER Firma in niedrigmarginen NACE-Sektor.
f) SAUBERE REGISTER vs NEGATIVE TRENDS: Saubere Register, ABER finanzielle Trends sinken.
g) AUDIT vs OHNE AUDIT: Hoher Umsatz ohne Audit — begrenzte Glaubwürdigkeit.
h) WEISSE PFERDE: Häufige Geschäftsführerwechsel + virtuelle Adresse + ausländischer Statutar = KRITISCHER RED FLAG.''',
}

COMMON_FORENSIC_RULES = {
    'sk': '''5. Zlaté kliétky (Riziko tunelovania): Ak vidíš rast tržieb, ale výrazný pokles hotovosti a rast záväzkov voči prepojeným osobám, uprav skóre smerom nadol v rámci svojho limitu. POZOR: Pri medzinárodných korporáciách (skupiny ako Hyundai, Volkswagen, Siemens atď.) sú transakcie so spriaznenými osobami ŠTANDARDNÝ vnútro-skupinový tok (transfer pricing, zdieľané služby). Tieto transakcie nepenalizuj a neznižuj za ne skóre. Nepoužívaj termín "riziko tunelovania" pre takéto bežné operácie. Namiesto toho použi neutrálnejší opis: "vysoká miera transakcií so spriaznenými osobami". Termín "tunelovanie" rezervuj len pre prípady, kde je jasný dôkaz neštandardných cenových podmienok alebo odtoku prostriedkov bez hospodárskeho opodstatnenia.
6. CHÝBAJÚCE CASH FLOW DÁTA: Na Slovensku mnoho firiem nepodáva štruktúrovaný výkaz Cash Flow do RÚZ (často je súčasťou poznámok v PDF). Ak v dátach vidíš `operatingCashFlow: null` alebo `operatingCashFlow: 0` pri firme, ktorá má kladné tržby a zisk, NEPovažuj to za forenzný red flag ani znak tunelovania. Nulový alebo chýbajúci cash flow v dátach znamená "dáta neboli k dispozícii v štruktúrovanej forme", NIE "firma má nulový cash flow". Spomeň to ako obmedzenie dát, nie ako riziko firmy.
7. SEKTOROVÉ KONTEXTY (NACE): Pri hodnotení zohľadni NACE kód firmy. Veľkoobchod a maloobchod (NACE 46, 47) má štrukturálne nízke marže (0.5–3%) a vysoké D/E ratio (5–20), pretože ide o "prietokový" biznis s vysokým obratom a záväzkami voči dodávateľom. To, čo by u výrobnej firmy znamenalo kritický stres, je pre veľkoobchod normálne. Nepenalizuj firmy v týchto segmentoch za vysoké D/E alebo nízke marže, ak sú ziskové a majú stabilný obrat.
8. TRŽBY VS AKTÍVA: U výrobných firiem s vysokým obratom (automobilový priemysel, veľkoobchod) je bežné, že ročné tržby prevyšujú celkové aktíva. Tržby reprezentujú prietok (flow) za rok, aktíva sú stav (stock) k jednému dňu. Nepovažuj to za anomáliu ani nezrovnalosť.
9. ZASTARANÝ GOING CONCERN: Ak mali výkazy z minulých rokov audítorskú výhradu (napr. Going Concern), ale ten najnovší rok (posledný dostupný) je "bez výhrad" (unqualified), znamená to, že problém bol vyriešený. Nepenalizuj firmu a nevytváraj kritické riziko za zastarané problémy z minulosti.
10. BIELE KONE A ORSR ANOMÁLIE (ORSR Forensics): V `companyEvents` (alebo v metadátach) môžeš nájsť udalosť typu `FORENSIC_ANALYSIS` s titlom "Riziko Bieleho koňa (ORSR Anomálie)" alebo podobne. Ak spoločnosť vykazuje vysokú frekvenciu zmien konateľov (napr. >2 zmeny) v kombinácii s virtuálnym sídlom a/alebo zahraničným štatutárom, MUSÍŠ to považovať za KRITICKÝ RED FLAG. VÝNIMKA: Ak ide o veľkú spoločnosť (tržby > 10 000 000 EUR alebo > 50 zamestnancov), časté zmeny štatutárov sú štandardnou korporátnou rotáciou manažmentu, NIE rizikom bieleho koňa. V takom prípade túto anomáliu ignoruj a nepenalizuj. Ak výnimka neplatí, výrazne zníž `llm_score_adjustment` (napr. -10 bodov) a vo `final_verdict` explicitne varuj pred extrémnym rizikom podvodu a tzv. "bieleho koňa". Tieto anomálie spomeň aj v `executive_summary`.''',
    'en': '''5. Golden cages (Tunneling risk): If you see revenue growth but a significant decline in cash and growth of liabilities to related parties, adjust the score downward within your limit. NOTE: For international corporations (groups like Hyundai, Volkswagen, Siemens etc.), related party transactions are a STANDARD intra-group flow (transfer pricing, shared services). Do not penalize these transactions and do not reduce the score for them. Do not use the term "tunneling risk" for such routine operations. Instead use a more neutral description: "high level of related party transactions". Reserve the term "tunneling" only for cases where there is clear evidence of non-standard pricing conditions or asset stripping without economic justification.
6. MISSING CASH FLOW DATA: In Slovakia, many companies do not file a structured Cash Flow statement to RÚZ (it is often part of notes in PDF). If you see `operatingCashFlow: null` or `operatingCashFlow: 0` for a company with positive revenue and profit, DO NOT consider this a forensic red flag or sign of tunneling. Zero or missing cash flow in the data means "data was not available in structured form", NOT "the company has zero cash flow". Mention it as a data limitation, not a company risk.
7. SECTOR CONTEXTS (NACE): When evaluating, consider the company's NACE code. Wholesale and retail (NACE 46, 47) have structurally low margins (0.5–3%) and high D/E ratios (5–20), because it is a "flow-through" business with high turnover and supplier liabilities. What would mean critical stress for a manufacturing company is normal for wholesale. Do not penalize companies in these segments for high D/E or low margins if they are profitable and have stable turnover.
8. REVENUE VS ASSETS: For manufacturing companies with high turnover (automotive, wholesale), it is common that annual revenue exceeds total assets. Revenue represents a flow over a year, assets are a stock at a single point in time. Do not consider this an anomaly or discrepancy.
9. OUTDATED GOING CONCERN: If financial statements from previous years had an auditor reservation (e.g. Going Concern), but the most recent year is "unqualified" (clean), it means the issue was resolved. Do not penalize the company and do not create a critical risk for outdated issues from the past.
10. WHITE HORSES AND ORSR ANOMALIES (ORSR Forensics): In `companyEvents` (or metadata) you may find an event of type `FORENSIC_ANALYSIS` titled "White Horse Risk (ORSR Anomaly)" or similar. If the company shows a high frequency of director changes (e.g. >2 changes) combined with a virtual address and/or foreign statutory representative, you MUST consider this a CRITICAL RED FLAG. EXCEPTION: If it is a large company (revenue > 10,000,000 EUR or > 50 employees), frequent changes of directors are standard corporate management rotation, NOT a white horse risk. In such case, ignore this anomaly and do not penalize. If the exception does not apply, significantly reduce `llm_score_adjustment` (e.g. -10 points) and in `final_verdict` explicitly warn about extreme fraud risk and the so-called "white horse". Mention these anomalies also in `executive_summary`.''',
    'de': '''5. Goldene Käfige (Tunneling-Risiko): Bei internationalen Konzernen (Hyundai, Volkswagen, Siemens etc.) sind Transaktionen mit nahestenden Personen ein STANDARDmäßiger konzerninterner Fluss. Bestrafen Sie diese Transaktionen nicht und reduzieren Sie nicht die Punktzahl dafür. Verwenden Sie den Begriff "Tunneling" nicht für solche Routineoperationen.
6. FEHLENDE CASH FLOW DATEN: Null oder fehlender Cash Flow in den Daten bedeutet "Daten in strukturierter Form nicht verfügbar", NICHT "das Unternehmen hat null Cash Flow".
7. SEKTOR-KONTEXTE (NACE): Groß- und Einzelhandel (NACE 46, 47) haben strukturell niedrige Margen (0,5–3%) und hohe D/E-Ratios (5–20).
8. UMSATZ VS VERMÖGEN: Bei Produktionsunternehmen mit hohem Umsatz ist es üblich, dass der Jahresumsatz das Gesamtvermögen übersteigt.
9. VERALTETER GOING CONCERN: Wenn frühere Jahre einen Going-Concern-Vermerk hatten, das aktuellste Jahr jedoch uneingeschränkt ("ohne Vorbehalt") ist, wurde das Problem gelöst. Bestrafen Sie das Unternehmen nicht für veraltete Probleme.
10. WEISSE PFERDE UND ORSR-ANOMALIEN: Wenn das Unternehmen eine hohe Häufigkeit von Geschäftsführerwechseln zeigt, müssen Sie dies als KRITISCHEN RED FLAG betrachten. AUSNAHME: Bei großen Unternehmen (Umsatz > 10.000.000 EUR oder > 50 Mitarbeiter) ist eine häufige Rotation des Managements normal, KEIN White-Horse-Risiko. In diesem Fall ignorieren Sie die Anomalie.''',
}

COMMON_TEXT_QUALITY_RULES = {
    'sk': '''- VŽDY používaj správnu slovenčinu: "dlžník" (nie "dižnik"), "dlžníkov" (nie "dižnikov").
- SPRÁVNE DĹŽNE: "existencie" (nie "existence"), "operatívnej" (nie "operativnej"), "administratívnej" (nie "administrativnej"), "disciplíne" (nie "discipline"), "finančné" (nie "financné"), "sú" (nie "su").
- POMLČKY: Namiesto spojovníka "-" s medzerami používaj dlhú pomlčku (en-dash "–"), napr. "354A, 355A – /391A/" nie "354A, 355A - /391A/".
- V texte NIKDY neuvádzaj historické názvy spoločností z registrov (CRZ, UVO). Vždy použi aktuálny oficiálny názov spoločnosti. Rôzne historické formy názvu (napr. "KIA Motors Slovakia" vs "Kia Slovakia") pri rovnakom IČO sú tá istá spoločnosť — neupozorňuj na ne ako na nezrovnalosť.
- V executive_summary a key_risk MUSÍŠ reflektovať významné medziročné zmeny z `analyza_trendov.revenue_trend`. Ak tržby poklesli o viac ako 5% YoY, výslovne to spomeň medzi rizikami alebo upozorneniami. Nepíš o "dlhodobej ziskovosti" ak existuje významný pokles tržieb v poslednom roku.
- Ak tržby prevyšujú aktíva (bežné pri výrobných firmách s vysokým obratom), výslovne vysvetli, že tržby sú prietok za rok zatiaľ čo aktíva sú stav k jednému dňu — nie je to anomália.
- NIKDY nepoužívaj LaTeX syntax v texte. Nepoužívaj znak "$" pre matematické vzorce. Namiesto "E/D=1.69" píš "E/D = 1,69" (s medzerami a slovenskou desatinnou čiarkou). Namiesto "Z''=8.47" píš "Z'' = 8,47". Nepoužívaj "\\prime", "^{...}", ani iné LaTeX príkazy.
- Čísla v texte vždy formátuj so slovenskou desatinnou čiarkou (1,69 nie 1.69) a medzerou ako oddeľovačom tisícov (1 000 000 nie 1000000).
- NADMERNÝ ODPOČET DPH: Pri exportne orientovaných výrobných spoločnostiach (automobilový priemysel, elektronika) je pravidelný a vysoký nadmerný odpočet DPH úplne štandardný a legálny jav. Firma nakupuje komponenty s DPH, ale vyváža hotové výrobky do zahraničia so 0 % sadzbou DPH, čo prirodzene vedie k nadmernému odpočtu. Nepovažuj to za daňové riziko ani red flag.
- ALTMAN Z'' PRE VEĽKOOBCHOD/DISTRIBÚCIU: Ak firma má nízku čistú maržu (< 2 %) a vysoké obchodné záväzky voči dodávateľom, Altman Z''-Score môže indikovať falošné riziko úpadku aj u stabilných distribučných lídrov. Pridaj upozornenie: "Metodika Altman Z'' nie je plne optimalizovaná pre nízkomaržový veľkoobchodný model s vysokým podielom obchodných záväzkov, preto môže indikovať falošné riziko úpadku aj u stabilných distribučných lídrov."
- ZÁLOŽNÉ PRÁVA NA OBCHODNÝ PODIEL: Ak v NCRZP vidíš záložné právo na obchodný podiel od banky (napr. UniCredit Bank, Tatra banka, Slovenská sporiteľňa), je to štandardné zabezpečenie prevádzkových úverov, nie známka platobnej neschopnosti. Neoznačuj to ako kritické riziko.
- REŠTRUKTURALIZÁCIA Z ORSR: Ak v ORSR výpise (sekcia "Ďalšie právne skutočnosti") vidíš zmienku o reštrukturalizácii, konkurze alebo odpustení dlhov — aj keď už skončila — MUSÍŠ to spomenúť v posudku. Napríklad: "Spoločnosť v rokoch 2022–2023 prešla formálnou reštrukturalizáciou, ktorá bola súdom úspešne ukončená." NIKDY nepíš "nemá záznamy o reštrukturalizácii" ak ORSR jasne uvádza, že prebehla. RKR (Register konkurzov a reštrukturalizácií) zobrazuje len aktuálne prebiehajúce konania — ak už skončilo, RKR ho nezobrazí, ale to neznamená, že sa nikdy nekonal.
- POČET ZAMESTNANCOV: Ak sú v dátach dostupné presné čísla (`pocet_zamestnancov`, `priemernyPocetZamestnancov`), vždy ich použi presne — nepíš "viac ako 1000 zamestnancov" ak je presná hodnota napr. 1 292. Formuluj: "Priemerný počet zamestnancov dosiahol 1 292."
- DIVIDENDY: Výplata dividend alebo rozdelenie zisku vlastníkom NIE JE automaticky negatívny vplyv na likviditu. Je to štandardné rozdelenie vykázaného zisku. Ako negatívny faktor pre likviditu ju uvádzaj len vtedy, ak dividendy výrazne presahujú disponibilnú hotovosť alebo vytvárajú tlak na pracovný kapitál. Inak ju formuluj neutrálne: "Spoločnosť vyplatila dividendy 70 mil. EUR z vykázaného zisku."
- KRÁTKE OBDOBIA (< 12 mesiacov): Ak v dátach vidíš `monthsInPeriod` s hodnotou menšou ako 12, NEinterpretuj pokles tržieb alebo zisku oproti predchádzajúcemu 12-mesačnému obdobiu ako negatívny trend. Pokles z 3-mesačného obdobia oproti 12-mesačnému je matematický dôsledok kratšieho obdobia, nie zhoršenie podnikania. V executive_summary výslovne spomeň, že ide o skrátené účtovné obdobie (napr. "Závierka za rok 2024 pokrýva len 3 mesiace, preto nie je porovnateľná s predchádzajúcimi plnými rokmi"). V Pilieri 4 (Rast & Trendová sila) neupravuj skóre nadol za pokles tržieb, ak je obdobie kratšie ako 11 mesiacov.''',
    'en': '''- Always write in correct English.
- Use en-dash ("–") instead of hyphen "-" with spaces.
- NEVER mention historical company names from registries (CRZ, UVO). Always use the current official company name. Different historical forms of the name (e.g. "KIA Motors Slovakia" vs "Kia Slovakia") for the same IČO are the same company — do not flag them as discrepancies.
- In executive_summary and key_risk you MUST reflect significant year-over-year changes from `analyza_trendov.revenue_trend`. If revenue declined by more than 5% YoY, explicitly mention it among risks or warnings. Do not write about "long-term profitability" if there is a significant revenue decline in the latest year.
- If revenue exceeds assets (common in manufacturing with high turnover), explicitly explain that revenue is a flow over a year while assets are a stock at a single point in time — it is not an anomaly.
- NEVER use LaTeX syntax in text. Do not use the "$" sign for mathematical formulas. Instead of "E/D=1.69" write "E/D = 1.69" (with spaces). Instead of "Z''=8.47" write "Z'' = 8.47". Do not use "\\prime", "^{...}", or other LaTeX commands.
- Format numbers with a decimal point (1.69 not 1,69) and space as thousands separator (1,000,000 not 1000000).
- EXCESS VAT DEDUCTION: For export-oriented manufacturing companies (automotive, electronics), a regular and high excess VAT deduction is completely standard and legal. The company buys components with VAT but exports finished products at 0% VAT rate, which naturally leads to excess deduction. Do not consider this a tax risk or red flag.
- ALTMAN Z'' FOR WHOLESALE/DISTRIBUTION: If the company has a low net margin (< 2%) and high trade payables to suppliers, Altman Z''-Score may indicate false insolvency risk even for stable distribution leaders. Add a note: "The Altman Z'' methodology is not fully optimized for low-margin wholesale models with a high proportion of trade payables, so it may indicate false insolvency risk even for stable distribution leaders."
- PLEDGES ON EQUITY: If you see a pledge on equity from a bank (e.g. UniCredit Bank, Tatra banka, Slovenská sporiteľňa) in NCRZP, it is a standard collateral for operating loans, not a sign of insolvency. Do not flag it as critical risk.
- RESTRUCTURING FROM ORSR: If the ORSR extract (section "Other legal facts") mentions restructuring, bankruptcy or debt forgiveness — even if already completed — you MUST mention it in the assessment. For example: "The company underwent formal restructuring in 2022–2023, which was successfully completed by the court." NEVER write "has no records of restructuring" if ORSR clearly states it occurred. The Bankruptcy and Restructuring Register only shows currently ongoing proceedings — if it has ended, the register no longer shows it, but that does not mean it never happened.
- EMPLOYEE COUNT: If exact employee numbers are available in the data (`pocet_zamestnancov`, `priemernyPocetZamestnancov`), always use them precisely. Do not write "more than 1000 employees" if the exact value is 1,292. Formulate: "Average number of employees reached 1,292."
- DIVIDENDS: Dividend payments or profit distribution to owners are NOT automatically a negative liquidity signal. This is standard distribution of reported profit. Only mention it as a negative liquidity factor if dividends significantly exceed available cash or put pressure on working capital. Otherwise describe it neutrally: "The company paid dividends of EUR 70 million from reported profit."
- SHORT PERIODS (< 12 months): If you see `monthsInPeriod` with a value less than 12, DO NOT interpret a decline in revenue or profit compared to the previous 12-month period as a negative trend. A decline from a 3-month period compared to a 12-month one is a mathematical consequence of the shorter period, not a deterioration of business. In executive_summary, explicitly mention that it is a shortened accounting period (e.g. "The 2024 financial statements cover only 3 months, so they are not comparable with previous full years"). In Pillar 4 (Growth & Trend Strength), do not adjust the score downward for revenue decline if the period is shorter than 11 months.''',
    'de': '''- Schreiben Sie immer in korrektem Deutsch.
- Verwenden Sie Gedankenstrich ("–") statt Bindestrich "-" mit Leerzeichen.
- NIE historische Firmennamen aus Registern erwähnen.
- NIE LaTeX-Syntax verwenden. Stattdessen "E/D = 1,69" (mit Leerzeichen und deutschem Dezimalkomma).
- Zahlen mit deutschem Dezimalkomma (1,69 nicht 1.69) und Leerzeichen als Tausendertrennzeichen (1 000 000).
- ÜBERSCHUSSIGER VORSTEUERABZUG: Bei exportorientierten Produktionsunternehmen ist ein regelmäßiger hoher Vorsteuerüberschuss völlig normal und legal.
- ALTMAN Z'' FÜR GROSSHANDEL/DISTRIBUTION: Bei niedriger Nettomarge (< 2%) kann Altman Z'' ein falsches Insolvenzrisiko anzeigen.
- PFANDRECHTE AN GESELLSCHAFTSANTEILEN: Pfandrechte an Geschäftsanteilen von Banken sind Standardbesicherungen für Betriebskredite.
- RESTRUKTURIERUNG AUS ORSR: Wenn das ORSR-Dokument Restrukturierung oder Konkurs erwähnt — auch wenn bereits abgeschlossen — MÜSSEN Sie dies erwähnen.
- MITARBEITERZAHL: Verwenden Sie immer die exakte Mitarbeiterzahl aus den Daten (`pocet_zamestnancov`, `priemernyPocetZamestnancov`). Schreiben Sie nicht "mehr als 1000 Mitarbeiter", wenn der exakte Wert z. B. 1.292 ist. Formulieren Sie: "Die durchschnittliche Mitarbeiterzahl betrug 1.292."
- DIVIDENDEN: Dividendenzahlungen oder Gewinnausschüttungen an Eigentümer sind KEIN automatisches negatives Liquiditätssignal. Es handelt sich um die standardmäßige Ausschüttung des ausgewiesenen Gewinns. Nennen Sie sie nur als negativen Liquiditätsfaktor, wenn die Dividenden das verfügbare Bargeld deutlich übersteigen oder den Working Capital Druck ausüben. Andernfalls formulieren Sie neutral: "Das Unternehmen zahlte Dividenden in Höhe von 70 Mio. EUR aus dem ausgewiesenen Gewinn."
- KURZE ZEITRÄUME (< 12 Monate): Bei `monthsInPeriod` < 12 nicht als negativen Trend interpretieren.''',
}
