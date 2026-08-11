# P4.2 Paid Report Reliability Audit

**Date:** 2026-08-11  
**Status:** AUDIT COMPLETE — 5 P0/P1 issues found, 3 OK

---

## P4.2.1 — PARTIAL / Refund Policy 🔴

### Current behavior

**Status determination** (`worker/src/main.py:125-136`):

```python
def _determine_final_status(sources) -> str:
    if not sources:
        return "FAILED"
    any_unavailable = any(s.status == "UNAVAILABLE" for s in sources)
    any_failed = any(s.status == "FAILED" for s in sources)
    all_success = all(s.status == "SUCCESS" for s in sources)
    if all_success:
        return "COMPLETED"
    if any_unavailable or any_failed:
        return "PARTIAL"
    return "FAILED"
```

**Binary logic:** ALL sources SUCCESS → COMPLETED. ANY non-SUCCESS → PARTIAL. No sources → FAILED.

**There is no FAILED-by-partial threshold.** A report with 1/26 sources OK and 25/26 failed is still PARTIAL, not FAILED.

### Credit/refund flow

| Outcome | Status | Credits charged | Refund? |
|---------|--------|:-:|:-:|
| 26/26 OK | COMPLETED | 1 credit | ❌ No |
| 25/26 OK | PARTIAL | 1 credit | ❌ No |
| 20/26 OK | PARTIAL | 1 credit | ❌ No |
| 13/26 OK | PARTIAL | 1 credit | ❌ No |
| 5/26 OK | PARTIAL | 1 credit | ❌ No |
| 1/26 OK | PARTIAL | 1 credit | ❌ No |
| 0/26 OK | PARTIAL | 1 credit | ❌ No |
| Worker crash | FAILED | 1 credit | ✅ Yes (1 credit) |
| S3 upload fail | FAILED | 1 credit | ✅ Yes (1 credit) |

**🔴 P0 ISSUE: User pays full price for PARTIAL report regardless of how many sources failed.** A report with 1/26 sources succeeding costs the same as 26/26.

### Refund mechanism

**Three refund paths exist:**

1. **Worker → Frontend callback** (`main.py:638-650`): Worker POSTs to `/api/reports/{id}/refund` with `x-worker-secret`. Only triggers if `final_status == "FAILED"`.
2. **Worker exception path** (`main.py:679-690`): Same callback on unhandled exception.
3. **Frontend cron fallback** (`/api/reports/recover-stuck/route.ts`): Runs every 15 min, catches stuck PROCESSING + missed FAILED refunds.

**Refund idempotency:** ✅ GOOD — `refundCreditsTx` checks for existing REFUND transaction before processing (`credits.ts:234-238`). DB has `@@unique([reportRequestId, type])` on WalletTransaction preventing duplicate CHARGE/REFUND.

**🔴 P1 ISSUE: No partial refund mechanism exists.** The system is binary: full refund or no refund. There is no "50% refund for PARTIAL with <50% sources" logic.

### Recommended fix

```
COMPLETED           → 90-100% sources OK    → 100% charge, no refund
COMPLETED_WITH_WARNINGS → 75-89% + no critical failures → 100% charge, no refund
PARTIAL             → 50-74% or critical source failed → 50% refund
FAILED              → <50% sources OK       → 100% refund
```

**Critical source override:** If ORSR, RÚZ, Vestník, INSOLVENCY, or POVERENIA fails → automatic downgrade to PARTIAL regardless of overall %.

---

## P4.2.2 — Source Criticality

### Current state

**No source criticality classification exists.** All 26+ sources are treated equally in `_determine_final_status`. A failure of CRZ (contracts register) has the same weight as a failure of ORSR (company registry).

### Proposed categorization

| Tier | Sources | Rationale |
|------|---------|-----------|
| **Critical** | ORSR, REGISTER_UZ, OBCHODNY_VESTNIK, INSOLVENCY, POVERENIA | Core legal & financial identity. Without these, report is not due diligence. |
| **Important** | FINANCNA_SPRAVA, FS_DANOVE_SUBJEKTY, FS_DPH_REGISTROVANI, FS_DPH_RUSENIE, FS_DAN_Z_PRIJMOV, ROZHODNUTIA, DISKVALIFIKACIE, SP_DLZNICI, VSZP_DLZNICI, DOVERA_DLZNICI, UNION_DLZNICI, CRZ, UVO | Tax, debt, court, procurement data. Significant for risk assessment. |
| **Supplementary** | ZRSR, RPO, RPVS, NCRZP, NCRD, FS_DPH_VYMAZANI, FS_DPH_NADMERNY_ODPOCET, FS_DAN_PRIJMOV_REG, FS_DPH_BANKOVE_UCTY | Additional context. Missing these doesn't invalidate the report. |

**🔴 P1 ISSUE: A report with ORSR failed but 25/26 supplementary sources OK is marked PARTIAL (92% coverage) — but it's fundamentally broken.** Without ORSR there is no company name, address, legal form, persons, or ownership data.

### Current source list (from Prisma enum)

29 SourceType values registered. The scraper registry has 26 active scrapers. Sources like CRRS, OCHRANNE_ZNAMKY, FS_DPH_BANKOVE_UCTY have no scraper implementation.

---

## P4.2.3 — Completeness Display in PDF

### Current state

**The PDF cover page shows source status via semaphores** (grouped by category in `report_generator.py:1792-1803`). Sources are grouped into:
- `cat_basic_registries` — ORSR, ZRSR, REGISTER_UZ, OBCHODNY_VESTNIK, RPO, RPVS
- `cat_insolvency_debts` — INSOLVENCY, POVERENIA, FINANCNA_SPRAVA, SP/VSZP/DOVERA/UNION_DLZNICI
- `cat_financial_tax` — FS_DANOVE_SUBJEKTY, FS_DPH_*, FS_DAN_*
- (other categories for remaining sources)

**🟠 P2 ISSUE: No overall completeness percentage is displayed.** The user sees individual source semaphores but not a summary like "Úplnosť preverenia: 92% (24/26 zdrojov)".

**🟠 P2 ISSUE: No "not included" indicator for sources without scrapers.** CRRS, OCHRANNE_ZNAMKY, FS_DPH_BANKOVE_UCTY are registered as SourceType but have no scraper. The user doesn't know these were never checked.

### What exists

- Individual source status (SUCCESS/FAILED/UNAVAILABLE) is stored in `ReportSource` table
- Cover page shows per-source semaphores (✅/❌/⚠️)
- `generated_at` timestamp is on the cover page
- No aggregate completeness metric

### Recommended addition

Add to cover page:
```
Úplnosť preverenia: 92% (24 z 26 zdrojov úspešne overených)
```
Plus a "CRE: ⚪ Nie je súčasťou preverenia" row for sources without scrapers.

---

## P4.2.4 — Cached Reports

### Current state

**There is NO report caching mechanism.** Every report request creates a new `ReportRequest` and charges 1 credit.

**Deduplication exists** (`/api/reports/route.ts:167-187`): If the same user requests the same IČO within 2 minutes while a PENDING/PROCESSING report exists, the existing request is returned without charging again. This prevents double-clicks only.

**No 90-day cache.** If a user requests a report for IČO X today, and another user requests IČO X tomorrow, both pay 1 credit and both trigger full scraping. There is no shared cache.

### What happens on re-request

| Scenario | Behavior |
|----------|----------|
| Same user, same IČO, within 2 min, PENDING/PROCESSING | Return existing request, no charge |
| Same user, same IČO, after 2 min, COMPLETED | New request, new charge, full re-scrape |
| Different user, same IČO | New request, new charge, full re-scrape |
| Same user, same IČO, previous FAILED | New request, new charge, full re-scrape |

**🟢 OK for due-diligence product:** No stale reports sold as fresh. Each report is a real-time scrape.

**🟠 P2 OBSERVATION:** The `completedAt` timestamp is stored in DB but NOT displayed on the PDF cover page. The cover page shows `generated_at` (generation timestamp), which IS the correct verification date. This is acceptable.

**🟠 P2 ISSUE: No "new events since last report" detection.** If a company had a konkurz filed between two reports, the user has no way to know without buying a new report. Consider an alert/subscription model (separate feature).

---

## P4.2.5 — FAILED / Refund Flow

### Current state

**Refund paths:**

1. **Normal FAILED** (`main.py:610-650`):
   - `_determine_final_status` returns FAILED → worker calls `/api/reports/{id}/refund`
   - Refund route checks `report.status !== "FAILED"` → rejects if not FAILED
   - `refundCredits` called with amount=1

2. **Exception path** (`main.py:671-691`):
   - Unhandled exception → `update_report_status(FAILED)` → same refund callback

3. **ARQ retry exhaustion** (`worker_arq.py:102-117`):
   - After MAX_TRIES (3), marks report as FAILED in DB
   - **🔴 P1 ISSUE: ARQ retry path does NOT call the refund endpoint.** It only updates DB status to FAILED. The refund relies on the frontend cron `/api/reports/recover-stuck` to catch this.

4. **Frontend cron** (`/api/reports/recover-stuck/route.ts`):
   - Runs every 15 min
   - Catches stuck PROCESSING > 30 min → FAILED + refund
   - Catches FAILED reports without REFUND transaction (last 24h) → refund

### Double-refund protection

| Layer | Protection |
|-------|-----------|
| Refund route | Checks `report.status !== "FAILED"` → 422 |
| `refundCreditsTx` | Checks for existing REFUND transaction → returns silently |
| DB constraint | `@@unique([reportRequestId, type])` on WalletTransaction |

**🟢 OK: Double-refund is prevented at 3 layers.** The DB unique constraint is the strongest guarantee.

### Retry → double-refund risk

**Scenario:** Worker fails, ARQ retries, retry also fails.

1. Attempt 1: Exception → `update_report_status(FAILED)` → refund callback → ✅ refund processed
2. ARQ retries (attempt 2): `_execute_report_inner` runs again → succeeds → `update_report_status(COMPLETED)` → no refund
3. OR: Attempt 2 also fails → exception → refund callback → `refundCreditsTx` finds existing REFUND → returns silently ✅

**🟢 OK: Retry cannot cause double-refund.** The idempotency check in `refundCreditsTx` prevents it.

**🟠 P2 EDGE CASE:** If attempt 1 fails and marks FAILED + refunds, then ARQ retries and attempt 2 SUCCEEDS, the report ends up as COMPLETED with a refund. The user got a free report. This is a revenue leak, not a double-refund. The refund route checks `report.status !== "FAILED"` — but the status may have been updated to COMPLETED by attempt 2 before the refund callback from attempt 1 arrives. In that case, the refund is rejected (422) and the user is charged for a successful report. **This is actually correct behavior.**

---

## P4.2.6 — Report Retention

### Current state

**Cleanup config** (`worker/src/config.py:19-23`):
```python
cleanup_max_age_days: int = 30
cleanup_max_reports_per_user: int = 50
cleanup_interval_hours: int = 1
stale_report_threshold_minutes: int = 20
```

**What gets deleted** (`worker/src/cleanup.py:23-75`):

`cleanup_old_reports()`:
- Finds all `ReportRequest` records with `createdAt < now - 30 days`
- **Deletes the entire ReportRequest from DB** (cascade deletes ReportSource)
- Deletes S3 object if `resultFilePath` is an S3 key
- Deletes local report directory

`cleanup_excess_reports()`:
- Per-user limit of 50 completed/partial reports
- Oldest excess reports deleted (same full deletion)

**🔴 P0 ISSUE: The entire report is deleted after 30 days — including the DB record, the PDF in S3, and all source data.** The user loses access to their purchased report entirely.

### What should happen

| Component | Current retention | Recommended |
|-----------|:-:|:-:|
| ReportRequest DB record | 30 days → hard delete | **Permanent** (or minimum 1 year) |
| Evidence binder PDF (S3) | 30 days → delete | **Permanent** (or minimum 1 year) |
| Source PDFs (individual scraper outputs) | Deleted during compile | OK (intermediate artifacts) |
| Debug screenshots | Deleted during compile | Ok |
| Worker temp directories | Deleted during compile | OK |

**The report PDF and DB record should be retained. Only intermediate artifacts should be cleaned up.**

### Impact

A user who buys a report on day 1 cannot download it after day 30. For a due-diligence product, this is unacceptable — the user may need to reference the report months later.

---

## Summary of Issues

### 🔴 P0 — Must fix before paid launch

| # | Issue | File | Impact |
|---|-------|------|--------|
| 1 | **No partial refund for PARTIAL reports** | `main.py:625-628` | User pays full price for 1/26 sources |
| 2 | **Entire report deleted after 30 days** | `cleanup.py:47` | User loses purchased report |

### 🟠 P1 — Should fix before paid launch

| # | Issue | File | Impact |
|---|-------|------|--------|
| 3 | **No source criticality weighting** | `main.py:125-136` | ORSR failure = CRZ failure in status logic |
| 4 | **No completeness % on PDF cover** | `report_generator.py` | User can't see coverage at a glance |
| 5 | **ARQ retry path doesn't call refund** | `worker_arq.py:102-117` | Relies on cron fallback (15 min delay) |

### 🟢 OK — No action needed

| Area | Status |
|------|--------|
| Double-refund prevention | ✅ 3-layer idempotency |
| Retry → double-refund | ✅ Cannot happen |
| Stale report recovery | ✅ Cron catches missed refunds |
| No stale cache sold as fresh | ✅ Every report is real-time scrape |
| Deduplication (double-click) | ✅ 2-min window |
| Credit atomicity | ✅ DB transaction with pessimistic lock |

---

## Recommended Implementation Order

1. **P0-2: Retention fix** — Change `cleanup.py` to only delete intermediate artifacts, not ReportRequest records or S3 PDFs. Simplest fix.

2. **P0-1: Partial refund policy** — Implement source criticality tiers + threshold-based refund in `_determine_final_status` and refund logic.

3. **P1-3: Source criticality** — Add `CRITICAL` / `IMPORTANT` / `SUPPLEMENTARY` classification. If any CRITICAL source fails → automatic PARTIAL + warning.

4. **P1-4: Completeness display** — Add aggregate "Úplnosť preverenia: X%" to PDF cover page.

5. **P1-5: ARQ refund** — Add refund callback in `worker_arq.py` retry exhaustion path.
