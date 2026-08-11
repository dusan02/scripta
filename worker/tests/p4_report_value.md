# P4.2 — Report Value Analysis

**Otázka:** Čo presne musí obsahovať platený PDF report, aby zaň používateľ rád zaplatil €7–15?

---

## Čo dnes PDF obsahuje

### Part A — Analýza (cover page + ~7 strán)

| Sekcia | Obsah | Zdroj |
|--------|-------|-------|
| **Cover page** | Logo, firma, IČO, NACE, Verifa Score (farebná pečiatka), semafory, dátum generovania | `_cover.html` |
| **Executive Summary** | AI Chief Auditor zhrnutie, confidence score %, reliability factors | `_summary.html` |
| **Fraud Heatmap** | Vizuálna matica rizikových kategórií (critical/high/medium/low) | `_summary.html` |
| **Evidence Table** | Tvrdenie → Dôkaz → Zdroj (každé tvrdenie podložené zdrojom) | `_summary.html` |
| **Strengths & Weaknesses** | 2-stĺpcové porovnanie silných/slabých stránok s relevance tagmi | `_summary.html` |
| **5-Pilierový Scorecard** | Tabuľka: P1 Platobná schopnosť, P2 Ziskovosť, P3 Stabilita, P4 Kvalita dát, P5 Právne riziky — body, flags, fulfillment % | `_financials.html` |
| **Finančné výkazy** | 5-ročná tabuľka: súvaha, výkaz ziskov a strát, cash flow | `_financials.html` |
| **Finančné pomery** | ROA, ROE, EBITDA, current ratio, quick ratio, cash ratio, D/E, DSO, DPO | `_financials.html` |
| **Altman Z''** | 5-ročný trend bankrotového modelu | `_financials.html` |
| **Piotroski F** | F-score trend | `_financials.html` |
| **Beneish M** | Manipulation score | `_financials.html` |
| **Trend grafy** | Revenue, profit, equity (SVG charts) | `_financials.html` |
| **Going Concern** | Assessment + audit opinion check | `_financials.html` |
| **Právne riziká** | Vestník events: risk matrix, timeline, detail cards | `_legal.html` |
| **Registry prehľad** | Grid všetkých zdrojov s status dots + findings + page refs | `_table_of_contents.html` |
| **Glossary + Methodology** | Vysvetlenie pojmov + Verifa Score model | `report_template.html` |

### Part B — Evidence Binder (variable pages)

Zdrojové PDF z každého registra, kde sa našiel záznam. Zoradené podľa kategórií. S nadpisom zdroja a číslom strany.

---

## Hodnotenie: Je to €7-15 produkt?

### ✅ Čo funguje a je hodnotné

1. **Evidence table** — každé tvrdenie má dôkaz a zdroj. To je presne to, čo advokát potrebuje.
2. **5-pillar scorecard** — transparentný, deterministický, reprodukovateľný.
3. **Evidence binder** — originálne PDF z registrov ako prílohy. To ušetrí hodiny manuálneho sťahovania.
4. **Fraud heatmap** — vizuálne rýchle hodnotenie rizikových oblastí.
5. **Vestník timeline** — chronológia právnych udalostí s severity.
6. **Confidence score** — indikuje spoľahlivosť analýzy (ak LLM fail → fallback warning).

### 🔴 Čo chýba a je kritické pre hodnotu

| # | Gap | Prečo to chýba | Dopad |
|---|-----|---------------|-------|
| **1** | **Dátum kontroly každého zdroja** | Cover page má `generated_at` ale nie per-source timestamp | Používateľ nevie, kedy bol konkrétny register kontrolovaný. Pre due-diligence je to kritické. |
| **2** | **"Čo Verifa nekontrolovala"** | Zdroje bez scraperu (CRE, CRRS, OCHRANNE_ZNAMKY) chýbajú úplne | Používateľ si myslí, že boli skontrolované všetky dostupné registre. Nie je to honest. |
| **3** | **Completeness summary** | Sú len semafory (✓24 ⚠1 ✗1), nie agregát | Používateľ nevidí "Úplnosť: 92%" na prvý pohľad. |
| **4** | **Zoznam osôb z ORSR** | ORSR osoby sú v DB ale nie v PDF | Používateľ nevidí konateľov, spoločníkov, prokuristov v reporte. Pre due-diligence je to základ. |
| **5** | **Ownership štruktúra** | Nie je v PDF | Pre due-diligence je dôležité kto stojí za firmou. |

### 🟠 Čo by zlepšilo hodnotu

| # | Enhancement | Dopad |
|---|-------------|-------|
| **6** | **Per-source check timestamp v registry gride** | "ORSR — kontrolované 11.8.2026 10:42" |
| **7** | **Source criticality indicator v gride** | Kritické zdroje (ORSR, INSOLVENCY, VESTNÍK) označené 🔴 |
| **8** | **"Nedostupné zdroje" sekcia v registry gride** | CRE: "⚪ Nie je súčasťou automatického preverenia" |
| **9** | **Disclaimer o obmedzeniach** | "Verifa nekontroluje: bankové účty, trestné registre, osobné údaje konateľov mimo ORSR" |
| **10** | **Score range explanation na cover page** | "Verifa Score 72/100 — Stredné riziko" (nielen číslo) |

---

## Prirovnanie: Manuálne preverenie vs. Verifa report

| Aktivita | Manuálne (advokát) | Verifa report | Úspora |
|----------|:-:|:-:|:-:|
| ORSR výpis | 5 min + PDF download | ✅ V evidence binderi | ~5 min |
| RÚZ účtovné závierky | 10 min + download | ✅ 5-ročná tabuľka + PDF | ~10 min |
| Obchodný vestník | 15 min vyhľadávanie | ✅ Timeline + detail + PDF | ~15 min |
| Register úpadcov | 5 min | ✅ V evidence binderi | ~5 min |
| Poverenia na exekúcie | 5 min | ✅ V evidence binderi | ~5 min |
| Daňoví dlžníci (FS) | 10 min | ✅ V evidence binderi | ~10 min |
| SP/VSZP/Dôvera/Union dlžníci | 20 min (4 stránky) | ✅ V evidence binderi | ~20 min |
| Diskvalifikácie | 5 min | ✅ V evidence binderi | ~5 min |
| Rozhodnutia súdov | 10 min | ✅ V evidence binderi | ~10 min |
| NCRZP záložné práva | 5 min | ✅ V evidence binderi | ~5 min |
| CRZ zmluvy | 5 min | ✅ V evidence binderi | ~5 min |
| UVO verejné obstarávanie | 5 min | ✅ V evidence binderi | ~5 min |
| Finančná analýza (pomery, trendy) | 30-60 min kalkulačka | ✅ Tabuľky + grafy + Altman/Piotroski/Beneish | ~45 min |
| Risk assessment + verdict | 30-60 min písanie | ✅ AI Chief Auditor + evidence table | ~45 min |
| PDF zborník | 30 min zlučovanie | ✅ Automatické | ~30 min |
| **Total** | **~3-4 hodiny** | **~5 min čakanie** | **~3 hodiny** |

**Verdict:** Report šetrí ~3 hodiny advokátskej práce. Pri hodnote €50-150/hod je €7-15 vynikajúca cena.

---

## Čo by som implementoval pre P4.2 "Report value"

### P0 — Musí byť v reporte (hodnota + transparentnosť)

1. **Per-source check timestamp** — v registry gride pridať "Kontrolované: 11.8.2026 10:42" pre každý zdroj. Dá sa získať z `ReportSource.updatedAt`.

2. **"Nekontrolované zdroje" sekcia** — v registry gride pridať riadky pre zdroje bez scraperu:
   ```
   CRE (Centrálny register exekúcií): ⚪ Nie je súčasťou automatického preverenia
   ```

3. **Completeness summary na cover page** — pod semafory pridať:
   ```
   Úplnosť preverenia: 92% (24 z 26 zdrojov úspešne overených)
   ```

4. **Zoznam osôb z ORSR** — nová sekcia v Part A: konatelia, spoločníci, prokuristi s dátumom vymenovania.

### P1 — Zlepšuje hodnotu

5. **Score label na cover page** — "72/100 — Stredné riziko" nielen číslo.

6. **Source criticality indicator** — kritické zdroje v registry gride označené 🔴.

7. **Disclaimer o obmedzeniach** — na konci Part A: "Verifa nekontroluje: bankové účty, trestné registre, osobné údaje konateľov mimo ORSR, CRE."

### P2 — Nice to have

8. **Ownership štruktúra** — ak je dostupná z ORSR (spoločníci, podiely).

9. **Related party transactions** — ak sú v poznámkach k finančným výkazom.

---

## Záver

**Report je €7-15 hodnotný.** Šetrí ~3 hodiny manuálnej práce. Evidence binder + AI analýza + scoring je reálny produkt.

**Ale chýba mu transparentnosť**, ktorá je pre due-diligence kritická:
- Kedy bol každý zdroj kontrolovaný?
- Čo Verifa explicitne nekontrolovala?
- Aká je celková úplnosť preverenia?

Tieto 3 veci sú P0 — bez nich report nie je honest due-diligence dokument.
