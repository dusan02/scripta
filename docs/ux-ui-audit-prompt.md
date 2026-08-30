# Prompt: Komplexný UX/UI/SEO/GEO audit firemných stránok Verifa.sk

> **Použitie:** Skopíruj celý text nižšie (od `--- PROMPT ---`) a vlož ho do ľubovoľného LLM (KIMI 3, Claude, GPT, Gemini). Nahraď `{{URL}}` konkrétnou URL firmou, ktorú chceš auditovať.

---

## PROMPT

Si senior UX/UI designer, SEO/GEO špecialista a frontend performance engineer v jednej osobe. Tvojou úlohou je vykonať **komplexný audit** firemnej stránky na slovenskom B2B SaaS produkte **Verifa.sk** — platforme pre automatizované due diligence reporty slovenských firiem z 26+ verejných registrov (ORSR, RÚZ, insolvenčný register, register exekúcií, RPVS, atď.).

### Stránka na audit

**URL:** {{URL}}

Príklady ďalších stránok rovnakého typu (rovnaká šablóna, rôzne dáta):
- https://verifa.sk/firma/36211541-mh-teplarensky-holding-a-s
- https://verifa.sk/firma/51286378-magna-pt-s-r-o

### Kontext o produkte

- **Verifa.sk** je slovenský B2B produkt: zadarmo ukáže verejné finančné dáta firiem, platený report (~€5) pridáva risk signály, insolvenčné/exekučné dáta, politické väzby, súvisiace firmy.
- Firemná stránka (`/firma/{ico}-{slug}`) je **hlavná landing page** — cieľom je konverzia na platený report.
- Podporované jazyky: SK (default), EN, DE, CS, HU, PL — jazyk sa deteguje z `Accept-Language` headeru, URL prefix (`/en/`, `/de/`...) je pre non-SK.
- Stránka je server-renderovaná (Next.js App Router, `revalidate = 86400`), staticky generovaná pre firmy s ≥2 finančnými výkazmi.
- Cieľová skupina: **účtovníci, finanční riaditelia, compliance officery, bankári, dodávatelia** — ľudia, ktorí potrebujú rýchlo zhodnotiť riziko obchodného partnera.

### Štruktúra stránky (zhora nadol)

1. **Sticky header** — logo, tlačidlo tlače, theme toggle, "Prihlásiť sa" (len pre neprihlásených)
2. **Breadcrumb** — Verifa.sk / Firmy / {názov firmy}
3. **CompanyHeader** — H1 (názov firmy), IČO, právna forma, mesto, založené, hlavná činnosť, SEO meta popis
4. **Key Facts** — zamestnanci, veľkosť firmy, druh vlastníctva, základné imanie, rok závierky, provenance, aktualizované
5. **KPI Cards** (4×) — Tržby, Zisk/Strata, Vlastné imanie, Celkové aktíva (s trend šípkami)
6. **Finančné zhrnutie** (H2) — 1-2 veta naratív
7. **Risk Signals** (H2) — zoznam rizikových signálov
8. **Vestník/ORSR udalosti** (H3) — konkurz, likvidácia, zmeny v registri
9. **Osoby** (H2) — Štatutári, Spoločníci, Dozorná rada (grid 1-3 stĺpce, collapse >6 osôb), Konanie v mene
10. **Business Activity** (H2) — predmet činnosti
11. **Súvaha** (H2) — Sankey chart + tabuľka
12. **Výkaz ziskov a strát** (H2) — Revenue/Profit chart + tabuľka
13. **Piotroski F-Score** (H2) — samostatná karta
14. **Cash Flow** (H2, collapsible `<details>`)
15. **Detailné finančné ukazovatele** (H2, collapsible) — Rentabilita, Stabilita, Extended Ratios, Employee Trend
16. **Report CTA** (H2) — primárny CTA "Objednať report"
17. **FAQ** (H2) — SEO long-tail otázky
18. **Zdroje údajov** (H2, collapsible)
19. **Súvisiace firmy** (H2) — cross-firm persons + related firms by industry/region

### Čo máš skontrolovať

#### 1. UX / UI — vizuálna hierarchia a orientácia
- **Hierarchia nadpisov:** Je H1 → H2 → H3 konzistentná? Chýba nejaký nadpis? Je niektorý nadpis prázdny alebo nezobrazuje sa správny text?
- **Vizuálna váha:** Sú najdôležitejšie prvky (KPI, risk signály, CTA) vizuálne dominantné? Alebo sa strácajú medzi menej dôležitými sekciami?
- **Veľkosť objektov:** Sú KPI karty, tabuľky, charty primerane veľké na desktop aj mobile? Nie sú príliš malé / príliš veľké?
- **Whitespace a padding:** Je dostatočný priestor medzi sekciami? Nie je stránka príliš "natlačená"?
- **Grid layout:** Je 2-stĺpcový grid (chart + tabuľka) čitateľný? Funguje na mobile (1 stĺpec)?
- **Farby a kontrast:** Majú karty, badge-e, risk signály dostatočný kontrast? Je dark mode konzistentný?
- **Sticky header:** Nezakrýva dôležitý obsah pri scrollovani? Je dostatočne kompaktný?
- **Collapsible sekcie:** Sú `<details>` vizuálne odlíšené od normálnych H2? Je zrejmé, že sa dajú rozbaliť?
- **CTA umiestnenie:** Je primárny CTA ("Objednať report") na správnom mieste? Nie je príliš nízko? Mal by byť aj vyššie (napr. po KPI)?
- **Print layout:** Funguje tlač správne? Nevytlačia sa zbytočné interaktívne prvky?

#### 2. SEO — vyhľadávače
- **Title tag:** Je optimálny (≤60 znakov)? Obsahuje názov firmy + IČO + keyword?
- **Meta description:** Je ≤160 znakov? Obsahuje hodnotu pre používateľa?
- **H1:** Obsahuje názov firmy? Nie je fallback "IČO {ico}"?
- **H2/H3 hierarchia:** Je sémanticky správna? Preskakuje sa niektorá úroveň?
- **Canonical URL:** Je správny? Neukazuje na homepage pre neexistujúce firmy?
- **Robots/noindex:** Je quality gate (<2 finančné výkazy → noindex) správna? Neindexujú sa prázdne stránky?
- **JSON-LD structured data:** Je `Organization` schema správna? Chýba `FinancialProduct`, `BreadcrumbList`, `FAQPage`?
- **Internal linking:** Sú "Súvisiace firmy" relevantné? Pomáhajú crawlingu?
- **URL štruktúra:** Je `/firma/{ico}-{slug}` SEO-friendly? Slug obsahuje názov firmy?
- **Sitemap:** Sú všetky indexovateľné firme v sitemape?
- **Hreflang:** Sú správne pre 6 jazykov?
- **Core Web Vitals:** LCP, CLS, INP — čo by mohlo byť problémom?

#### 3. GEO — geografická optimalizácia
- **Lokálny kontext:** Obsahuje stránka mesto, kraj, región firmy? Je to viditeľné v H1/meta/JSON-LD?
- **Lokálne entity:** Sú "Súvisiace firmy" geograficky relevantné (rovnaký kraj/mesto)?
- **Google Business Profile:** Má Verifa.sk verified GBP? (mimo rozsah stránky, ale dôležité)
- **Lokálne keywords:** Obsahuje meta/FAQ lokálne termíny ("firma v Košiciach", "slovenská spoločnosť", atď.)?
- **Geo structured data:** Obsahuje JSON-LD `address.addressLocality`, `address.addressRegion`?

#### 4. Performance — načítavanie stránky
- **Server response time:** Je TTFB < 600ms? (aktuálne ~791ms priemer)
- **Bundle size:** Sú chart knižnice (Recharts) lazy-loaded? Nie sú v initial bundle?
- **Image optimization:** Je `logo-verifa.png` optimalizovaný? Používa next/image?
- **Font loading:** Sú fonty preloaded? Nie je FOIT/FOUT?
- **CSS:** Sú štýly inline (CSS variables) alebo external? Je critical CSS prioritizované?
- **JavaScript:** Koľko JS sa hydratuje na client-side? Je zbytočné (charty by mohli byť SSR)?
- **Caching:** Je `revalidate = 86400` optimálne? Nie je príliš dlhé pre rizikové dáta?
- **Third-party:** Sentry, analytics — blokujú rendering?

#### 5. i18n — internacionalizácia
- **Chýbajúce preklady:** Skontroluj, či sa niekde nezobrazuje surový kľúč (napr. `company.dozornaRada` namiesto "Dozorná rada"). Pozri známe chyby nižšie.
- **Jazyk detekcia:** Funguje `Accept-Language` detekcia správne?
- **Formátovanie:** Sú dátumy, čísla, meny lokalizované pre každý jazyk?
- **Dĺžka textov:** Nie sú nemecké/poľské preklady príliš dlhé a rozbíjajú layout?
- **RTL:** (N/A — žiadny RTL jazyk, ale over)

#### 6. Prístupnosť (a11y)
- **ARIA:** Majú collapsible sekcie (`<details>`) správne ARIA?
- **Keyboard navigation:** Dá sa stránka ovládať klávesnicou? Focus visible?
- **Screen reader:** Je H1 jednoznačné? Sú charty prístupné (alt text, data table fallback)?
- **Color contrast:** WCAG AA (4.5:1 pre text, 3:1 pre veľký text)?
- **Touch targets:** Sú tlačidlá ≥44×44px na mobile?

### Známe chyby (over, či sa nevyskytujú)

1. **`company.dozornaRada`** — prekladový kľúč chýbal vo všetkých 6 jazykoch, nadpis sa renderoval ako doslovný text kľúča. **(Už opravené — over na živej stránke.)**
2. **`H1_NO_COMPANY_NAME`** — H1 používa fallback "IČO {ico}" keď je `company.name` null.
3. **`META_DESC_TOO_LONG`** — niektoré meta descriptions > 160 znakov.
4. **`TITLE_TOO_LONG`** — niektoré title tagy > 60 znakov.
5. **Name mismatch** — 5.2% firiem má DB názov odlišný od zobrazeného (sitemap vs. page).

### Očakávaný output

Štruktúru odpovede urob v tomto formáte:

```
## 1. Executive Summary
- Celkový dojem zo stránky (2-3 vety)
- Top 3 kritické problémy
- Top 3 quick wins

## 2. UX/UI nálezy
| # | Sekcia | Problém | Priorita (P0-P3) | Návrh riešenia |
|---|--------|---------|-------------------|-----------------|
| 1 | ...    | ...     | P1                | ...             |

## 3. SEO nálezy
(rovnaká tabuľka)

## 4. GEO nálezy
(rovnaká tabuľka)

## 5. Performance nálezy
(rovnaká tabuľka)

## 6. i18n nálezy
(rovnaká tabuľka)

## 7. Prístupnosť nálezy
(rovnaká tabuľka)

## 8. Prioritný zoznam akcií
P0 (kritické, blokuje konverziu/indexáciu):
1. ...
P1 (vysoká priorita, týždeň):
1. ...
P2 (stredná, mesiac):
1. ...
P3 (nice-to-have):
1. ...

## 9. Celkové hodnotenie
- UX/UI: X/10
- SEO: X/10
- GEO: X/10
- Performance: X/10
- i18n: X/10
- a11y: X/10
- Celkový: X/10
```

### Pravidlá
- Buď **konkrétny** — nevracaj všeobecné rady typu "zlepšiť whitespace". Uveď presne ktorý element, ktorá sekcia, aký je problém a ako ho opraviť.
- **Prioritizuj** — nie každý nález je rovnako dôležitý. P0 = blokuje konverziu alebo indexáciu. P3 = kozmetika.
- **Over na živej stránke** — ak môžeš otvoriť URL, urob to. Nepredpokladaj, over.
- **Uvažuj o B2B kontexte** — cieľový používateľ je profesionál, ktorý hodnotí riziko. Stránka musí vyžarovať dôveryhodnosť, presnosť a rýchlosť.
- Ak nájdeš problém, ktorý sa týka **všetkých** firemných stránok (nie len tejto jednej), označ ho ako **[SYSTEMIC]**.
