# KIMI — UX/UI REDESIGN: Public Company Page `/firma/[ico-slug]`

## Kontext

Verifa.sk je slovenská platforma pre business intelligence o firmách. Stránka `/firma/[ico-slug]` je verejná company profile stránka — hlavný SEO entry point s ~500k indexovaných firiem.

Aktuálna stránka je **funkčne kompletná** (25+ sekcií, finančné dáta, risk signály, persons, related firms), ale má **zlú information hierarchy**:
- Risk signály sú pohrebené na pozícii #11
- Finančné sekcie nemajú H2 nadpisy (používajú H3 cez ChartCard komponent)
- "Čo firma robí" (predmet činnosti) je až po scrollovaní
- Nad KPI kartami je 3x duplicitná informácia o zdrojoch
- Mobile má horizontálny overflow tabuliek
- Stránka pôsobí ako "databázová tabuľka" nie "research page"

**Cieľ redesignu:** Z existujúcich dát a komponentov vytvoriť profesionálnu research/company profile stránku s jasnou hierarchiou, dobrým mobile UX a sémanticky správnou heading štruktúrou.

---

## ČO NESMIEŠ MENIŤ — Hard Rules

1. **Nemeníš business logic ani dátové zdroje.** Všetky queries, API volania, data fetching zostávajú ako sú.
2. **Nemažeš existujúce dáta ani komponenty.** Iba ich lepšie organizuješ a hierarchizuješ.
3. **Nevytváraš nové metriky ani nové dáta.** Používaš iba to, čo už `page.tsx` posúva do komponentov.
4. **Nemeníš názvy existujúcich i18n kľúčov.** Môžeš pridať nové i18n kľúče ak potrebuješ nové nadpisy.
5. **Nemeníš `getCompanyData()`, `computeFinancialIndicators()`, `computePiotroski()` ani iné lib funkcie.**
6. **Nemeníš JSON-LD output.** Schema.org structured data zostáva ako je.
7. **Nemeníš `generateMetadata()` ani SEO meta tags.**
8. **Nemeníš middleware, slug validation, ani redirect logiku.**
9. **Nemeníš `revalidate = 86400` ani `dynamicParams = true`.**
10. **Nemeníš PrintButton, ThemeToggle, ani LanguageProvider.**

---

## ČO MÔŽEŠ MENIŤ

1. **Poradie sekcií** v `page.tsx` (JSX render order)
2. **Heading levels** — pridanie/odstránenie H2 nadpisov pre finančné sekcie
3. **Layout grid** — zmena z `grid-cols-1 lg:grid-cols-2` na iné rozloženie
4. **Collapsible sekcie** — pridanie `<details>`/`<summary>` alebo useState toggle pre detaily
5. **Spacing** — `mb-6 sm:mb-8` môžeš upraviť na iné hodnoty
6. **Mobile tabuľky** — pridanie `overflow-x-auto` alebo transformácia na karty na mobile
7. **Visual hierarchy** — veľkosti nadpisov, farby, vypisovanie
8. **Duplicitné bloky** — zlúčenie Source attribution + Provenance do jedného riadku
9. **CompanyInsights** — môžeš nahradiť 1-2 vetovým "Financial Summary" narativom (ale z rovnakých dát)
10. **SigningAuthority** — môžeš presunúť ako H3 pod Predmet činnosti alebo Persons

---

## FINÁLNE PORADIE SEKCIÍ

Toto je **presné poradie**, v akom sa majú sekcie renderovať. Nie je to návrh — je to zadanie.

```
┌─────────────────────────────────────────────────────────┐
│ STICKY HEADER                                           │
│ Logo | PrintButton | ThemeToggle | "Prihlásiť sa"       │
│ (secondary CTA — NIE "Objednať report")                  │
├─────────────────────────────────────────────────────────┤
│ BREADCRUMB                                              │
│ Verifa.sk / Firma / Company Name                        │
├─────────────────────────────────────────────────────────┤
│                                                         │
│ COMPANY HEADER (H1)                                     │
│  ├─ H1: Company Name                                    │
│  ├─ Metadata riadok: IČO · právna forma · sídlo · založená│
│  ├─ NACE text (klikateľný link na /odvetvie/X)          │
│  ├─ Risk badge (ak existujú risk signály):              │
│  │   "⚠ N rizikových signálov" — farebný badge         │
│  ├─ Status badge (ak neaktívna firma):                  │
│  │   BANKRUPT/LIQUIDATION/RESTRUCTURING/DISSOLVED       │
│  └─ Kraj / okres / RÚZ tags (klikateľné)                │
│                                                         │
├─────────────────────────────────────────────────────────┤
│                                                         │
│ KEY FACTS (bez nadpisu — riadok s tagmi)                 │
│  ├─ Zamestnanci: N                                      │
│  ├─ Veľkosť firmy: N                                    │
│  ├─ Druh vlastníctva: X                                 │
│  ├─ Základné imanie: N €                                │
│  └─ Aktualizované: DD.MM.YYYY                           │
│  (Zlúčené zo Source attribution + Provenance —          │
│   jeden riadok, nie tri samostatné bloky)                │
│                                                         │
├─────────────────────────────────────────────────────────┤
│                                                         │
│ KPI CARDS (4)                                           │
│  ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐              │
│  │ Tržby  │ │ Zisk   │ │Vlastné │ │ Aktíva │              │
│  │        │ │/Strata │ │imanie  │ │        │              │
│  │ value  │ │ value  │ │ value  │ │ value  │              │
│  │ ↓ 2%   │ │ ↑ 59%  │ │ ↑ 33%  │ │ → 0%   │              │
│  └────────┘ └────────┘ └────────┘ └────────┘              │
│  Desktop: 4×1 | Mobile: 2×2                             │
│  Poradie: Tržby → Zisk → Vlastné imanie → Aktíva        │
│  (vymenil som Aktíva a Imanie oproti súčasnému stavu)    │
│                                                         │
├─────────────────────────────────────────────────────────┤
│                                                         │
│ FINANCIAL SUMMARY (H2: "Finančné zhrnutie")             │
│  1–2 vety automaticky generované z dát:                 │
│  "Protherm je stabilná stredná firma s rastúcim         │
│  ziskom (+59%) a klesajúcimi tržbami (-2%).             │
│  Zisková marža dosiahla 6.1%."                          │
│  (Nahrádza CompanyInsights — použi rovnaké dáta,        │
│   ale komprimuj do 1-2 viet namiesto 4+ bulletov)       │
│                                                         │
├─────────────────────────────────────────────────────────┤
│                                                         │
│ RISK SIGNALS (H2: "Rizikové signály a udalosti")        │
│  Iba ak existujú signály (ak signals.length === 0,      │
│  nezobrazuj nič — žiadny "Neboli identifikované")       │
│  Farebné karty: critical=red, high=red, medium=orange,  │
│  low=gray                                                │
│  Každý signál: source badge + title + severity badge   │
│  + description + date                                   │
│  (Toto je presunutie z pozície #11 na pozíciu #6)       │
│  ┌─ Ak existujú VestnikEvents alebo CompanyEvents,      │
│  │  zobraz ich ako H3 pod Risk Signals (nie samostatné  │
│  │  H2 sekcie)                                          │
│  └─ Ak neexistujú, nezobrazuj nič                       │
│                                                         │
├─────────────────────────────────────────────────────────┤
│                                                         │
│ PEOPLE (H2: "Osoby")                                    │
│  ├─ H3: Štatutári (N)                                   │
│  │   Meno, mesto, (od MM/YYYY)                          │
│  ├─ H3: Spoločníci (N)                                  │
│  ├─ H3: Dozorná rada (N) — ak existuje                  │
│  ├─ H3: Konanie menom spoločnosti                       │
│  │   (presunuté z samostatnej H2 sekcie)                │
│  └─ Bývalé osoby (collapsed toggle)                     │
│      "Zobraziť bývalé osoby (N)"                        │
│                                                         │
├─────────────────────────────────────────────────────────┤
│                                                         │
│ BUSINESS ACTIVITY (H2: "Predmet činnosti")              │
│  Plný text businessActivity                             │
│  Collapsible ak > 300 znakov (rovnaké ako teraz)        │
│                                                         │
├─────────────────────────────────────────────────────────┤
│                                                         │
│ SÚVAHA (H2: "Súvaha")                                   │
│  Grid 1×2 (desktop) / 1×1 (mobile)                      │
│  ├─ LEFT: Sankey chart (H3: "Štruktúra súvahy")        │
│  └─ RIGHT: BalanceSheetTable (H3: "Súvaha v tis. €")   │
│  (Pridený H2 nadpis — teraz je iba H3 cez ChartCard)    │
│                                                         │
├─────────────────────────────────────────────────────────┤
│                                                         │
│ VÝKAZ ZISKOV A STRÁT (H2: "Výkaz ziskov a strát")      │
│  Grid 1×2 (desktop) / 1×1 (mobile)                      │
│  ├─ LEFT: RevenueProfitChart (H3: "Tržby a zisk")      │
│  └─ RIGHT: ProfitLossTable (H3: "Detailný výkaz")      │
│  (Pridený H2 nadpis)                                    │
│                                                         │
├─────────────────────────────────────────────────────────┤
│                                                         │
│ PIOTROSKI F-SCORE (H2: "Piotroski F-Score — ROK")      │
│  Score N/9 + assessment + 9 kritérií so ✓/✗            │
│  (Pridený H2 nadpis — presunuté z pozície #18)         │
│                                                         │
├─────────────────────────────────────────────────────────┤
│                                                         │
│ CASH FLOW (H2: "Cash flow") — COLLAPSIBLE              │
│  Defaultne COLLAPSED                                    │
│  <details><summary>Cash flow</summary>                 │
│  Tabuľka: operating, investing, financing CF           │
│  (Pridený H2, collapsible)                             │
│                                                         │
├─────────────────────────────────────────────────────────┤
│                                                         │
│ DETAILNÉ FINANČNÉ UKAZOVATELE (H2) — COLLAPSIBLE       │
│  Defaultne COLLAPSED                                    │
│  <details><summary>Detailné ukazovatele</summary>      │
│  ├─ H3: Ďalšie ukazovatele (ExtendedRatios)            │
│  │   Quick ratio, Working capital, D/E, Interest cov. │
│  ├─ H3: Vývoj zamestnancov (EmployeeTrend)              │
│  ├─ H3: Rentabilita (chart + table)                    │
│  │   ROE, ROA, Zisková marža                            │
│  └─ H3: Finančná stabilita (chart + table)             │
│      Zadlženosť, Krátkodobé/Dlhodobé záväzky, Likvidita │
│  (Finančné ratios ZOSTÁVAJÚ na stránke — iba collapsed)│
│  (Pridený H2 nadpis pre všetky detaily)                │
│                                                         │
├─────────────────────────────────────────────────────────┤
│                                                         │
│ REPORT CTA (H2: "Preverte firmu NAME")                  │
│  Primary CTA — 14€, 5 benefits, "Preveriť túto firmu →"│
│  (Zostáva na rovnakom mieste — po finančných sekciách)  │
│                                                         │
├─────────────────────────────────────────────────────────┤
│                                                         │
│ FAQ (H2: "Často hľadané informácie — NAME")             │
│  6 Q&A — SEO long-tail content                          │
│  (Zostáva)                                              │
│                                                         │
├─────────────────────────────────────────────────────────┤
│                                                         │
│ ZDROJE ÚDAJOV (H2: "Zdroje údajov") — COLLAPSIBLE       │
│  Defaultne COLLAPSED                                     │
│  ORSR, RÚZ, Vestník — syncedAt, dataRange              │
│  (Pridený collapsible — zbytočne dominantné defaultne)  │
│                                                         │
├─────────────────────────────────────────────────────────┤
│                                                         │
│ SÚVISIACE FIRMY (H2: "Súvisiace firmy")                 │
│  ├─ Hub backlinks (kraj, odvetvie, mesto)              │
│  ├─ H3: Firmy v rovnakom odvetví v kraj                 │
│  ├─ H3: Najväčšie firmy v rovnakom odvetví              │
│  ├─ H3: Firmy v meste                                   │
│  └─ H3: Spoločnosti spojené s osobami firmy             │
│  (Zostáva na konci — správne pre SEO/internal linking) │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

---

## HEADING HIERARCHY — Sémantická štruktúra

Toto je **kritické**. Aktuálne finančné sekcie používajú `<h3>` cez ChartCard komponent, ale nemajú nadradené H2. V HTML hierarchii sú pod "Rizikové signály" H2, čo je sémanticky nesprávne.

### Cieľová hierarchia:

```
H1: Company Name
│
├── H2: Finančné zhrnutie
├── H2: Rizikové signály a udalosti
│   └── H3: Vestník udalosti (ak existujú)
├── H2: Osoby
│   ├── H3: Štatutári
│   ├── H3: Spoločníci
│   ├── H3: Dozorná rada
│   └── H3: Konanie menom spoločnosti
├── H2: Predmet činnosti
├── H2: Súvaha
│   ├── H3: Štruktúra súvahy (chart)
│   └── H3: Súvaha v tis. € (table)
├── H2: Výkaz ziskov a strát
│   ├── H3: Tržby a zisk (chart)
│   └── H3: Detailný výkaz (table)
├── H2: Piotroski F-Score — ROK
├── H2: Cash flow (collapsible)
├── H2: Detailné finančné ukazovatele (collapsible)
│   ├── H3: Ďalšie ukazovatele
│   ├── H3: Vývoj zamestnancov
│   ├── H3: Rentabilita
│   └── H3: Finančná stabilita
├── H2: Preverte firmu NAME (CTA)
├── H2: Často hľadané informácie — NAME (FAQ)
├── H2: Zdroje údajov (collapsible)
└── H2: Súvisiace firmy
    ├── H3: Firmy v rovnakom odvetví v kraj
    ├── H3: Najväčšie firmy v rovnakom odvetví
    ├── H3: Firmy v meste
    └── H3: Spoločnosti spojené s osobami firmy
```

### Pravidlá:
- **Každá finančná sekcia (Súvaha, P&L, Piotroski, Cash Flow, Detaily) MUSÍ mať H2 nadpis.**
- **ChartCard komponent používa `<h3>` — to je OK pre podsekcie, ale nadradené H2 musí byť v `page.tsx`.**
- **"Finančné ukazovatele" H3 sa NESMIE opakovať 2x** — premenuj na "Rentabilita — ukazovatele" a "Stabilita — ukazovatele".
- **Konanie menom spoločnosti je H3 pod "Osoby", nie samostatné H2.**

---

## DESKTOP LAYOUT (≥ 1024px)

```
Max-width: 1200px, centered, px-6

┌──────────────────────────────────────────────────┐
│ STICKY HEADER (full-width, 56px)                  │
├──────────────────────────────────────────────────┤
│ Breadcrumb                                        │
├──────────────────────────────────────────────────┤
│ COMPANY HEADER (full-width)                       │
│  H1 (text-2xl font-black)                         │
│  Metadata (text-sm, flex-wrap)                    │
│  Tags (text-[10px], rounded-full)                 │
├──────────────────────────────────────────────────┤
│ KEY FACTS (full-width, text-xs, flex-wrap)        │
│  Zamestnanci · Veľkosť · Vlastníctvo · Imanie    │
│  · Aktualizované                                  │
├──────────────────────────────────────────────────┤
│ KPI CARDS (grid-cols-4, gap-3)                     │
│  ┌────┐ ┌────┐ ┌────┐ ┌────┐                      │
│  │    │ │    │ │    │ │    │  rounded-xl, p-4     │
│  └────┘ └────┘ └────┘ └────┘                      │
├──────────────────────────────────────────────────┤
│ FINANCIAL SUMMARY (full-width, p-4, rounded-lg)   │
│  H2 + 1-2 vety textu                              │
├──────────────────────────────────────────────────┤
│ RISK SIGNALS (full-width)                          │
│  H2 + farebné karty (space-y-2)                   │
│  + H3 Vestník udalosti (ak existujú)              │
├──────────────────────────────────────────────────┤
│ PEOPLE (full-width)                               │
│  H2 + H3 podsekcie (space-y-4)                    │
├──────────────────────────────────────────────────┤
│ PREDMET ČINNOSTI (full-width, rounded-lg, p-4)   │
│  H2 + text (collapsible ak > 300 znakov)         │
├──────────────────────────────────────────────────┤
│ SÚVAHA (grid-cols-2, gap-4)                       │
│  ┌──────────┐ ┌──────────┐                        │
│  │ Sankey   │ │ Tabuľka  │  ChartCard (rounded-2xl)│
│  │ chart    │ │          │                        │
│  └──────────┘ └──────────┘                        │
├──────────────────────────────────────────────────┤
│ VÝKAZ ZISKOV A STRÁT (grid-cols-2, gap-4)        │
│  ┌──────────┐ ┌──────────┐                        │
│  │ Bar chart│ │ Tabuľka  │                        │
│  └──────────┘ └──────────┘                        │
├──────────────────────────────────────────────────┤
│ PIOTROSKI (full-width, ChartCard)                 │
│  Score + 9 kritérií                               │
├──────────────────────────────────────────────────┤
│ CASH FLOW (collapsible, full-width)               │
│  <details><summary>Cash flow</summary>            │
│  Tabuľka                                          │
├──────────────────────────────────────────────────┤
│ DETAILNÉ UKAZOVATELE (collapsible, full-width)    │
│  <details><summary>Detaily</summary>             │
│  4× H3 podsekcie                                  │
├──────────────────────────────────────────────────┤
│ REPORT CTA (full-width, rounded-2xl, p-8)        │
│  Gradient background, 2-column (text + CTA)       │
├──────────────────────────────────────────────────┤
│ FAQ (full-width)                                  │
│  H2 + 6 Q&A                                       │
├──────────────────────────────────────────────────┤
│ ZDROJE ÚDAJOV (collapsible, full-width)           │
│  <details><summary>Zdroje</summary>              │
│  3× source cards (grid-cols-3)                    │
├──────────────────────────────────────────────────┤
│ SÚVISIACE FIRMY (full-width)                      │
│  H2 + hub links + 4× H3 podsekcie                 │
│  Grid grid-cols-3 pre firm cards                  │
└──────────────────────────────────────────────────┘
```

---

## MOBILE LAYOUT (< 768px)

**Mobile-first pravidlo: ŽIADNY nútený horizontálny scroll pri bežnom použití.**

```
Max-width: 100%, px-4

┌──────────────────────────────┐
│ STICKY HEADER (56px)         │
│  Logo | [🌙] [Prihlásiť]    │
│  (CTA skryté na mobile ale   │
│   zmenené na text link)      │
├──────────────────────────────┤
│ Breadcrumb (text-xs, wrap)   │
├──────────────────────────────┤
│ COMPANY HEADER               │
│  H1 (text-xl font-black)     │
│  Metadata (text-xs, stack)   │
│  Tags (flex-wrap)            │
├──────────────────────────────┤
│ KEY FACTS (text-[11px])      │
│  Stack vertikálne alebo      │
│  flex-wrap (2 per riadok)    │
├──────────────────────────────┤
│ KPI CARDS (grid-cols-2)       │
│  ┌────┐ ┌────┐               │
│  │    │ │    │  rounded-xl   │
│  └────┘ └────┘               │
│  ┌────┐ ┌────┐               │
│  │    │ │    │               │
│  └────┘ └────┘               │
├──────────────────────────────┤
│ FINANCIAL SUMMARY            │
│  H2 (text-base) + text       │
├──────────────────────────────┤
│ RISK SIGNALS                 │
│  H2 + karty (full-width)     │
├──────────────────────────────┤
│ PEOPLE                       │
│  H2 + H3 podsekcie (stack)   │
├──────────────────────────────┤
│ PREDMET ČINNOSTI             │
│  H2 + text (collapsible)     │
├──────────────────────────────┤
│ SÚVAHA (stack 1×1)           │
│  Sankey chart (full-width)   │
│  ↓                            │
│  Tabuľka (overflow-x-auto)   │
│  ALE: pridaj min-w-[280px]   │
│  aby sa tabuľka nerozsypala  │
├──────────────────────────────┤
│ VÝKAZ ZISKOV A STRÁT (stack)│
│  Chart (full-width)          │
│  ↓                            │
│  Tabuľka (overflow-x-auto)   │
├──────────────────────────────┤
│ PIOTROSKI (full-width)       │
│  Score veľké, kritériá stack │
├──────────────────────────────┤
│ CASH FLOW (collapsed)        │
│  <details> — defaultne zatv. │
├──────────────────────────────┤
│ DETAILNÉ UKAZOVATELE (col.)  │
│  <details> — defaultne zatv. │
├──────────────────────────────┤
│ REPORT CTA (full-width)      │
│  Stack (text + CTA button)   │
├──────────────────────────────┤
│ FAQ (full-width)             │
├──────────────────────────────┤
│ ZDROJE (collapsed)           │
├──────────────────────────────┤
│ SÚVISIACE FIRMY               │
│  Grid grid-cols-1 (stack)    │
└──────────────────────────────┘
```

### Mobile tabuľky — Kritické pravidlo:

Finančné tabuľky (BalanceSheetTable, ProfitLossTable, CashFlowTable, ExtendedRatios, RentabilityRatios, StabilityRatios) majú 5+ stĺpcov (roky 2020–2024). Na 375px obrazovke sa nezmestia.

**Riešenie (zvol jedno):**

**A. `overflow-x-auto` s indikátorom** (najjednoduchšie):
```tsx
<div className="overflow-x-auto -mx-2 px-2">
  <table style={{ minWidth: 400 }}>
    ...
  </table>
</div>
```
Pridaj `min-width` aby tabuľka mala zmysluplnú šírku a `overflow-x-auto` umožnil horizontálny scroll. Pridaj malý vizuálny indikátor (šípka alebo text "← scroll →") pod tabuľkou na mobile.

**B. Transformácia na karty na mobile** (lepšie UX, viac práce):
```tsx
{/* Desktop: table */}
<div className="hidden md:block">
  <table>...</table>
</div>
{/* Mobile: cards */}
<div className="md:hidden space-y-3">
  {sorted.map(s => (
    <div className="rounded-lg p-3" style={...}>
      <div className="font-bold">{s.year}</div>
      {rows.map(r => (
        <div className="flex justify-between">
          <span>{r.label}</span>
          <span>{r.renderValue(s)}</span>
        </div>
      ))}
    </div>
  ))}
</div>
```

**Odporúčam možnosť A** pre všetky tabuľky okrem BalanceSheetTable a ProfitLossTable — tam použi **B** (karty na mobile), pretože sú to hlavné finančné výkazy.

---

## COLLAPSIBLE SEKCIE — Implementácia

Pre collapsible sekcie použi `<details>`/`<summary>` HTML elementy (natívne, bez JS) alebo `useState` toggle (ak potrebuješ custom styling).

### UX pravidlo: Summary musí naznačiť obsah

Collapsed sekcia nesmie byť len holý nadpis. Používateľ musí vedieť, **čo sa skrýva vo vnútri**, bez toho aby musel kliknúť. Pridaj do `<summary>` krátky popis obsahu.

```tsx
<details className="mb-6 sm:mb-8">
  <summary className="text-base font-bold cursor-pointer mb-3" style={{ color: "var(--text)" }}>
    {t("firma.cashFlow")} <span className="text-xs font-normal" style={{ color: "var(--text-muted)" }}>· Prevádzková / Investičná / Finančná činnosť</span>
  </summary>
  <div className="mt-3">
    <CashFlowTable stmts={stmts} />
  </div>
</details>
```

Príklady:
- **Cash flow** → `Cash flow · Prevádzková / Investičná / Finančná činnosť ▶`
- **Detailné ukazovatele** → `Detailné ukazovatele · Quick ratio, D/E, Rentabilita, Stabilita ▶`
- **Zdroje údajov** → `Zdroje údajov · ORSR, RÚZ, Vestník ▶`

### Option 1: Natívne `<details>` (odporúčané pre Cash Flow, Zdroje)

```tsx
<details className="mb-6 sm:mb-8">
  <summary className="text-base font-bold cursor-pointer mb-3" style={{ color: "var(--text)" }}>
    {t("firma.cashFlow")}
  </summary>
  <div className="mt-3">
    <CashFlowTable stmts={stmts} />
  </div>
</details>
```

### Option 2: useState toggle (odporúčané pre Detailné ukazovatele)

```tsx
"use client";
import { useState } from "react";

export function DetailedRatios({ stmts, indicators }: Props) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mb-6 sm:mb-8">
      <button
        onClick={() => setOpen(v => !v)}
        className="flex items-center gap-2 text-base font-bold w-full text-left mb-3"
        style={{ color: "var(--text)" }}
      >
        <span>{open ? "▼" : "▶"}</span>
        {t("firma.detailneUkazovatele")}
      </button>
      {open && (
        <div className="space-y-6">
          <ExtendedRatios stmts={stmts} />
          <EmployeeTrend stmts={stmts} />
          {/* Rentabilita + Stability grid */}
        </div>
      )}
    </div>
  );
}
```

---

## FINANCIAL SUMMARY — Generovanie textu

Nahradiť `CompanyInsights` komponent 1-2 vetovým narativom. Použi rovnaké dáta (trends, margins), ale komprimuj.

```tsx
// V page.tsx — nahradiť CompanyInsights
{stmts.length > 0 && latest && prev && (
  <div className="mb-6 sm:mb-8">
    <h2 className="text-base font-bold mb-2" style={{ color: "var(--text)" }}>
      {t("firma.financneZhrnutie")}
    </h2>
    <p className="text-sm leading-relaxed" style={{ color: "var(--text-secondary)" }}>
      {generateFinancialSummary(name, stmts, trends)}
    </p>
  </div>
)}
```

```tsx
// Helper funkcia (môže byť v page.tsx alebo lib/)
function generateFinancialSummary(name: string, stmts: any[], trends: any): string {
  const latest = stmts[0];
  const revenueTrend = trends.revenue;
  const profitTrend = trends.profit;
  const margin = latest.mainActivityRevenue && latest.netProfitLoss
    ? (Number(latest.netProfitLoss) / Number(latest.mainActivityRevenue) * 100).toFixed(1)
    : null;

  const parts: string[] = [];
  parts.push(name);

  // Revenue trend
  if (revenueTrend?.direction === "up") {
    parts.push(`dosiahla rast tržieb o ${revenueTrend.pct.toFixed(0)}%`);
  } else if (revenueTrend?.direction === "down") {
    parts.push(` zaznamenala pokles tržieb o ${Math.abs(revenueTrend.pct).toFixed(0)}%`);
  } else {
    parts.push("udržala stabilné tržby");
  }

  // Profit trend
  if (profitTrend?.direction === "up") {
    parts.push(`zisk vzrástol o ${profitTrend.pct.toFixed(0)}%`);
  } else if (profitTrend?.direction === "down") {
    parts.push(`zisk klesol o ${Math.abs(profitTrend.pct).toFixed(0)}%`);
  }

  // Margin
  if (margin) {
    parts.push(`Zisková marža dosiahla ${margin}%`);
  }

  return parts.join(", ") + ".";
}
```

**Dôležité:** Tento text je **doplňujúci narativ**, nie duplikát KPI. KPI cards ukazujú čísla, Summary ukazuje interpretáciu. Funkcia musí bezpečne handlovať null/undefined/0 hodnoty — ak chýbajú dáta, vygeneruje kratší text alebo sa nezobrazí.

---

## RISK BADGE v HEADERI

Pridať do CompanyHeader komponentu risk badge, ak firma má risk signály:

```tsx
// V page.tsx — počítaj signály rovnako ako teraz
const riskCount = signals.length; // z existujúceho signals array

// V CompanyHeader props pridaj:
<CompanyHeader
  company={...}
  latestYear={latest?.year}
  riskCount={riskCount}  // NOVÉ
/>

// V company-header.tsx:
{riskCount != null && riskCount > 0 && (
  <span
    className="text-[10px] font-bold px-2 py-0.5 rounded-full"
    style={{
      background: "var(--danger-bg, #fef2f2)",
      border: "1px solid var(--danger-border, #fecaca)",
      color: "var(--danger, #dc2626)",
    }}
  >
    ⚠ {riskCount} {riskCount === 1 ? "rizikový signál" : "rizikové signály"}
  </span>
)}
```

---

## KEY FACTS — Zlúčenie duplicitných blokov

**Aktuálne 3 bloky:**
1. Source attribution tags (#4): ORSR, RÚZ, Vestník, Veľkosť, Zamestnanci, Druh vlastníctva
2. Provenance (#5): Zdroj, Obdobie, Aktualizované
3. DataSources (#23): ORSR, RÚZ, Vestník s syncedAt

**Cieľ: 1 riadok + 1 collapsed sekcia na konci**

```tsx
{/* KEY FACTS — jeden riadok pod headerom */}
<div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] sm:text-xs mb-4 no-print"
     style={{ color: "var(--text-muted)" }}>
  {company.employeeCount != null && (
    <span>{t("firma.zamestnanci", { value: company.employeeCount })}</span>
  )}
  {company.sizeCategory && (
    <><span>·</span><span>{t("firma.velkostFirmy", { value: company.sizeCategory })}</span></>
  )}
  {company.ownershipType && (
    <><span>·</span><span>{t("firma.druhVlastnictva", { value: company.ownershipType })}</span></>
  )}
  {company.shareCapital != null && Number(company.shareCapital) > 0 && (
    <><span>·</span><span>{t("firma.zakladneImanie")}: {fmtEUR(Number(company.shareCapital))}</span></>
  )}
  {company.ruzSyncedAt && (
    <><span>·</span><span>{t("firma.aktualizovane")}: {new Date(company.ruzSyncedAt).toLocaleDateString("sk-SK")}</span></>
  )}
</div>
```

**DataSources sekcia na konci zostáva, ale COLLAPSED** — detailné info o zdrojoch pre power users.

---

## STICKY HEADER CTA — Zmena

**Aktuálne:** "Objednať report" primary button v sticky headeri (vždy viditeľné).

**Cieľ:** "Prihlásiť sa" secondary button v sticky headeri. Primary CTA zostáva len ReportCTA sekcia.

```tsx
{/* V sticky header — zmeň */}
<Link href="/login" className="text-xs font-medium px-3 py-2 rounded-lg"
      style={{ border: "1px solid var(--border)", color: "var(--text-muted)" }}>
  {t("firma.prihlasitSa")}
</Link>
{/* ODSTRÁNIŤ "Objednať report" button zo sticky headera */}
```

---

## VESTNIK EVENTS + COMPANY EVENTS

Aktuálne sú samostatné H2 sekcie (#12, #13). Pre Protherm sú prázdne (0 events).

**Pravidlo:**
- Ak `company.vestnikEvents.length === 0`, nezobrazuj nič.
- Ak `company.companyEvents.length === 0`, nezobrazuj nič.
- Ak existujú, zobraz ich ako **H3 pod Risk Signals** (nie samostatné H2).

```tsx
{/* Po Risk Signals */}
{company.vestnikEvents && company.vestnikEvents.length > 0 && (
  <div className="mt-3 no-print">
    <h3 className="text-sm font-semibold mb-2" style={{ color: "var(--text-secondary)" }}>
      {t("firma.vestnikUdalosti")}
    </h3>
    <VestnikEvents events={company.vestnikEvents} />
  </div>
)}
```

---

## DEDUPLIKÁCIA RELATED FIRMS

Ak sa rovnaká firma (rovnaké IČO) objaví v 2+ zoznamoch, zobraz ju len v **jednom** — v poradí priority:

1. **Cross-firm persons** (najrelevantnejšie — spojenie cez osobu)
2. **Firmy v meste** (geografická blízkosť)
3. **Firmy v rovnakom odvetví v kraj** (odvetvová + regionálna blízkosť)
4. **Najväčšie firmy v rovnakom odvetví** (najmenej relevantné — len veľkosť)

**Implementácia — správna priorita:**

CrossFirmPersons je samostatný komponent (renderuje sa pred RelatedFirms). Pre deduplikáciu musí RelatedFirms dostať zoznam IČO, ktoré už boli zobrazené v CrossFirmPersons, a vynechať ich.

```tsx
// V page.tsx — poslať crossFirmIcos do RelatedFirms
const crossFirmIcos = crossFirmLinks.map(f => f.ico); // z CrossFirmPersons

<RelatedFirms
  ico={company.ico}
  city={company.city}
  naceCode={company.naceCode}
  kraj={company.kraj}
  excludeIcos={crossFirmIcos}  // NOVÉ — IČO už zobrazené v CrossFirmPersons
/>
```

```tsx
// V related-firms.tsx — deduplikácia s prioritou
export async function RelatedFirms({
  ico, city, naceCode, kraj, excludeIcos = []
}: Props) {
  const [byNaceInKraj, largestByNace, firmsInCity] = await Promise.all([
    getRelatedByNaceInKraj(ico, naceCode, kraj),
    getLargestByNace(ico, naceCode),
    getFirmsInCity(ico, city),
  ]);

  // Priorita: mesto → odvetvie/kraj → najväčšie v odvetví
  // (cross-firm už bol vynechaný v excludeIcos)
  const seenIcos = new Set<string>([ico, ...excludeIcos]);

  const dedupFirmsInCity = firmsInCity.filter(f => {
    if (seenIcos.has(f.ico)) return false;
    seenIcos.add(f.ico);
    return true;
  });

  const dedupByNaceInKraj = byNaceInKraj.filter(f => {
    if (seenIcos.has(f.ico)) return false;
    seenIcos.add(f.ico);
    return true;
  });

  const dedupLargestByNace = largestByNace.filter(f => {
    if (seenIcos.has(f.ico)) return false;
    seenIcos.add(f.ico);
    return true;
  });

  // Render: mesto first, then odvetvie/kraj, then najväčšie
  // (zmenené poradie oproti súčasnému — mesto je relevantnejšie)
  ...
}
```

**Dôležé:** `excludeIcos` parameter je nový prop pre RelatedFirms. Pridaj ho do Props typu. Ak CrossFirmPersons vráti prázdny zoznam, `excludeIcos` bude prázdne pole a deduplikácia medzi RelatedFirms podsekciami stále funguje.

---

## TYPOGRAPHY & SPACING

| Element | Desktop | Mobile |
|---------|---------|--------|
| H1 (Company Name) | `text-2xl font-black` | `text-xl font-black` |
| H2 (Major sections) | `text-lg font-bold` | `text-base font-bold` |
| H3 (Subsections) | `text-sm font-bold` | `text-sm font-bold` |
| Body text | `text-sm` | `text-sm` |
| Metadata/labels | `text-xs` | `text-[11px]` |
| Tags/badges | `text-[10px]` | `text-[10px]` |
| KPI value | `text-xl font-black` | `text-lg font-black` |
| Piotroski score | `text-3xl font-black` | `text-2xl font-black` |

| Spacing | Value |
|---------|-------|
| Section margin bottom | `mb-6 sm:mb-8` |
| Card padding | `p-4 sm:p-5` |
| KPI card padding | `p-3 sm:p-4` |
| Grid gap | `gap-3 sm:gap-4` |
| Inner element gap | `gap-2` |

---

## FARBY (z CSS variables — nemeniť)

| Sémantika | CSS Variable |
|-----------|-------------|
| Primary text | `var(--text)` |
| Secondary text | `var(--text-secondary)` |
| Muted text | `var(--text-muted)` |
| Background | `var(--bg)` |
| Surface (cards) | `var(--surface)` |
| Border | `var(--border)` |
| Accent (links, CTA) | `var(--accent)` |
| Danger (risk) | `var(--danger, #dc2626)` |
| Danger bg | `var(--danger-bg, #fef2f2)` |
| Warning | `var(--warning, #d97706)` |
| Warning bg | `var(--warning-bg, #fffbeb)` |
| Success | `#10b981` |
| Info | `#3b82f6` |

---

## ZOZNAM SUBOROV NA ÚPRAVU

| Súbor | Čo meníš |
|-------|----------|
| `src/app/firma/[ico-slug]/page.tsx` | Hlavné poradie sekcií, pridanie H2 nadpisov, zlúčenie source+provenance, presun SigningAuthority do Persons, pridanie Financial Summary |
| `src/components/company-header.tsx` | Pridanie risk badge prop, zmena metadata riadku |
| `src/components/company-persons.tsx` | Pridanie H3 "Konanie menom" podsekcie (alebo z page.tsx) |
| `src/components/firma-ui.tsx` | ChartCard — ponechať H3, ale pridať option pre H2 |
| `src/components/report-cta.tsx` | Bez zmeny (CTA zostáva) |
| `src/components/data-sources.tsx` | Pridať collapsible wrapper |
| `src/components/extended-ratios.tsx` | Bez zmeny (zostáva v collapsed sekcii) |
| `src/components/piotroski-card.tsx` | Bez zmeny |
| `src/components/risk-signals.tsx` | Bez zmeny |
| `src/components/related-firms.tsx` | Pridať deduplikáciu s `excludeIcos` prop |
| `src/components/cross-firm-persons.tsx` | Vrátiť IČO zoznam pre deduplikáciu (ak je to potrebné) |
| `src/lib/i18n/sk.ts` | Pridať nové kľúče: `firma.financneZhrnutie`, `firma.detailneUkazovatele`, `firma.cashFlow` (ak chýba), `firma.vestnikUdalosti` |
| `src/lib/i18n/en.ts` | Pridať rovnaké kľúče v EN |
| `src/lib/i18n/cz.ts` | Pridať rovnaké kľúče v CZ |
| `src/lib/i18n/de.ts` | Pridať rovnaké kľúče v DE |
| `src/lib/i18n/hu.ts` | Pridať rovnaké kľúče v HU |
| `src/lib/i18n/pl.ts` | Pridať rovnaké kľúče v PL |

**Nemeníš:**
- `src/lib/ruz.ts`
- `src/lib/financial-indicators.ts`
- `src/lib/piotroski.ts`
- `src/lib/slug.ts`
- `src/lib/seo.ts`
- `src/lib/auth.ts`
- `src/lib/trend.ts`
- `src/lib/format.ts`
- `src/lib/company-insights.ts` (môžeš prestať používať, ale nemaž)
- `src/components/company-charts.tsx`
- `src/components/financial-indicators-charts.tsx`
- `src/components/vestnik-events.tsx`
- `src/components/company-events.tsx`
- `src/components/Logo.tsx`
- `src/components/ThemeToggle.tsx`
- `src/components/PrintButton.tsx`
- `src/components/LanguageProvider.tsx`
- `prisma/schema.prisma`
- `middleware.ts`

---

## VERIFIKÁCIA — Čo musí platiť po zmene

1. **`npx tsc --noEmit` prejde bez chyby**
2. **`npm run build` prejde bez chyby**
3. **`npm run test:unit` prejde** — i18n key parity test (všetkých 6 jazykov musí mať rovnaké kľúče)
4. **Heading hierarchia:** H1 → H2 → H3, žiadne H3 bez H2 nadradeného
5. **Žiadny horizontálny scroll na mobile** (375px) okrem finančných tabuliek s `overflow-x-auto`
6. **Risk Signals sa zobrazujú pred finančnými tabuľkami**
7. **Piotroski sa zobrazuje pred Cash Flow a Detaily**
8. **Cash Flow a Detailné ukazovatele sú defaultne collapsed**
9. **Zdroje údajov sú defaultne collapsed**
10. **Sticky header obsahuje "Prihlásiť sa", nie "Objednať report"**
11. **Risk badge v headeri ak firma má riziká**
12. **Key Facts je jeden riadok, nie tri bloky**
13. **Signing Authority je H3 pod Osoby, nie samostatné H2**
14. **VestnikEvents a CompanyEvents sú H3 pod Risk Signals (ak existujú)**
15. **Related Firms nemajú duplicitné firmy v 2+ zoznamoch**
16. **`generateFinancialSummary()` bezpečne handluje null/undefined/0 — nezobrazí nezmyselný text**
17. **JSON-LD output je nezmenený**
18. **`generateMetadata()` je nezmenená**
19. **`revalidate = 86400` a `dynamicParams = true` sú nezmenené**
20. **`document.documentElement.scrollWidth === document.documentElement.clientWidth` na 375px viewport (žiadny page-level horizontal overflow); horizontálny scroll je povolený iba lokálne vo finančných tabuľkách s `overflow-x-auto`**
21. **Collapsed sekcie (Cash Flow, Detailné ukazovatele, Zdroje) majú v `<summary>` krátky popis obsahu, nielen nadpis**

---

## KONTROLNÉ OTÁZKY PRE KIMI PRED ZAČATKOM

Predtým ako začneš implementovať, odpovedz:

1. **Rozumieš, že nesmieš meniť business logic ani dáta?** Áno/Nie
2. **Rozumieš, že finančné ratios ZOSTÁVAJÚ na stránke, iba collapsed?** Áno/Nie
3. **Rozumieš, že každá finančná sekcia musí mať H2 nadpis?** Áno/Nie
4. **Rozumieš, že Risk Signals idú tesne za KPI, nie na koniec?** Áno/Nie
5. **Rozumieš, že sticky header CTA sa mení na "Prihlásiť sa"?** Áno/Nie
6. **Máš otázky k niečomu, čo nie je jasné?**

---

**Koniec zadania.**
