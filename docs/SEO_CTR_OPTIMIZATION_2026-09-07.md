# Company SEO CTR Optimization — Before/After Measurement

**Task:** P0 — Company SEO CTR optimization + measurement
**Date:** 2026-09-07
**Baseline:** GSC Performance export (last 3 months, Jun 7 – Sep 5, 2026)

---

## 1. What changed

### Title template (SK)

**Before:**
```
{name} ({ico}) — Finančné dáta, zisk, súvaha
```

**After (with risk signals):**
```
{name} ({ico}) — finančné údaje a riziká | Verifa
```

**After (without risk signals):**
```
{name} ({ico}) — finančné údaje | Verifa
```

### Description template (SK)

**Before:**
```
{name} ({ico}){city} — účtovné závierky, tržby, zisk, aktíva, osoby a udalosti z verejných registrov SR (ORSR, RÚZ, Obchodný vestník).
```

**After (with risk signals):**
```
Finančné údaje, rizikové signály a registrácia firmy {name} (IČO {ico}){city}. Overenie z verejných registrov SR.
```

**After (without risk signals):**
```
Finančné údaje a registrácia firmy {name} (IČO {ico}){city}. Overenie z verejných registrov SR.
```

### Key differences

| Aspect | Before | After |
|---|---|---|
| Brand in title | ❌ No | ✅ `\| Verifa` |
| Risk signals in title | ❌ No | ✅ Conditional (`riziká` only if page has risk signals) |
| Description focus | Data sources (ORSR, RÚZ, Obchodný vestník) | Value proposition (overenie, rizikové signály) |
| Description CTA | ❌ No | ✅ "Overenie z verejných registrov SR" |
| Title truncation | 60 chars | 65 chars (progressive: full → no brand → name+ico) |
| Risk promise accuracy | N/A | ✅ Only promises "riziká" when page actually renders Risk Signals section |

### Languages updated

All 6 languages (sk, en, de, cs, hu, pl) have the same two-variant structure:
- `titleRisk` / `titleNoRisk`
- `descRisk` / `descNoRisk`

---

## 2. 20 test companies (highest impressions from GSC)

These are the 20 SK company pages with the highest impressions in the last 3 months. They will be the primary measurement cohort.

| # | URL | Impr (3mo) | Clicks (3mo) | CTR | Pos |
|---|---|---|---|---|---|
| 1 | `/firma/36690929-rpc-bramlage-velky-meder-s-r-o` | 43 | 0 | 0% | 7.6 |
| 2 | `/firma/36539155-firstin-s-r-o` | 38 | 0 | 0% | 8.2 |
| 3 | `/firma/46706305` | 33 | 0 | 0% | 6.2 |
| 4 | `/firma/47499184-fach-centrum-kosice-s-r-o` | 32 | 0 | 0% | 7.8 |
| 5 | `/firma/46175415-prosight-slovensko-a-s` | 31 | 0 | 0% | 8.6 |
| 6 | `/firma/47036885-geba-cables-and-wires-slovakia-s-r-o` | 28 | 1 | 3.57% | 8.3 |
| 7 | `/firma/35955678-soitron-s-r-o` | 26 | 0 | 0% | 7.3 |
| 8 | `/firma/35879157-ceva-contract-logistics-slovakia-s-r-o` | 26 | 0 | 0% | 10.4 |
| 9 | `/firma/51268051` | 25 | 0 | 0% | 16.8 |
| 10 | `/firma/35955678` | 24 | 1 | 4.17% | 6.5 |
| 11 | `/firma/31450474-vuje-a-s` | 24 | 0 | 0% | 6.3 |
| 12 | `/firma/53188241-remek-company-s-r-o` | 24 | 0 | 0% | 8.9 |
| 13 | `/firma/36319198-kofola-a-s` | 24 | 0 | 0% | 9.3 |
| 14 | `/firma/48006122-msm-export-s-r-o` | 23 | 0 | 0% | 6.4 |
| 15 | `/firma/45626618-vedos-s-r-o` | 23 | 0 | 0% | 6.8 |
| 16 | `/firma/31382711-tatra-united-corporation-a-s` | 23 | 0 | 0% | 7.2 |
| 17 | `/firma/54998778-damian-jasna-hotel-resort-residences-s-r-o` | 22 | 0 | 0% | 6.7 |
| 18 | `/firma/47226731-handlopex-slovakia-s-r-o` | 22 | 0 | 0% | 8.8 |
| 19 | `/firma/35766450-medirex-s-r-o` | 22 | 0 | 0% | 30.8 |
| 20 | `/firma/53915241-bp2-svk-s-r-o` | 21 | 0 | 0% | 3.4 |

**Baseline cohort totals:** 503 impressions, 2 clicks, 0.40% CTR (3 months).
**Monthly rate:** ~168 impressions, ~0.7 clicks/month.

---

## 3. Before/after rendered HTML (sample)

### Novogal a.s. (00199567) — captured from production BEFORE deploy

**Title (before):**
```
Novogal a.s. (00199567) — Finančné dáta, zisk, súvaha
```

**Description (before):**
```
Novogal a.s. (00199567), Dvory nad Žitavou — účtovné závierky, tržby, zisk, aktíva, osoby a udalosti z verejných registrov SR (ORSR, RÚZ, Obchodný vestník).
```

**Title (after — expected, if has risk signals):**
```
Novogal a.s. (00199567) — finančné údaje a riziká | Verifa
```

**Description (after — expected, if has risk signals):**
```
Finančné údaje, rizikové signály a registrácia firmy Novogal a.s. (IČO 00199567), Dvory nad Žitavou. Overenie z verejných registrov SR.
```

---

## 4. Measurement plan

### What to measure

| Metric | How | When |
|---|---|---|
| CTR for 20 test companies | GSC Performance → filter by page → compare 28-day window | D+7, D+14, D+30 |
| CTR for all `/firma/` pages | GSC Performance → page type filter | D+14, D+30 |
| Impressions for 20 test companies | GSC Performance | D+7, D+14, D+30 |
| Position for 20 test companies | GSC Performance | D+7, D+14, D+30 |
| Title change confirmed in SERP | `site:verifa.sk/firma/00199567` in Google | D+3, D+7 |

### Comparison windows

**IMPORTANT:** Do NOT compare the 3-month rolling window before vs after — the deploy effect will be diluted. Instead:

1. **Before:** Jun 7 – Sep 5 (captured in this document)
2. **After D+7:** Sep 8 – Sep 14 (7-day window)
3. **After D+14:** Sep 8 – Sep 21 (14-day window)
4. **After D+30:** Sep 8 – Oct 7 (30-day window)

Export GSC Performance with date filter for each window.

**IMPORTANT:** Do NOT use `site:verifa.sk/...` search as a measurement method.
Google SERP title updates are delayed and `site:` results are not a reliable
analytical dataset. The primary evidence is GSC Performance → Pages/Queries
comparison for the same 20 URLs.

### Metrics to track at D+7 / D+14 / D+30

For both the **20-company test cohort** AND **all `/firma/` pages** as a whole:

| Metric | Cohort (20 URLs) | All `/firma/` | Purpose |
|---|---|---|---|
| Total impressions | ✅ | ✅ | Did visibility change? |
| Total clicks | ✅ | ✅ | Did clicks increase? |
| CTR | ✅ | ✅ | Primary success metric |
| Average position | ✅ | ✅ | Did ranking change? (shouldn't from title alone) |
| Pages with impressions | ✅ | ✅ | Did more pages start appearing? |
| Pages with clicks | ✅ | ✅ | Did more pages start getting clicks? |

Tracking both the cohort and `/firma/` as a whole lets us separate the **title/meta
effect** from natural ranking growth/fluctuation. If the cohort CTR improves but
the overall `/firma/` CTR doesn't, the title change worked but only for high-
impression pages. If both improve, the effect is broader.

### Decision framework (D+14)

| Outcome | Interpretation | Action |
|---|---|---|
| **A) CTR ≥ +25%** | Title/meta change is effective | Keep template, consider applying to other page types |
| **B) CTR +10–25%** | Partial effect, room for improvement | Iterate title/description wording, re-test |
| **C) CTR < +10%** | Metadata is not the bottleneck | Investigate ranking, search intent, snippet rendering |
| **D) CTR up but impressions/position down** | Metadata changed but something else regressed | Check if title change caused ranking shift or if external factor |

### Experiment isolation

To preserve clean experiment results:

- **Do NOT make any other SEO changes for 7–14 days** after deploy (Sep 7)
- **Do NOT change ORSR glossary title** during this period
- **Do NOT create new pages** (NACE × city, business-intent)
- **Do NOT change URL architecture**
- The only variable in this period is the company page title/meta template

---

## 5. Implementation details

### Files changed

| File | Change |
|---|---|
| `frontend/src/lib/seo.ts` | `FIRMA_SEO` → two variants per language (risk/no-risk); `generateFirmaMetadata` accepts `hasRiskSignals` |
| `frontend/src/components/firma-page.tsx` | `generateFirmaPageMetadata` computes risk signals and passes `hasRiskSignals` |
| `frontend/src/lib/__tests__/firma-metadata.test.ts` | New test file: 22 tests for metadata generation |

### Tests added

22 unit tests covering:
- SK/en/de/cs/hu/pl title includes risk keywords when `hasRiskSignals=true`
- SK/en title excludes risk keywords when `hasRiskSignals=false`
- Default `hasRiskSignals=false` (no risk promise)
- Description includes/excludes risk keywords
- Description includes/excludes city
- Title length ≤ 65 chars (short + long names)
- Description length ≤ 160 chars (short + long names)
- Description length ≥ 50 chars (minimum)
- Canonical URL includes slug
- Hreflang alternates include all 6 languages + x-default
- Robots index+follow for indexable company
- No duplicate company name in title

### What was NOT changed

- ❌ URL architecture
- ❌ Sitemap
- ❌ Canonical strategy
- ❌ Hreflang strategy
- ❌ Robots rules
- ❌ New pages
- ❌ NACE × city pages
- ❌ Business-intent pages
