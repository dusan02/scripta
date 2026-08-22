# Data Coverage Recovery — Pre-flight Audit

**Status:** ACTIVE  
**Date:** 2026-08-24  

---

## PHASE 0 — Pre-flight Audit

### Source 1: Vestník

| Field | Value |
|-------|-------|
| **Existing job/script** | `frontend/src/lib/vestnik-backfill.ts` (manual), `frontend/src/lib/vestnik.ts` (cron), `frontend/src/app/api/cron/vestnik-ingest/route.ts` |
| **Input** | `https://datahub.ekosystem.slovensko.digital/api/data/ov/konkurz_restrukturalizacia_issues/sync` |
| **Output** | `VestnikEvent` records (matched to companies by IČO) |
| **DB fields written** | `VestnikEvent.{companyIco, eventType, severityLevel, summary, publishedAt, sourceId}`, `VestnikSyncCheckpoint` |
| **Rate limit** | 1200ms between pages (`RATE_LIMIT_DELAY`) |
| **Retry behavior** | No retry on page fetch; breaks on error |
| **Checkpoint behavior** | `VestnikSyncCheckpoint` table — stores `lastId`, `sinceTimestamp`, `lastRunSuccess` |
| **Estimated throughput** | ~50 pages/min (1200ms delay), ~100 events/page → ~5000 events/min |
| **Known failure modes** | API timeout, HTTP error, page limit (cron: 50 pages max) |
| **Current state** | **Checkpoint table EMPTY** — backfill has NEVER been run. `vestnikSyncedAt` = NULL for all 518,800 companies. |

**Critical gap:** The backfill fetches events and matches to companies, but **does NOT set `vestnikSyncedAt` on Company records**. After backfill, companies without events still have `vestnikSyncedAt = NULL`. This means `vestnikClean` filter returns 0 results even after backfill.

**Critical gap 2:** **Vestník → legalStatus derivation is NOT implemented.** The frozen contract defines:
```
Vestník konkurz → BANKRUPT (only if legalStatusSource = NONE)
Vestník reštrukt. → RESTRUCTURING (only if legalStatusSource = NONE)
Vestník likvidácia → LIQUIDATION (only if legalStatusSource = NONE)
```
But no code implements this. The 725 companies with legalStatus all got it from ORSR.

---

### Source 2: ORSR

| Field | Value |
|-------|-------|
| **Existing job/script** | `worker/src/bulk_seed_orsr.py` (bulk), `frontend/src/lib/orsr.ts` (on-demand) |
| **Input** | `https://www.orsr.sk/hladaj_ico.asp` + `https://www.orsr.sk/vypis.asp` |
| **Output** | Company fields + CompanyPerson records |
| **DB fields written (bulk_seed_orsr.py)** | `orsrSyncedAt`, `shareCapital`, `signingAuthority`, `businessActivity`, CompanyPerson records |
| **DB fields written (frontend orsr.ts)** | Same + `legalStatus`, `legalStatusSource=ORSR`, `legalStatusObservedAt`, `name`, `legalForm`, `city`, `street`, `zipCode`, `establishedAt` |
| **Rate limit** | 300ms delay between requests (`_DELAY_BETWEEN_REQUESTS`) |
| **Retry behavior** | 3 attempts with 2s * attempt backoff |
| **Checkpoint behavior** | JSON file: `output/orsr_seed_checkpoint.json` |
| **Estimated throughput** | concurrency=5, 0.3s delay → ~10 companies/min → 515K in ~858 hours (36 days) |
| **Known failure modes** | ORSR timeout, IČO not found, outdated extract, transferred to another court |
| **Current state** | 726 companies have `orsrSyncedAt`. Bulk script exists but has only been run for ~726 companies. |

**Critical gap:** `bulk_seed_orsr.py` does NOT set `legalStatus` or `legalStatusSource`. Only `frontend/src/lib/orsr.ts` (on-demand) does. The 725 companies with `legalStatusSource=ORSR` were seeded on-demand, not via bulk.

**Eligible legal forms:** s.r.o. (501,290) + a.s. (12,663) + v.o.s. (1,943) + k.s. (0) = 515,896 companies. Other forms (družstvá, štátne podniky, etc.) are NOT in ORSR.

**Throughput concern:** At 10 companies/min, 515K companies would take ~36 days. This is too slow for a single run. Need higher concurrency or a different approach.

---

### Source 3: RÚZ (verification + financials)

| Field | Value |
|-------|-------|
| **Existing job/script** | `frontend/src/scripts/seed-ruz-verification-bulk.ts` (verification), `frontend/src/scripts/seed-financials-bulk.ts` (financials), `frontend/src/lib/ruz.ts` (on-demand) |
| **Input** | `https://www.registeruz.sk/cruz-public/api/` |
| **Output** | Company fields + FinancialStatement records |
| **DB fields written (verification)** | `ruzEntityId`, `ruzSyncedAt`, `ruzReportingStatus`, `ruzDissolutionDate`, `naceCode`, `naceText`, `sizeCategory`, `sizeCategoryNormalized`, `employeeCount`, `kraj`, `okres`, `ownershipType` |
| **DB fields written (financials)** | `latestYear`, `latestRevenue`, `latestProfit`, `latestAssets`, `latestEquity`, `FinancialStatement` records |
| **Rate limit** | 200ms delay (`REQUEST_DELAY_MS`), exponential backoff on 429/503 |
| **Retry behavior** | 5 retries with exponential backoff (2s * 2^attempt, max 60s) |
| **Checkpoint behavior** | JSON files: `seed-ruz-bulk-checkpoint.json`, `seed-financials-bulk-checkpoint.json` |
| **Estimated throughput** | concurrency=10, 200ms delay → ~80 companies/min → 404K in ~84 hours |
| **Known failure modes** | API 429 (rate limit), 503 (unavailable), 404 (entity not found) |
| **Current state** | 501,762 have `ruzEntityId`, 491,234 have `ruzSyncedAt`, 298,921 have `latestYear` |

**Financial parsing gap:** 105,870 companies have `ruzReportingStatus=VERIFIED` (RÚZ confirms filings exist) but `latestYear = NULL` (filings not parsed). This is the `hasFinancials=no` population.

---

### Source 4: RPO (company base data)

| Field | Value |
|-------|-------|
| **Existing job/script** | `frontend/src/scripts/seed-rpo-dump.ts` |
| **Input** | RPO dump (CSV/data file) |
| **Output** | Company base records (ico, name, legalForm, city, etc.) |
| **Current state** | 518,800 companies in DB. This is the foundational data source. |

---

### Cron Jobs (vercel.json)

| Path | Schedule | Purpose |
|------|----------|---------|
| `/api/reports/recover-stuck` | `0 4 * * *` | Recover stuck PROCESSING reports |
| `/api/cron/vestnik-ingest` | `0 5 * * *` | Daily Vestník ingestion (requires valid checkpoint) |

**Note:** Vestník cron has NEVER run successfully because no checkpoint exists (backfill never executed).

---

### Summary of Gaps

1. **Vestník backfill has never been run** — checkpoint empty, vestnikSyncedAt=0 for all
2. **Vestník backfill doesn't set vestnikSyncedAt** — architectural gap in the script
3. **Vestník → legalStatus derivation not implemented** — contract defines it, no code
4. **ORSR bulk seed doesn't set legalStatus** — only on-demand orsr.ts does
5. **ORSR throughput too slow** — 36 days for 515K companies at current settings
6. **Financial parsing backlog** — 105,870 companies with VERIFIED but no parsed data
