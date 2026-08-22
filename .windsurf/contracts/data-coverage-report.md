# Data Coverage Recovery — Coverage Report

**Date:** 2026-08-22
**Status:** PHASE 2 COMPLETE — Financials done, ORSR bulk running

---

## Coverage Summary

### Before Backfills (Baseline — Phase 0)

| Axis | Count | Coverage |
|------|-------|----------|
| Total companies | 518,800 | — |
| vestnikSyncedAt | 0 | 0.00% |
| orsrSyncedAt | 727 | 0.14% |
| hasFinancials (latestYear) | 298,921 | 57.61% |
| legalStatus known (≠ UNKNOWN) | 725 | 0.14% |
| legalStatusSource = ORSR | 725 | 0.14% |
| legalStatusSource = VESTNIK | 0 | 0.00% |
| legalStatusSource = RUZ | 0 | 0.00% ✅ (invariant) |

### After Phase 2 (Current — 2026-08-22)

| Axis | Count | Coverage | Delta |
|------|-------|----------|-------|
| vestnikSyncedAt | 518,800 | 100.00% | +518,800 |
| VestnikEvent records | 4,762 | — | +4,762 |
| Companies with Vestník events | 3,127 | 0.60% | +3,127 |
| orsrSyncedAt | 7,617+ (running) | 1.48%+ | +6,890 |
| hasFinancials (latestYear) | 404,559 | 78.07% | +105,638 |
| legalStatus known (≠ UNKNOWN) | 5,030 | 0.97% | +4,305 |
| legalStatusSource = ORSR | 3,630+ | — | +2,905 |
| legalStatusSource = VESTNIK | 1,314 | — | +1,314 |
| legalStatusSource = RUZ | 0 | 0.00% | ✅ invariant holds |
| Financial backlog | 232 | — | -40,867 |

### Legal status distribution (current)

| legalStatus | legalStatusSource | Count |
|-------------|-------------------|------:|
| UNKNOWN | NONE | 513,170 |
| ACTIVE | ORSR | 3,630+ |
| LIQUIDATION | VESTNIK | 1,008 |
| LIQUIDATION | ORSR | 681+ |
| BANKRUPT | VESTNIK | 297 |
| RESTRUCTURING | VESTNIK | 9 |
| DISSOLVED | ORSR | 5+ |

---

## Phase 2 Results

### Financial Backfill — COMPLETED

| Metric | Value |
|--------|------:|
| Before (latestYear IS NOT NULL) | 363,692 |
| After (latestYear IS NOT NULL) | 404,559 |
| Delta | +40,867 |
| Success | 40,867 |
| Failed (genuinely unparseable) | 232 |
| Duration | 81.2 min |
| Throughput | 499/min |
| Success rate | 99.95% |
| Remaining backlog | 232 (PDF-only/IFRS statements) |

**Pagination fix:** OFFSET → cursor-based (`WHERE ico > :last_ico ORDER BY ico ASC LIMIT :batch`)
**Checkpoint:** `last_ico` cursor + processed/failed/skipped sets (idempotent)
**Script:** `/tmp/financial_backfill_v3.py` (deployed to arq_worker)

### ORSR Bulk Sync — RUNNING

| Metric | Value |
|--------|------:|
| Before (orsrSyncedAt) | 1,744 |
| Current (orsrSyncedAt) | 7,617+ (growing) |
| Eligible companies | 515,344 |
| Remaining | ~507,727 |
| Throughput (v2 optimized) | 56-62/min |
| Throughput (v1 old) | 10/min |
| Improvement | 5.6-8.1x |
| Estimated completion | ~138 hours (~5.7 days) |
| Checkpoint | cursor-based on ico, idempotent |
| Script | `/tmp/orsr_bulk_v2.py` (deployed to arq_worker) |

**ORSR throughput benchmark (concurrency sweep):**

| Concurrency | Companies/min | Avg latency | P95 latency | Errors |
|-------------|:---:|:---:|:---:|:---:|
| 1 | 63.2 | 949ms | 1854ms | 0% |
| 2 | 87.5 | 1320ms | 4187ms | 0% |
| **5** | **155.3** | **1689ms** | **2201ms** | **0%** |
| 10 | 43.7 | 12538ms | 21500ms | 0% (throttled) |

**Optimizations applied:**
- Lightweight scraper: 2 HTTP requests (search + detail), no PDF, no FULL extract
- Reused HTTP client across all companies
- Cursor-based pagination (no OFFSET drift)
- Raw SQL for all DB writes (no Prisma overhead)
- Dedicated DB thread (psycopg2 is sync, asyncio is async)
- Idempotent checkpoint with last_ico cursor

### Vestník — COMPLETED (Phase 1)

| Metric | Value |
|--------|------:|
| vestnikSyncedAt | 518,800 (100%) |
| VestnikEvent records | 4,762 |
| Companies with events | 3,127 |
| legalStatus derived | 1,314 (LIQUIDATION + BANKRUPT + RESTRUCTURING) |

---

## Cross-Source Precedence Validation

All invariants verified (2026-08-22):

1. **`legalStatusSource = RUZ` = 0** ✅ — RÚZ never sets legalStatus
2. **No `legalStatus` without `legalStatusSource`** ✅ — 0 violations
3. **No Vestník override of ORSR status** ✅ — 0 companies with VESTNIK source + orsrSyncedAt
4. **ORSR wins over Vestník** ✅ — 25 companies with ORSR=ACTIVE + Vestník negative events correctly show ACTIVE
5. **`legalStatusSource ∈ {ORSR, VESTNIK, NONE}`** ✅ — no other values exist

---

## Regression Tests (2026-08-22)

| Test | Result |
|------|--------|
| TypeScript typecheck (`tsc --noEmit`) | ✅ 0 errors |
| Unit tests (`node --test`) | ✅ 508/508 pass |
| Build (`next build`) | ✅ Success |
| Screener semantic tests (13 groups) | ✅ All pass |

### Screener smoke tests (DB-verified)

| Filter | DB Count |
|--------|------:|
| status=ACTIVE | 2,575 |
| status=UNKNOWN | 514,516 |
| status=LIQUIDATION | 1,397 |
| status=BANKRUPT | 298 |
| status=RESTRUCTURING | 9 |
| status=DISSOLVED | 5 |
| ruzReporting=VERIFIED | 404,374 |
| ruzReporting=NOT_FOUND | 86,441 |
| ruzReporting=UNKNOWN | 27,985 |
| hasFinancials=yes | 404,559 |
| hasFinancials=no | 114,241 |
| vestnikClean=yes | 515,673 |

---

## Remaining Work

1. **ORSR bulk sync** — Continue running until 515K companies processed (~5.7 days at 56/min)
2. **Phase 3 — Production Readiness Audit** — cross-source consistency, freshness, stale data, duplicates, scoring interactions, performance, monitoring, failure recovery
3. **Cron setup** — Configure Vestník cron for daily incremental updates using new checkpoint
4. **232 unparseable financials** — Investigate if alternative parsing (PDF extraction) is feasible
