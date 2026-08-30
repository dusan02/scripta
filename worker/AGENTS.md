# Verifa Worker — Scoring Engine Development Guide

## Scoring Engine v3 — FROZEN (2026-08-20)

**Status:** Architecture frozen. Further changes are calibration, not architecture.

### Freeze Evidence

| Validation | Result | Method |
|------------|--------|--------|
| Unit tests | 170/170 pass | `pytest tests/test_forensic_scorecard.py tests/test_analytics.py` |
| Adversarial audit | 35/35 pass, 0 HIGH | `python -m tests.adversarial_scoring_audit` |
| Population audit | 12,575 firms scored, 0 errors | `python -m tests.population_audit` |
| Decile validity | 11/11 metrics monotonic | `python -m tests.p1_comprehensive_audit` |
| Boundary audit | No jumps at 49/50, 69/70 | Same script |
| Top/bottom 100 | Fundamentally sound | Same script |
| Fallback calibration | Acceptable (minor Q2/Q3 noise) | Same script |

### Key Architecture Decisions

1. **Score ≠ Confidence**: Score = what we know about the firm. Confidence = how reliably we know it.
2. **N/A ≠ 0**: Missing data means "cannot assess", not "financially bad". P2 fallback uses ratio-based assessment when Altman/Piotroski are N/A.
3. **P2 hierarchical scoring**:
   - Tier 1: Altman Z'' + Piotroski (full data)
   - Tier 2: Ratio-based fallback (ROA, equity/TA, D/E, CR, profitability/CF)
   - Tier 3: Data void (minimum)
4. **Confidence**: 100 baseline, -20 for ratio_fallback, -40 for data_void, -10 per N/A model, -30×(1-DQ_mult) for data quality.
5. **Vestník single-counting**: Penalized only in P5 (Právna bezúhonnosť), never in P1-P4.
6. **CF/DSO single mechanism**: Integrated into P3, no separate CF/DSO Stress pillar.
7. **Altman X2 = retainedEarnings/TA** (not equity/TA) when DB has retainedEarnings field.
8. **Altman X4 capped at 10.0** to prevent Z'' explosion when liabilities ≈ 0.
9. **Piotroski renormalization**: `earned / n_available * 8`, N/A if >4 criteria missing.
10. **Deterministic adjustment clamp ±10**, LLM adjustment is informative only.

### Fixes Applied (F1-F7, I1)

| ID | Problem | Fix |
|----|---------|-----|
| F1 | Altman X4 explosion | Cap X4 at 10.0 |
| F2 | Altman X2 = equity (not retained earnings) | Use retainedEarnings from DB, fallback to equity |
| F3 | Piotroski missing-data inflation | Renormalize, N/A if >4 missing |
| F4 | Vestník double-counting P1+P5 | P5 only |
| F5 | LLM adj clamp ±5 vs prompt ±10 | Clamp ±10, prompt says informative only |
| F6 | LLM adj discrepancy | Prompt and code aligned |
| F7 | CF double-counting P3+CF/DSO | Integrated into P3, one mechanism |
| I1 | P2 ≈ 0 when Altman+Piotroski N/A | Hierarchical fallback + confidence |

### Population Distribution (12,575 firms)

- Mean score: 58.0, Median: 61
- AAA: 0, A: 26.3%, B: 59.4%, C: 14.2%
- Altman N/A: 10.4%, Piotroski N/A: 11.0%
- P2 ratio_fallback: 10.7% of firms
- Mean confidence: 92.2

### Decile Discrimination (D1=lowest → D10=highest)

| Metric | D1 | D10 | Direction |
|--------|---:|---:|:---:|
| Altman Z'' | -2.26 | 9.22 | ↑ |
| Piotroski | 3 | 6 | ↑ |
| Profitable % | 11.0% | 99.6% | ↑ |
| Positive CF % | 16.1% | 99.2% | ↑ |
| Equity ratio | 0.05 | 0.62 | ↑ |
| D/E | 2.0 | 0.6 | ↓ |
| Current ratio | 0.67 | 3.15 | ↑ |

All 11 metrics pass monotonicity check.

### Known Limitations (not blockers)

- AAA = 0 (max score = 85) — conservative, may be intentional
- Vestník coverage = 1/518,800 companies — **data pipeline blocker, not scoring bug**
- Fallback Q2/Q3 non-monotonicity (37 vs 36) — within noise
- ROA/ROE/NPM display as 0.0% — display rounding, monotonicity passes

### Build & Test Commands

```bash
cd worker

# Unit tests
.venv/bin/python -m pytest tests/test_forensic_scorecard.py tests/test_analytics.py -x -q

# Adversarial audit (35 checks)
.venv/bin/python -m tests.adversarial_scoring_audit

# Population audit (requires DB)
.venv/bin/python -m tests.population_audit

# P1 comprehensive audit (requires DB + population_results.json)
.venv/bin/python -m tests.p1_comprehensive_audit

# Vestník + 4-stmt anomaly audit
.venv/bin/python -m tests.vestnik_4stmt_audit

# Real company validation (200 sample)
.venv/bin/python -m tests.real_company_validation
```

### Database

- PostgreSQL: `postgresql://verifa:verifa_dev_password@localhost:5432/verifa`
- Scoreable companies: ≥2 FinancialStatement records
- Key tables: Company, FinancialStatement, VestnikEvent, CompanyEvent
- `retainedEarnings` field available in FinancialStatement (used for Altman X2)

### Data Coverage Model (product-level, not scoring)

Three states for data sources:
- **FOUND**: Relevant event found
- **NOT_FOUND**: Source covered, nothing found (positive signal)
- **NO_DATA**: Source not sufficiently covered (cannot claim "clean")

This distinction is critical for Vestník — currently NO_DATA state for 99.99% of firms.

## Vestník Data Pipeline — REPAIRED (2026-08-20)

### Root Cause

API `datahub.ekosystem.slovensko.digital` changed structure — `cin` and `debtor.cin` fields no longer exist. IČO is now in `proposers[].cin` (86.6% coverage) and text fields (21.6%). Scraper was looking for non-existent fields → 0 matches → backfill never ran → only 1 manually-inserted event.

### Fix Applied

1. **IČO extraction**: New `extractIco()` function in `vestnik.ts`, `vestnik-backfill.ts`, and `obchodny_vestnik.py` — checks `proposers[].cin` first, then regex fallback from text.
2. **Classification fix**: Added "zrušil" pattern to `classifyEvent()` — 500 events reclassified from LOW to HIGH.
3. **DB reset + RPO re-import**: 518,791 companies imported from RPO dump.
4. **Vestník backfill**: 4,790 events, 3,146 companies matched, 0 orphans, 0 duplicates.

### Coverage Audit (post-fix)

| Metric | Value |
|--------|-------|
| Total companies | 518,791 |
| Companies with events | 3,146 (0.61%) |
| Total events | 4,790 |
| CRITICAL (Konkurz) | 2,608 |
| HIGH (Zrušenie + Likvidácia + Exekúcia) | 2,178 |
| Orphan FK | 0 |
| Duplicates | 0 |
| Date range | 2019-03 to 2026-08 |
| Lookback | 365 days |

### Severity Distribution (by company)

| Max Severity | Companies |
|-------------|-----------|
| CRITICAL | 1,068 |
| HIGH | 2,074 |
| MEDIUM | 1 |
| LOW | 3 |

### FOUND / CHECKED_NO_EVENT / NO_DATA — Data Trust Model

**Definition (auditable):**

| Status | Meaning | Audit Criterion |
|--------|---------|-----------------|
| **FOUND** | Company has ≥1 Vestník event matched in DB | `VestnikEvent.companyIco = company.ico` exists |
| **CHECKED_NO_EVENT** | Source was successfully queried (bulk sync completed), no matching event found for this company | `VestnikSyncCheckpoint.lastRunSuccess = true` AND company has 0 events |
| **NO_DATA** | Source could not be reliably queried | `VestnikSyncCheckpoint.lastRunSuccess = false` OR no checkpoint exists |

**Critical distinction:** `CHECKED_NO_EVENT` ≠ "company is clean". It means:
> "No matching event was found in the 365-day dataset successfully retrieved from this endpoint."

This is semantically weaker than "NOT_FOUND" because:
1. The Vestník API is a **bulk event dump**, not a per-company lookup
2. We match by IČO extracted from `proposers[].cin` (86.6%) or text regex (21.6%) — extraction failure means false negatives
3. The 365-day lookback window may miss older events
4. API cursor semantics depend on `updated_at`, which means re-indexed old records appear as "new"

**Current state (post-backfill):**

| Status | Companies | % | Audit |
|--------|-----------|---|-------|
| FOUND | 3,146 | 0.61% | ✅ VestnikEvent records exist |
| CHECKED_NO_EVENT | 515,645 | 99.39% | ✅ Checkpoint: lastRunSuccess=true, 76 pages, 4,790 events |
| NO_DATA | 0 | 0% | ✅ No failed sync runs |

**NO_DATA = 0 is correct** because the backfill completed successfully (all 76 pages, no errors, checkpoint saved with `success=true`). If the backfill had failed partway, all companies would be NO_DATA until a successful re-run.

**Product implication:** When displaying "no Vestník events found" for a company, the UI should say:
> "V obchodnom vestníku sme za posledných 365 dní nenašli žiadne relevantné oznámenia."

NOT:
> "Firma nemá žiadne záznamy v obchodnom vestníku."

The difference matters because the first is a verified claim within a scope, the second is an absolute claim we cannot make.

### Files Modified

- `frontend/src/lib/vestnik.ts` — `extractIco()` + `classifyEvent()` fix + `parseDate()` fix + `resolveSourceId()` fingerprint + checkpoint P0 fixes + `or_podanie_issues` documentation
- `frontend/src/lib/vestnik-backfill.ts` — `extractIco()` + `classifyEvent()` fix + `parseDate()` fix + `resolveSourceId()` fingerprint + checkpoint P0 fixes
- `worker/src/scrapers/obchodny_vestnik.py` — `_extract_ico()` static method

### Bug Fixes (P0 + P1)

| ID | Bug | Fix |
|----|-----|-----|
| P0-1 | Backfill marks partial failure as SUCCESS | `allSuccess` flag, set to false on HTTP error or exception |
| P0-2 | MAX_PAGES treated as success in cron | `reachedPageLimit` check — if more pages exist, `allSuccess = false` |
| P0-3 | Checkpoint cursor from "next URL" params | Track `lastProcessedId` and `lastProcessedSince` from actual processed items |
| P1-4 | `parseDate("UNKNOWN")` returns Invalid Date | Explicit `isNaN(date.getTime())` check with fallback chain |
| P1-5 | `sourceId = "UNKNOWN"` causes collisions | `fingerprintSourceId()` — SHA-256 hash of ico+publishedAt+kind+text |
| P2-8 | `or_podanie_issues` inconsistency | Documented as deliberate decision (API data ends Dec 2022) |

### Remaining Work

- **RÚZ financials bulk import**: FinancialStatement table is empty — needs `seed-financials-bulk.ts` run (~42 hours for full import). **BLOCKED**: RÚZ API (registeruz.sk) is WAF-blocked from this environment. Must run from a server where the API is accessible.
- **ORSR bulk seed**: ✅ COMPLETED (2026-08-27) — see "ORSR Bulk Seed — COMPLETED" section below. Do NOT re-run unless a specific data issue surfaces.
- **Historical backfill**: Current backfill only covers 365 days. Older events exist in API but require longer lookback.
- **P5 population audit**: After financials import, re-run P1 comprehensive audit to measure P5 impact.
- **P1-6 (deferred)**: Unify pagination helper between backfill/cron/Python — maintenance debt, not a blocker.

### Vestník Pipeline — FROZEN (2026-08-20)

**Status: CODE FREEZE CANDIDATE — no further changes unless bug found in production.**

All P0/P1 bugs fixed, empirically verified, and acceptance tested:

| Test | Result |
|------|--------|
| P0-1: Partial failure ≠ SUCCESS | ✅ `allSuccess` flag, verified via backfill + cron |
| P0-2: MAX_PAGES ≠ SUCCESS | ✅ `reachedPageLimit` check in cron |
| P0-3: Cursor = last item id + updated_at | ✅ **100% match on 76 pages** (empirically verified) |
| P1-4: parseDate("UNKNOWN") | ✅ `isNaN(date.getTime())` check |
| P1-5: UNKNOWN sourceId → fingerprint | ✅ SHA-256 hash, 0 collisions |
| P2-8: or_podanie_issues documented | ✅ Deliberate decision (API data ends Dec 2022) |

**API cursor semantics (empirically verified 2026-08-20):**
- `last_id` = id of last item on page
- `since` = `updated_at` of last item on page (NOT `created_at` — old records get re-indexed)
- Items sorted by `updated_at`, not by `id` (IDs are non-monotonic)
- 100% cursor match across 76 pages with `updated_at`

**Acceptance test snapshot:**
- Company count: 518,791
- VestnikEvent count: 4,790
- FOUND: 3,146 | CHECKED_NO_EVENT: 515,645 | NO_DATA: 0
- Orphan FK: 0 | Duplicates: 0
- Checkpoint: lastId=2155342, lastRunSuccess=true

## Extraction Cache — IFRS Determinism (2026-08-23)

**Problem:** IFRS firms (template 709/703) have no RÚZ JSON tables — `obsah: {}`, only PDF attachments. All financial extraction goes through LLM (gemini-3.5-flash-lite, temp=0.0). While 13/15 fields are stable, `interest` and `gross_profit` showed variability across runs (same PDF → different values).

**Solution:** Two-layer fix:

1. **Prompt v4** (`src/agents/financial_analyst.py`):
   - `gross_profit`: Removed "Pridaná hodnota" (Value added) as proxy — IFRS/SK GAAP must have explicit "Gross profit" row, else return null.
   - `interest`: Disambiguated "Finance costs" (broader IFRS category) from "Interest expense" — must use explicit interest line, else return null.

2. **ExtractionCache** (`src/extraction_cache.py` + `ExtractionCache` DB table):
   - Cache key: `pdfHash + extractor + model + promptVersion + schemaVersion`
   - HIT → return cached result (0 LLM calls, 100% deterministic)
   - MISS → call LLM, store result, return
   - Invalidation: bump `PROMPT_VERSION` or `SCHEMA_VERSION` in `extraction_cache.py`
   - Stores: `rawResponse` (full LLM JSON), `normalizedData` (FinancialMetrics), `confidence`, `warnings`, `missingFields`

**Acceptance test (Danucem 2023 PDF, 3× runs):**
- Run 1: CACHE MISS → LLM → STORE
- Run 2: CACHE HIT → 0 LLM calls
- Run 3: CACHE HIT → 0 LLM calls
- 15/15 fields STABLE, 1 LLM call total

**DB schema note:** `ExtractionCache` table created via raw SQL (not `prisma migrate`). Project uses `db push` workflow, not migration files. Table is introspected by Prisma client correctly.

**Version constants:**
- `PROMPT_VERSION = "v4"` — bump when `SYSTEM_PROMPT` in `financial_analyst.py` changes
- `SCHEMA_VERSION = "v1"` — bump when `FinancialMetrics` Pydantic schema changes

**Cache invalidation procedure:**
1. Edit prompt in `financial_analyst.py` or schema in `shared.py`
2. Bump `PROMPT_VERSION` or `SCHEMA_VERSION` in `extraction_cache.py`
3. Deploy — next report run will re-extract all IFRS PDFs with new prompt/schema
4. Old cache entries remain in DB (audit trail) but are never matched

**Files:**
- `src/extraction_cache.py` — cache lookup/store/stats module
- `src/agents/financial_analyst.py` — SYSTEM_PROMPT with v4 fixes
- `src/pipeline.py` — cache integration in `_process_ifrs()`
- `prisma/schema.prisma` — `ExtractionCache` model

## ORSR Bulk Seed — COMPLETED (2026-08-27)

**Status: DONE. Do NOT re-run unless a specific data issue surfaces.**

### Final Numbers (production DB, 2026-08-27)

| Metric | Value |
|--------|-------|
| Eligible companies (s.r.o., a.s., v.o.s., k.s.) | 515,907 |
| Synced (`orsrSyncedAt` NOT NULL) | **515,907 / 515,907 (100%)** |
| Pending eligible | **0** |
| `legalStatusSource = 'ORSR'` | **515,907 / 515,907 (100%)** |
| Synced without `legalStatus` | **0** |
| Definitive failures | **0** |
| Checkpoint `failed_icos` | **`[]`** (empty) |
| Final cursor (`last_ico`) | `99889989` |
| Gap-fill pass | **completed** |
| Supervisor exit code | **0** (normal) |

### `legalStatus` distribution (from ORSR findings)

| Status | Count |
|--------|------:|
| ACTIVE | 513,505 |
| LIQUIDATION | 2,391 |
| DISSOLVED | 11 |

### Enrichment coverage

| Field | Filled | % of synced | Source |
|-------|-------:|------------:|--------|
| `shareCapital` | 132,178 | 25.6% | ORSR |
| `signingAuthority` | 118,050 | 22.9% | ORSR |
| `businessActivity` | 518,642 | >100% of ORSR-synced | **RPO** (not ORSR) |

**`businessActivity` audit note:** The count (518,642) is higher than ORSR-synced (515,907) because this field is populated from the RPO import, which covers all legal forms (including družstvá, štátne podniky, európske družstvá, európske spoločnosti SE) that are NOT in ORSR. This is expected and not an inconsistency. ORSR does not re-write `businessActivity` — it only fills it when RPO left it NULL.

### CompanyPerson (from ORSR)

| Metric | Value |
|--------|------:|
| Total records | 1,365,267 |
| Companies with persons | 517,572 |
| With `functionStart` | 1,209,004 |
| Active (`isActive=true`) | 1,312,336 |
| Inactive (`isActive=false`) | 52,931 |

### Throughput

| Metric | Value |
|--------|-------|
| Average speed | 423.7 companies/min (7.1/s) |
| Total runtime (this run) | ~15 hours (54,045 s) |
| Cursor pass + gap-fill | both completed in single supervisor-managed run |

### Transient errors (resolved)

- 1,041× `_do_fetch failed after 3 attempts` in logs — transient ORSR network/API errors, handled by retry logic.
- 32 ICOs marked FAILED in checkpoint after main pass — all 32 retried successfully (32/32 SUCCESS, 0 failures) on 2026-08-27 15:11.
- DB audit confirmed all 32 are synced with `legalStatusSource='ORSR'` post-retry.

### ⚠️ Known bug: `--retry-failed` requires `--resume`

**`bulk_seed_orsr_v2.py --retry-failed` MUST be invoked with `--resume`.**

Without `--resume`, the script creates a **fresh checkpoint** with `failed_icos = []`, so the retry path immediately logs `"No failed ICOs to retry."` and exits without doing anything — the original `failed_icos` list in the checkpoint file is lost.

**Correct invocation:**
```bash
python -m src.bulk_seed_orsr_v2 --retry-failed --resume --concurrency 5
```

**Incorrect (no-op, destroys checkpoint state):**
```bash
python -m src.bulk_seed_orsr_v2 --retry-failed  # WRONG — fresh checkpoint
```

Root cause: `argparse` branch at line ~549 — `--retry-failed` without `--resume` falls into the `else` branch that creates a fresh checkpoint, overwriting the on-disk file before the retry logic runs. Fix would be to make `--retry-failed` imply `--resume`, but seed is DONE so this is documentation-only.

### Files

- `src/bulk_seed_orsr_v2.py` — V2 cursor-based bulk seed (the one that ran to completion)
- `src/bulk_seed_orsr.py` — V1 (legacy, superseded by V2)
- `src/scrapers/orsr.py` — ORSR scraper
- `orsr_v2_supervisor.sh` — auto-resume supervisor (entrypoint launches it for worker container)
- `results/orsr_v2_checkpoint.json` — final checkpoint (production: `/app/results/`)
- `results/orsr_v2_supervisor.log` — full run log (production: `/app/results/`)

### Why this matters

ORSR is the authoritative commercial register for `legalStatus` (per frozen multi-axis contract: ORSR > Vestník > RÚZ). With 100% coverage of eligible firms, `legalStatus` is no longer a data pipeline blocker for the scoring engine or the product.
