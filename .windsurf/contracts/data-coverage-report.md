# Data Coverage Recovery — Coverage Report

**Date:** 2026-08-24  
**Status:** BACKFILLS IN PROGRESS

---

## Coverage Summary

### Before Backfills (Baseline)

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

### After Vestník Backfill (Complete)

| Axis | Count | Coverage | Delta |
|------|-------|----------|-------|
| vestnikSyncedAt | 518,800 | 100.00% | +518,800 |
| VestnikEvent records | 4,762 | — | +4,762 |
| Companies with Vestník events | 3,127 | 0.60% | +3,127 |
| legalStatus known (≠ UNKNOWN) | 2,044 | 0.39% | +1,319 |
| legalStatusSource = VESTNIK | 1,317 | 0.25% | +1,317 |
| legalStatusSource = RUZ | 0 | 0.00% | ✅ invariant holds |

### Vestník → legalStatus Derivation

| legalStatus | Count | Source |
|-------------|-------|--------|
| LIQUIDATION | 1,009 | VESTNIK |
| BANKRUPT | 299 | VESTNIK |
| RESTRUCTURING | 9 | VESTNIK |

### After ORSR Bulk Sync (In Progress)

| Axis | Current | Target | Progress |
|------|---------|--------|----------|
| orsrSyncedAt | ~1,183 | 515,896 | 0.23% |
| legalStatusSource = ORSR | ~1,182 | — | — |

ORSR legalStatus distribution (current):
| legalStatus | Count |
|-------------|-------|
| ACTIVE | ~1,020 |
| LIQUIDATION | ~96 |
| DISSOLVED | ~2 |

### After Financial Backfill (In Progress)

| Axis | Current | Target | Progress |
|------|---------|--------|----------|
| hasFinancials (latestYear) | 299,275 | 404,845 | 73.94% |
| Companies needing parsing | ~105,589 | 0 | — |

---

## Cross-Source Precedence Validation (Phase 10)

All invariants verified:

1. **`legalStatusSource = RUZ` = 0** ✅ — RÚZ never sets legalStatus
2. **No `legalStatus` without `legalStatusSource`** ✅ — 0 violations
3. **No Vestník override of ORSR status** ✅ — 0 companies with VESTNIK source + orsrSyncedAt
4. **ORSR wins over Vestník** ✅ — 20 companies with ORSR=ACTIVE + Vestník konkurz/likvidácia events correctly show ACTIVE

---

## Backfill Details

### Vestník Backfill (COMPLETE)
- **Script:** `/tmp/vestnik_backfill.py` (Python, runs on production host)
- **API:** `https://datahub.ekosystem.slovensko.digital/api/data/ov/konkurz_restrukturalizacia_issues/sync`
- **Lookback:** 365 days
- **Duration:** 151.5 seconds (76 pages)
- **Events fetched:** 4,762
- **Events saved:** 4,762 (100%)
- **Companies matched:** 3,127
- **vestnikSyncedAt set:** 518,800 (all companies)

### ORSR Bulk Sync (IN PROGRESS)
- **Script:** `worker/src/bulk_seed_orsr.py` (Python, runs in verifa_worker container)
- **API:** `https://www.orsr.sk/`
- **Rate limit:** 300ms between requests
- **Concurrency:** 5
- **Throughput:** ~10 companies/min
- **Estimated completion:** ~36 days for 515K companies
- **Legal status derivation:** Added (ACTIVE/LIQUIDATION/DISSOLVED from findings text)

### Financial Backfill (IN PROGRESS)
- **Script:** `/tmp/financial_backfill_v2.py` (Python, runs in verifa_arq_worker container)
- **API:** `https://www.registeruz.sk/cruz-public/api/`
- **Rate limit:** 200ms between requests, exponential backoff on 429/503
- **Concurrency:** 20
- **Throughput:** ~22 companies/min (pilot), expecting higher with concurrency=20
- **Success rate:** 73% (27% have PDF-only/IFRS statements with no parseable tables)
- **Estimated completion:** ~80 hours for 105K companies

---

## Remaining Work

1. **ORSR bulk sync** — Continue running until 515K companies processed (~36 days)
2. **Financial backfill** — Continue running until 105K companies processed (~80 hours)
3. **Phase 14-17** — Run invariant tests, regression tests, generate final coverage report, performance validation
4. **Cron setup** — Configure Vestník cron to use the new checkpoint for daily incremental updates
