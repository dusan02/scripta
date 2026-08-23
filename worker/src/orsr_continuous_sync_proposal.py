# ORSR Continuous Sync Architecture — Proposal

## Context

After the initial full ORSR V2 backfill (~502k companies, ~5-6 days), we need a
mechanism to keep ORSR data fresh. Companies change status (ACTIVE → LIQUIDATION
→ DISSOLVED), persons change, share capital changes. New companies are registered.

This document proposes a continuous sync architecture that runs alongside the
existing worker infrastructure without disrupting the screener or scoring engine.

---

## Problem Statement

### What the initial backfill solves
- One-time enrichment of ~502k eligible companies with ORSR data
- shareCapital, signingAuthority, businessActivity, CompanyPerson, legalStatus

### What it does NOT solve
- **New companies**: Registered after the backfill cursor passed their ICO
- **Status changes**: Company goes into liquidation after initial sync
- **Person changes**: New konateľ appointed, old one removed
- **Dissolution**: Company dissolved from ORSR after initial sync

### Staleness budget
- ORSR data is legally authoritative but not real-time
- ORSR updates within days of a court decision
- A 30-day refresh cycle is acceptable for screener purposes
- A 7-day refresh cycle is ideal for legal status accuracy

---

## Architecture

### Two sync modes

```
┌─────────────────────────────────────────────────────────────┐
│                    ORSR Sync System                          │
│                                                              │
│  ┌─────────────────┐    ┌──────────────────────────────────┐│
│  │  Initial Backfill│    │  Continuous Sync (cron)          ││
│  │  (one-time)      │    │                                  ││
│  │                  │    │  Mode A: New companies           ││
│  │  bulk_seed_orsr  │    │  → ico > last_backfill_ico       ││
│  │  _v2.py          │    │  → WHERE orsrSyncedAt IS NULL    ││
│  │                  │    │  → Small batches, daily          ││
│  │  Status: RUNNING │    │                                  ││
│  │                  │    │  Mode B: Refresh existing        ││
│  └─────────────────┘    │  → WHERE orsrSyncedAt < NOW() - X ││
│                          │  → Re-scrape, compare, update    ││
│                          │  → Weekly cycle                   ││
│                          └──────────────────────────────────┘
└─────────────────────────────────────────────────────────────┘
```

### Mode A: New Company Sync (daily)

**Trigger**: Daily cron (e.g., 03:00 CET)
**Volume**: ~50-200 new companies/day (estimate based on SR registration rate)
**Duration**: ~2-5 minutes

```sql
-- New companies: registered after backfill cursor, not yet synced
SELECT ico, name FROM "Company"
WHERE "orsrSyncedAt" IS NULL
  AND "legalForm" = ANY($1)
  AND ico > $2  -- last_backfill_ico from checkpoint
ORDER BY ico ASC
LIMIT 500
```

**Implementation**: Reuse `bulk_seed_orsr_v2.py --resume` with `--max 500`.
The cursor naturally picks up new companies because they have `orsrSyncedAt IS NULL`.

**Key insight**: The initial backfill's cursor-based design already handles this.
Once the backfill completes, `--resume --max 500` in daily cron will:
1. Fetch unsynced companies (new registrations)
2. Process them with the same lock + transaction + retry logic
3. Advance the checkpoint

### Mode B: Refresh Existing (weekly)

**Trigger**: Weekly cron (e.g., Sunday 02:00 CET)
**Volume**: ~502k companies / 7 days = ~71k/day, ~5k/hour
**Duration**: ~12 hours per weekly cycle (at ~110/min read-only speed)

```sql
-- Companies synced > 7 days ago, eligible for refresh
SELECT ico, name FROM "Company"
WHERE "orsrSyncedAt" IS NOT NULL
  AND "legalForm" = ANY($1)
  AND "orsrSyncedAt" < NOW() - INTERVAL '7 days'
ORDER BY "orsrSyncedAt" ASC  -- Oldest first (FIFO refresh)
LIMIT 5000
```

**Implementation**: New script `orsr_refresh_sync.py`:

```python
# Pseudocode
async def refresh_batch():
    companies = await get_stale_companies(days=7, limit=5000)
    for company in companies:
        old_data = await fetch_current_db_state(company.ico)
        new_data = await scraper.run(ico=company.ico, skip_pdf=True, ...)
        if has_changes(old_data, new_data):
            async with db.tx() as tx:
                await update_company(tx, company.ico, new_data)
                await update_persons(tx, company.ico, new_data.persons)
            log_change(company.ico, old_data, new_data)  # audit trail
```

**Change detection** (avoid unnecessary DB writes):
```python
def has_changes(old: dict, new: ScrapedSource) -> bool:
    return (
        old["legalStatus"] != derive_legal_status(new.findings)
        or old["shareCapital"] != new.share_capital
        or old["signingAuthority"] != new.signing_authority
        or old["businessActivity"] != new.business_activity
        or persons_changed(old["persons"], new.persons)
    )
```

---

## Component Design

### 1. orsr_sync_cron.py (orchestrator)

```
┌──────────────────────────────────────────────┐
│  orsr_sync_cron.py                           │
│                                              │
│  1. Check if initial backfill is complete    │
│     (checkpoint processed >= eligible count) │
│                                              │
│  2. If backfill running → skip (lock held)   │
│                                              │
│  3. Mode A (daily):                          │
│     - Run --resume --max 500                 │
│     - Picks up new registrations             │
│                                              │
│  4. Mode B (weekly, Sunday only):            │
│     - Run refresh_sync for 5000 stale        │
│     - FIFO: oldest orsrSyncedAt first        │
│     - Change detection → update only changed │
│                                              │
│  5. Report: processed/refreshed/skipped      │
│     → log file + optional Slack webhook      │
└──────────────────────────────────────────────┘
```

### 2. orsr_refresh_sync.py (Mode B implementation)

```python
"""
ORSR Refresh Sync — re-scrape existing companies to detect changes.

Unlike bulk_seed_orsr_v2.py (which only processes unsynced companies),
this script re-scrapes already-synced companies and updates only
fields that have changed.

Key differences from V2 backfill:
  - Fetches WHERE orsrSyncedAt < NOW() - INTERVAL '7 days' (stale, not unsynced)
  - Compares old vs new before writing (avoids unnecessary DB writes)
  - Logs changes to audit table (CompanyOrsrChangeLog)
  - Uses same lock + transaction + retry as V2
  - Does NOT advance the V2 backfill checkpoint (separate checkpoint)
"""
```

### 3. Audit trail (optional but recommended)

```sql
CREATE TABLE "CompanyOrsrChangeLog" (
    id           String   @id @default(uuid())
    companyIco   String
    field        String   -- 'legalStatus' | 'shareCapital' | 'persons' | ...
    oldValue     String?
    newValue     String?
    detectedAt   DateTime @default(now())

    @@index([companyIco])
    @@index([detectedAt])
);
```

This allows:
- Tracking when a company entered liquidation
- Historical analysis of person changes
- Audit trail for legal status transitions

---

## Integration with Existing Infrastructure

### ARQ Worker (existing)

```python
# worker/src/tasks.py (or equivalent)
async def orsr_daily_sync(ctx):
    """Daily cron: sync new ORSR registrations."""
    # Check lock — skip if backfill is running
    # Run bulk_seed_orsr_v2 --resume --max 500
    # Report results

async def orsr_weekly_refresh(ctx):
    """Weekly cron: refresh stale ORSR data."""
    # Check lock — skip if backfill is running
    # Run orsr_refresh_sync for 5000 oldest companies
    # Report results
```

### Cron schedule

```python
# Daily new-company sync: 03:00 CET
cron_triggers = {
    "orsr_daily_sync": "0 3 * * *",
    "orsr_weekly_refresh": "0 2 * * 0",  # Sunday 02:00
}
```

### Lock coordination

Both the initial backfill and continuous sync use the same `flock` on
`output/orsr_v2.lock`. This ensures:
- Only one ORSR process runs at a time
- Daily sync skips if backfill is still running
- Weekly refresh skips if daily sync is running

---

## Staleness Model — Source-Specific Freshness Contracts

**IMPORTANT:** Freshness thresholds are NOT hardcoded business rules. They are
source-specific contracts that must be defined per data source and reviewed
separately. ORSR freshness ≠ Vestník freshness ≠ RÚZ freshness.

**CRITICAL INVARIANT:** Freshness MUST NOT automatically change `legalStatus`.
`legalStatus` is a truth value derived from source data, not a freshness signal.
A stale ORSR record does not mean the company is dissolved — it means we haven't
re-verified recently. These are orthogonal concerns.

### Source-specific freshness contracts (PROPOSED — not locked)

Each source has its own freshness contract with three tiers:

```
ORSR (legal registry — updates within days of court decision):
  T + 7 days:  eligible for refresh (Mode B)
  T + 14 days: "stale" indicator in UI (informational)
  T + 30 days: confidence signal degraded (NOT legalStatus change)

Vestník (event feed — 365-day lookback, daily cron):
  T + 1 day:   eligible for refresh (daily cron)
  T + 7 days:  "stale" indicator in UI
  T + 30 days: confidence signal degraded
  NOTE: Vestník freshness is about lookback window coverage, not per-company sync

RÚZ (financial statements — annual filings):
  T + 90 days: eligible for refresh (quarterly cycle)
  T + 180 days: "stale" indicator in UI
  T + 365 days: confidence signal degraded
  NOTE: Financial data is annual, so freshness budget is much longer
```

### What freshness DOES affect

```
✅ Confidence signal (how reliably we know the data)
✅ UI staleness indicator (informational, user-facing)
✅ Refresh priority (which companies to re-scrape first)

❌ legalStatus (truth value — only changed by source data)
❌ Score (frozen v3 — score reflects what we know, not when we checked)
❌ Data quality status (separate axis)
```

### New company registration

```
New company registered at time T
  ↓
T + 1 day: picked up by Mode A (daily sync)
  ↓
T + 2 days: fully synced with ORSR data
```

### Scoring impact — FUTURE, NOT LOCKED

The scoring engine (v3, FROZEN) may eventually receive a `dataFreshness` signal,
but this is a **future enhancement** that requires:

1. Source-specific freshness contract finalized (per source)
2. Confidence model updated (separate from score)
3. Population audit to verify no score distribution shift
4. Adversarial audit to verify no legalStatus contamination

Until then, freshness is informational only — UI indicator + refresh priority.

---

## Resource Budget

### Daily sync (Mode A)
```
Companies:    ~50-200/day
HTTP requests: ~100-400 (2 per company)
Duration:     ~1-5 minutes
RAM:          ~50 MB (small batch)
DB writes:    ~50-200 transactions
```

### Weekly refresh (Mode B)
```
Companies:    ~5,000 per run (71k/week in 14 runs)
HTTP requests: ~10,000 (2 per company)
Duration:     ~45 minutes (at 110/min)
RAM:          ~100 MB
DB writes:    ~500-2,000 (only changed companies)
```

### Total weekly overhead
```
~14 daily syncs:     ~700 companies, ~20 minutes
~1 weekly refresh:   ~5,000 companies, ~45 minutes
Total:               ~5,700 companies/week, ~1 hour
```

This is <1% of the initial backfill cost, sustainable indefinitely.

---

## Failure Modes & Recovery

| Failure | Impact | Recovery |
|---|---|---|
| ORSR down | Daily/weekly sync fails | Retry next cycle; data goes stale |
| Lock held by backfill | Daily sync skips | Correct behavior; backfill has priority |
| DB transaction fails | Company not updated | Retry next cycle; no data corruption |
| Scraper timeout | Company skipped | Added to failed_icos; retried with --retry-failed |
| Partial refresh | Some companies updated, some not | Each company is atomic (transaction); no partials |

---

## Implementation Roadmap

### Phase 1: After initial backfill completes
1. **orsr_daily_sync** — cron job using existing `bulk_seed_orsr_v2.py --resume --max 500`
2. Monitor for 1 week — verify new companies are picked up

### Phase 2: After daily sync is stable
3. **orsr_refresh_sync.py** — Mode B implementation
4. **CompanyOrsrChangeLog** table — audit trail
5. Weekly cron — refresh 5000 oldest companies

### Phase 3: Future enhancements
6. **dataFreshness** signal in scoring engine
7. **Slack/email alerts** for sync failures
8. **Dashboard** — ORSR coverage, staleness distribution, change rate

---

## Open Questions

1. **Refresh interval**: Source-specific contracts proposed above, but NOT locked.
   - ORSR: 7/14/30 days (proposed)
   - Vestník: 1/7/30 days (proposed)
   - RÚZ: 90/180/365 days (proposed)
   - Each contract must be reviewed and finalized separately before implementation

2. **Freshness vs legalStatus separation**: CONFIRMED as invariant.
   - Freshness affects confidence + UI + refresh priority only
   - legalStatus is changed ONLY by source data (ORSR/Vestník), never by age
   - This must be covered by an adversarial test

3. **Change log retention**: How long to keep CompanyOrsrChangeLog records?
   - Recommendation: 2 years (regulatory audit period)

4. **Rate limiting**: Should we add explicit ORSR rate limiting beyond concurrency=5?
   - Current: concurrency=5, ~0.3s delay between companies
   - Read-only benchmark shows ORSR handles concurrency=8 without throttling
   - Recommendation: concurrency=6 for continuous sync (good throughput/stability ratio)
   - Live backfill stays at concurrency=5 (stability priority)

5. **Parallel sources**: Should ORSR refresh be coordinated with Vestník refresh?
   - Vestník has its own cron (daily, 365-day lookback)
   - No coordination needed — they operate on different data
   - legalStatusSource precedence (ORSR > Vestník > RÚZ) is handled at read time
   - Each source has its own freshness contract (see above)

6. **Full backfill as recovery phase**: The initial backfill is a one-time recovery
   operation. Continuous sync is the steady-state architecture that makes Verifa
   a living dataset. The backfill → continuous sync transition is the critical
   milestone.
