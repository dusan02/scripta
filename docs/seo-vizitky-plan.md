# Verifa — SEO vizitky firiem (plán implementácie)

> **Vytvorené:** 2026-07-23
> **Stav:** Plánovaná feature — spustenie po produkčnom deploy + Paddle integrácii

## Brand pozicionovanie

**Verifa — Business Risk Report**

- **Tagline:** "Risk report o firme za 5 minút"
- **SEO keywords:** "business risk report slovensko", "riziko firmy", "overenie firmy"
- **Doména:** verifa.sk
- **Descriptor v hero:** "Business Risk Report — Finančné, právne a forenzné riziko firmy v jednom PDF. Za 5 minút. Od 14 €."
- **Diferenciácia od konkurencie:**
  - FinStat = dátový agregátor (tabuľky, 95 €/rok)
  - Valida = business intelligence / poradenstvo (free pilot, EU fond)
  - FOAF = sociálna sieť firiem (vizualizácia prepojení)
  - **Verifa = risk assessment** (finančné + právne + forenzné riziko v jednom PDF, 14 €/report)

## Cieľ

Vygenerovať SEO-optimalizované stránky pre všetky slovenské firmy (~400 000), ktoré budú zobrazovať základné finančné údaje a údaje z obchodného registra. Stránky sa generujú on-demand (ISR) z dát uložených v databáze — žiadne 400 000 statických súborov.

## Priorita — produkčný deploy prvé

SEO vizitky sa implementujú **až po** týchto krokoch:

1. Kúp doménu
2. Deploy na MyDreams.cz (server)
3. Prisma migrate deploy na produkčnú DB
4. Nastav env vars (SENTRY_DSN, CRON_SECRET, DATABASE_URL, ...)
5. Zriď Paddle účet → pošli API kľúče
6. PaddleAdapter + otestujeme webhooks
7. SEO vizitky — `/firma/[ico]` ISR stránky s 7-ročnou finančnou históriou, interaktívnymi grafmi, strojovou trend analýzou a CTA na report (detaily v tomto dokumente, Fázy 1-5)
8. Verifa Watch monitoring — denné alerty na zmeny v ORSR/RÚZ/insolvenčnom registri/vestníku/DPH pre sledované firmy, s smart interpretáciou a Risk skóre; súčasť mesačných balíkov (Freelance 10 firiem, Firma 50, Korporát 200) + free tier 3 firmy (detaily v `docs/monitoring-plan.md`)

---

## Dátové zdroje

### ORSR (Obchodný register SR)
- Názov firmy, sídlo, konatelia, spoločníci, predmet podnikania, stav firmy, IČO, DIČ
- Zdroj: verejný web scraping (máme už implementovaný scraper v workeri)
- Žiadny API kľúč, žiadny anti-bot

### RÚZ (Register účtovných závierok) — verejné JSON API
- URL: `https://www.registeruz.sk/cruz-public/api/`
- Bez API kľúča, bez anti-bot, voľne prístupné
- **SK GAAP firmy (~95%):** API vracia štruktúrované JSON tabuľky (súvaha, výkaz ziskov a strát) — žiadne PDF, žiadny LLM, čistý strojový parse cez `ruz_parser.py`
- **IFRS firmy (~5%, veľké korporácie):** API vracia len PDF prílohy — treba LLM (Gemini) na extrakciu základných metrík (tržby, zisk, aktíva, vlastný kapitál, náklady)
- **Zoznam všetkých firiem:** endpoint `/api/uctovne-jednotky` podporuje pagination (`zmenene-od`, `max_zaznamov`, `pokracovat_za_id`)

---

## Dáta v databáze

### `Company` model (Prisma ORM)
- `ico` (primary key), `name`, `naceCode`, `naceText`, `updatedAt`
- Údaje z ORSR + základné info z RÚZ

### `FinancialStatement` model
- Jeden záznam na firmu na rok
- Polia: `rok`, `celkove_aktiva`, `obezny_majetok`, `vlastne_imanie`, `kratkodobe_zavazky`, `dlhodobe_zavazky`, `trzby`, `osobne_naklady`, `zisk_po_zdaneni`, `pocet_zamestnancov`, `odpisy`, `uroky`, `hruba_marza`, `zavazky_sp`, `danove_zavazky`, `zavazky_zamestnanci`, `mena`, `typ_zavierky` (SK_GAAP / IFRS)
- **7 rokov histórie** (FinStat má len 5 — naše konkurenčné advantage)

### `VestnikEvent` model
- Dátum, typ udalosti, popis — z Obchodného vestníka

---

## Veľkosť databázy

| Položka | Záznamov | Veľkosť |
|---|---|---|
| Company (400k firiem) | 400 000 | ~80 MB |
| FinancialStatement (7 rokov) | ~2 800 000 | ~2 GB |
| Indexy (PostgreSQL) | | ~500 MB |
| **Spolu** | | **~2.5 GB** |

---

## Náklady

| Položka | Jednorazovo | Mesačne |
|---|---|---|
| Bulk import SK GAAP (397k firiem, 7 rokov, JSON parse) | $0 | — |
| Bulk import IFRS (3k firiem, 7 rokov, Gemini) | ~$315 | — |
| Denný incremental update | — | ~$5 |
| DB storage (~2.5 GB) | — | zahrnuté v VPS |
| **Spolu** | **~$315** | **~$5** |

---

## Fázy implementácie

### Fáza 1: Dátová infraštruktúra (1-2 týždne)

**1.1 RÚZ bulk import script**
- Python script ktorý paginuje cez `/api/uctovne-jednotky` → zoznam všetkých IČO
- Pre každú firmu: stiahne závierky, JSON parse cez `ruz_parser.py` → `FinancialStatement` do DB
- SK GAAP: čistý JSON, žiadny LLM
- IFRS: Gemini extrakcia (~3 000 firiem, 1 LLM call na firmu na rok)
- Beží na VPS cez víkend (~24 hodín, ~$315)
- Spúšťanie: `python scripts/bulk_import_ruz.py` v tmux/screen

**1.2 ORSR bulk import**
- Pre každé IČO z RÚZ: light ORSR scrape → `Company` model v DB
- Názov, sídlo, konatelia, predmet podnikania, stav
- ~3s na firmu, súbečnosť 5 = ~67 hodín (alebo obmedziť na top 50 000 firiem)

**1.3 Denný incremental cron**
- RÚZ: `uctovne-jednotky?zmenene-od=<včerajšie>` + `uctovne-zavierky?zmenene-od=<včerajšie>`
- ORSR: re-scrape firiem ktoré sa zmenili (podľa vestníka)
- ~15 minút/deň, ~$5/mesiac

### Fáza 2: Vizitka šablóna (1-2 týždne)

**2.1 Next.js route `/firma/[ico]`**
- ISR s `revalidate = 86400` (24h)
- DB dotazy: `Company` + `FinancialStatement` (7 rokov) + `VestnikEvent`
- Server-side render HTML
- Prvá návšteva: ~100-150 ms, cache hit: ~10-20 ms

**2.2 UI komponenty**
- Hlavička: názov, IČO, sídlo, stav firmy
- Interaktívne grafy (Recharts):
  - Tržby za 7 rokov (bar chart)
  - Zisk za 7 rokov (line chart)
  - Aktíva + vlastný kapitál (area chart)
  - Zadlženosť % (line chart)
- Tabuľka: posledný rok detail (tržby, zisk, aktíva, zamestnanci)
- Strojová trend analýza (rule-based kód, **žiadny LLM, žiadne halucinácie, €0**):
  - Rast/klesanie tržieb (počet rokov po sebe) — "Tržby rastú 4. rok po sebe"
  - Stabilita zisku (koeficient variancie) — "Zisk je nestabilný — výrazne kolíše"
  - Trend zadlženosti (prvý vs posledný rok) — "Zadlženosť sa znižuje (z 68% na 65%)"
  - Osobné náklady vs tržby (rast %) — "Osobné náklady rastú rýchlejšie ako tržby"
  - Počet zamestnancov (delta) — "Počet zamestnancov stúpol z 250 na 350"
  - Generuje 3-5 viet unikátneho textu pre každú firmu z reálnych čísel v DB
  - Náklady: **$0** (rule-based kód, nie LLM). LLM alternatíva by stála ~$600 pre 400k firiem s rizikom halucinácií
  - Príklad výstupu pre Tatranskú mliekareň (IČO 31654363):
    ```
    Tržby rastú 4. rok po sebe (z 90.4M € v 2020 na 134.6M € v 2024).
    Zisk je nestabilný — výrazne kolíše medzi rokmi.
    Zadlženosť sa znižuje (z 68% na 65%).
    Osobné náklady rastú rýchlejšie ako tržby (+65% vs +49%).
    Počet zamestnancov stúpol z 250 na 350.
    ```
- Odvetvové porovnanie — "Tatranská mliekareň je 3. najväčšia firma v odvetví podľa tržieb" (generované z DB)
- Vestník udalosti (posledných 5)
- **Skrátené výkazy:** Súvaha a Výkaz ziskov a strát v skrátenej podobe na jednej obrazovke (pre CFO/účtovníkov ktorí chcú vidieť raw dáta)
- CTA: "Business Risk Report — 14 €" + "Monitoring v balíkoch"

**2.3 SEO meta tagy**
- `<title>`: "[Názov firmy] — IČO [ICO] | Finančné údaje | Verifa"
- `<meta description>`: "[Názov firmy], IČO [ICO]. Tržby, zisk, aktíva za 7 rokov. Sídlo [mesto]. Bezplatné finančné údaje a trend analýza."
- JSON-LD `Organization` schema (Google rich results)
- Open Graph tags (zdieľanie na sietiach)

### Fáza 3: Sitemap a indexácia (2-3 dni)

**3.1 Sitemap generátor**
- Dynamický `sitemap.xml` — vygeneruje URL pre všetky IČO v DB
- Rozdeliť na `sitemap-1.xml`, `sitemap-2.xml`, ... (50 000 URL na súbor — Google limit)
- ~8 sitemap súborov pre 400 000 firiem

**3.2 Google Search Console**
- Submit sitemap
- Monitorovať indexáciu (Coverage report)
- Google crawluje ~500-2 000 URL/deň na novej doméne
- Nedá sa nahadzovať URL hromadne ručne — sitemap je primárny spôsob

**3.3 Internal linking**
- Blog články linkujú na vizitky: "Top 10 mliekarní na Slovensku" → link na `/firma/31654363`
- Homepage: "Prehľadávať firmy" → zoznam najväčších firiem
- Každá vizitka: "Súvisiace firmy v odvetví" → cross-linking medzi firmami s rovnakým NACE kódom

### Fáza 4: Cache warming (voliteľné, 1 deň)

- Script prejde 1 000 URL najväčších firiem (podľa tržieb z DB)
- ~8 minút, ~15 MB cache
- Tieto firmy = 80% organic trafficu
- Zlepší prvý načítanie z ~150ms na ~20ms

### Fáza 5: Obsahový marketing (priebežne)

**5.1 Blog články na verifa.sk/blog**
- "Najrýchšie rastúce IT firmy na Slovensku 2024"
- "Top 10 mliekarní podľa tržieb"
- "Firmy s najväčším ziskom v Bratislavskom kraji"
- AI generované z DB dát — každý článok linkuje na 10-50 vizitiek
- Backlinky idú na našu doménu → rastie domain authority

**5.2 Zoznamy / filtre**
- `/odvetvie/[nace]` — zoznam firiem v odvetví
- `/kraj/[kraj]` — zoznam firiem v kraji
- `/odvetvie/[nace]/kraj/[kraj]` — kombinácia
- `/najvacsie-firmy/podla-trzieb` — top 100
- Internal linking — zoznamy linkujú na vizitky → Google ich nájde rýchlejšie
- Long-tail keywords: "firmy v Bratislavskom kraji", "poľnohospodárske firmy Slovensko"

---

## Časový harmonogram

| Fáza | Trvanie | Kedy |
|---|---|---|
| **0. Produkčný deploy + Paddle** | 1-2 týždne | Teraz |
| **1. Dátová infraštruktúra** | 1-2 týždne | Po Fáze 0 |
| **2. Vizitka šablóna** | 1-2 týždne | Po Fáze 1 |
| **3. Sitemap + Search Console** | 2-3 dni | Po Fáze 2 |
| **4. Cache warming** | 1 deň | Po Fáze 3 |
| **5. Obsahový marketing** | Priebežne | Po Fáze 3 |

**Prvé vizitky live:** ~3-4 týždne po produkčnom deploy.
**Prvý Google traffic:** ~1-2 mesiace po submit sitemap.
**Výrazný traffic:** ~6-12 mesiacov (domain authority rastie).

---

## Konkurenčná výhoda

| Funkcia | FinStat | Valida | Verifa |
|---|---|---|---|
| História fin. dát | 5 rokov | 3-5 rokov | **7 rokov** |
| Interaktívne grafy | Nie (tabuľky) | Nie | **Áno** |
| Strojová trend analýza | Nie | Nie | **Áno** |
| Business Risk Report | Nie | Nie | **Áno** |
| Monitoring zmeny firmy | Áno (platené) | Áno (free) | Plánované |
| Cena plného reportu | 350 €/rok | Free | **14 €/report** |

---

## Technológický stack

- **Frontend:** Next.js (React, TypeScript, Tailwind CSS)
- **Grafy:** Recharts
- **DB:** PostgreSQL + Prisma ORM
- **Hosting:** VPS (MyDreams.cz) s PM2
- **RÚZ API:** `https://www.registeruz.sk/cruz-public/api/` (verejné, zdarma)
- **ORSR scraping:** existujúci Python scraper v workeri
- **IFRS extrakcia:** Google Gemini 1.5 Flash (pre ~3 000 veľkých firiem)
- **ISR cache:** Next.js Incremental Static Regeneration (24h revalidate)

---

## SEO URL štruktúra

```
verifa.sk/firma/[ico]              — vizitka firmy
verifa.sk/odvetvie/[nace]          — zoznam firiem v odvetví
verifa.sk/kraj/[kraj]              — zoznam firiem v kraji
verifa.sk/najvacsie-firmy          — top firmy podľa tržieb
verifa.sk/blog/[slug]              — blog články
```

---

## Riziká a mitigácia

### Riziko 1: Thin Content — Google odmietne zaindexovať stránky

**Popis:** Ak Google vyhodnotí vygenerované stránky ako "Thin Content" (málo unikátneho obsahu, len tabuľky a čísla), môže odmietnuť zaindexovať vekú časť z 400 000 firiem. Google má algoritmus "Programmatic SEO Detection" ktorý identifikuje stránky generované z databázy.

**Mitigácia:**
- **Strojová trend analýza** — generuje 3-5 viet unikátneho textu pre každú firmu z reálnych čísel (napr. "Tržby rastú 4. rok po sebe", "Zisk nestabilný, kolíše", "Osobné náklady rastú rýchlejšie ako tržby"). Každá veta je iná pre každú firmu.
- **Interaktívne grafy** — zvyšujú time-on-page a znižujú bounce rate (Google meria user engagement)
- **Vestník udalosti s dátumami** — ďalší unikátny obsah ktorý sa líši firmu od firmy
- **Odvetvové porovnanie** — "Tatranská mliekareň je 3. najväčšia firma v odvetví podľa tržieb" — unikátny text generovaný z DB
- **Internal linking** — súvisiace firmy v odvetví, zoznamy — Google vidí obsahovú štruktúru
- **Postupné spúšťanie** — nepublikovať 400 000 URL naraz; Google crawluje postupne cez sitemap, ISR generuje on-demand

### Riziko 2: Konverzná frikcia — vizitka je "príliš dobrá"

**Popis:** Zákazník získa toľko dát zadarmo (7 rokov histórie, grafy, trend analýza), že môže stratiť motiváciu kúpiť si 14 € Business Risk Report.

**Mitigácia:**
- **Vizitka ukazuje ČO — report povie PREČO a ČO S TÝM.** Vizitka ukáže čísla a trendy. Report ponúkne interpretáciu, riziká a odporúčania.
- **CTA musí sľubovať to čo vizitka NEUKÁŽE:**
  - Risk score 0-100 (vizitka nemá)
  - 15+ špecifických rizík s odporúčaním (vizitka nemá)
  - Skryté prepojenia konateľov medzi firmami (vizitka nemá)
  - Analýza verejných obstarávaní a zmlúv (vizitka nemá)
  - Exekúcie a súdne spory (vizitka nemá)
  - AI narrative analýza — prečo zisk klesol, čo to znamená pre partnerstvo (vizitka ukáže len "zisk klesá")
- **CTA text:** "Bezplatná vizitka ukazuje ČÍSLA. Business Risk Report vám povie ČO ZNAMENAJÚ."

### Riziko 3: Halucinácie pri IFRS extrakcii (Gemini)

**Popis:** Gemini vymyslí finančnú metriku ktorá v PDF nie je. Korporátny klient zaplatí 14 € report, nájde nezmyselné číslo, stratí dôveru navždy.

**Mitigácia:**

**A. SK GAAP (95% firiem) — žiadny LLM, žiadne halucinácie**
- RÚZ API vracia štruktúrované JSON tabuľky — `ruz_parser.py` extrahuje priamo z JSON cez mapovanie riadkov
- Unit testy v `worker/tests/test_ruz_parser.py` (318+ riadkov)
- Sanity checks: balance sheet consistency (aktíva = pasíva ±2%), unit detection (EUR vs tisíce EUR)

**B. IFRS (5% firiem) — obmedzený Gemini output**
- Gemini nedostáva voľnú úlohu "analyzuj závierku" — dostáva štruktúrovaný prompt ktorý žiada len konkrétne čísla (tržby, zisk, aktíva, vlastný kapitál, náklady)
- Menej output = menej priestor na halucináciu
- Návrat vo formáte JSON: `{"trzby": number, "zisk": number, ...}`

**C. Validácia každej extrahovanej hodnoty (rule-based kód)**
- Aktíva = Pasíva (±2% tolerancia)
- Tržby > 0 (firma ktorá reportuje tržby nemôže mať záporné)
- Vlastné imanie < Aktíva (kapitál nemôže prevyšovať aktíva)
- Rok = očakávaný (extrakcia musí vrátiť správny rok)
- Rozumný rozsah (hodnoty v intervale pre danú veľkosť firmy)
- **Výnimka "Zisk < Tržby":** Toto pravidlo NEplatí pre finančné holdingy, investičné entity a firmy ktoré predali investičný majetok. Namiesto hard rule použiť soft warning + flag na review.
- **Medziročné anomálie:** Ak metrika bez zjavného dôvodu poskočí/klesne o >200% oproti predchádzajúcemu roku → interný "flag" na preskúmanie (najmä pre metriky ktoré nevstupujú do Aktíva=Pasíva rovnice, napr. osobné náklady — OCR môže prečítať "8" ako "3")

**D. Cross-check s RÚZ metadátami**
- Počet zamestnancov z RÚZ metadata vs Gemini extrakcia
- Rok závierky z RÚZ metadata vs Gemini extrakcia
- Ak sa nezhodujú → retry alebo označiť ako failed

**E. Fail-Safe mechanizmus (Graceful Fallback)**
- Ak Gemini extrakcia zlyhá alebo validácia neprejde → **neuložiť do DB**
- Vizitka ukáže: "Finančné dáta pre túto firmu nie sú dostupné v strojovo čitateľnom formáte" + CTA na report
- Transparentnosť chráni značku pred nezmyselnými grafmi

**F. QA vrstva**
- Už máme: `worker/tests/test_ruz_parser.py` (SK GAAP), sanity checks v `ruz_parser.py`
- Pridáme: 10-20 reálnych IFRS PDF vzoriek (banky, poisťovne, výrobné firmy), automated test (extrahuj → over s ručne zadanými hodnotami → porovnaj), CI pipeline, monitoring failed extrakcií

### Riziko 4: Business Risk Report (14 €) — príliš kreatívne hľadanie rizík

**Popis:** Platený report kombinuje overené čísla z DB s Gemini narrative interpretáciou. Ak Gemini vymyslí riziko ktoré v číslach nie je, používateľ to spozná a stratí dôveru.

**Mitigácia — štruktúrovaný system prompt:**

Report sa negeneruje ako voľný text. Generuje sa v **troch fázach** s rôznymi úrovňami LLM kreativity:

**Fáza 1: Deterministická (žiadny LLM)**
- Všetky čísla, grafy, trendy — z DB, rule-based kód
- Risk score výpočet — formula s váhami (zadlženosť, likvidita, ziskovosť, stabilita)
- Toto je **vždy presné**, žiadna halucinácia

**Fáza 2: Interpretácia (LLM s úzkymi mantinelmi)**
- Gemini dostáva **čísla + kontext** a interpretuje ich
- System prompt obmedzuje output na **overené riziká**:

```
Si finančný analytik. Analyzuj túto firmu na základe POSKYTNUTÝCH DÁT.

PRÍSNÉ PRAVIDLÁ:
1. Vymenuj IBA riziká ktoré PRIAMO VYPLÝVAJÚ z čísel v dátach.
2. Pre každé riziko uveď KONKRÉTNE číslo z dát ktoré ho dokazuje.
3. NEVYMÝŠLAJ riziká ktoré nemajú oporu v dátach.
4. Ak dáta neukazujú riziko, napíš "V tejto oblasti sme nezaznamenali varovné signály."
5. Nepoužívaj špekulatívne jazyk ("možno", "pravdepodobne", "by mohlo").
6. Každé tvrdenie musí mať číselný dôkaz z dát.

DÁTA:
[FinancialStatement 7 rokov — JSON]
[VestnikEvent — zoznam zmien]
[Company — ORSR dáta]

OUTPUT FORMÁT:
Pre každú oblasť (zadlženosť, likvidita, ziskovosť, rast, stabilita):
- Stav: [normálny / varovný / kritický]
- Dôkaz: [konkrétne číslo z dát]
- Interpretácia: [1-2 vety, faktické]
```

**Fáza 3: Odporúčanie (LLM s obmedzením)**
- Na základe identifikovaných rizík → odporúčanie ("spolupracovať s opatrnosťou" / "vyhnúť sa")
- Gemini **nemôže** recommendovať na základe rizík ktoré neboli identifikované v Fáze 2

**Kľúčný princíp: Číslo → Interpretácia → Odporúčanie.** LLM pracuje IBA s číslami z DB. Nemá prístup k internetu, nemá "všeobecné vedomosti" o firme — len dáta ktoré mu dodáme.

---

## Poznámky

- **Žiadne reklamy (AdSense) na vizitkách** — vizitka je konverzná stránka, jediný účel = predať Business Risk Report alebo monitoring
- **Žiadny live scraping pri zobrazení vizitky** — všetky dáta už v DB z bulk importu
- **Apino.sk** — zvažovať len ako fallback pre live ORSR lookup firmy ktorú nemáme v DB; pre bulk import je príliš drahé a pomalé (limit 15 000 requestov/mesiac)
- **Bot na fakenie trafficu** — NEDOPORUČUJEM, proti Google Webmaster Guidelines, riziko banovania domény
- **Cache warming** — voliteľné, len pre top 1 000 firiem; zlepší prvý načítanie z 150ms na 20ms
- **Denný incremental** — firmy podávajú závierku raz ročne (do 31. marca), takže denný update = len nové/zmenené záznamy
