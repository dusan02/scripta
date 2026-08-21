# Domain Contract: Multi-Axis Company Status Model

**Status:** DRAFT — pending review
**Date:** 2026-08-23
**Author:** Devin (per Architect → Reviewer → Executor process)

---

## 1. Problem Statement

Current `Company.status` is a single string field mixing three orthogonal concepts:

1. **Legal status** (active / in liquidation / bankrupt / dissolved) — from ORSR, Vestník, RÚZ
2. **RÚZ reporting presence** (has accounting filings) — from RÚZ API
3. **Seed provenance** (which script created the row) — implicit in value

Values in production DB today:

| Value | Count | Source | Actual meaning |
|-------|-------|--------|----------------|
| `ruz_active` | 404 374 | `seed-ruz-verification-bulk.ts` | Has ≥1 accounting filing in RÚZ |
| `ruz_checked` | 86 441 | `seed-ruz-verification-bulk.ts` | Exists in RÚZ, no filings |
| `active` | 27 975 | `ruz.ts` + `seed-rpo-dump.ts` | Hardcoded at seed time (no verification) |
| `ACTIVE` | 6 | `orsr.ts` | ORSR extract says "Aktívna" |
| `""` | 5 | RPO dump | Missing |

**Key insight:** `ruz_active` means "has filed accounts", NOT "is legally active". A company with last filing 2021 can be dissolved today. Mixing these is a category error for a due-diligence product.

---

## 2. Proposed Model: Four Orthogonal Axes

### Axis 1: `legalStatus`

**Definition:** Current legal standing of the company per official registers.

```
enum LegalStatus:
  ACTIVE       — Company is registered and not in any insolvency/dissolution proceeding
  LIQUIDATION  — Company is in liquidation (ORSR: "v likvidácii")
  BANKRUPT     — Company is in bankruptcy proceedings (Vestník: konkurz)
  RESTRUCTURING — Company is in restructuring (Vestník: reštrukturalizácia)
  DISSOLVED    — Company has been dissolved/removed from register (ORSR: "vymazaná" / RÚZ: datumZrusenia)
  UNKNOWN      — No authoritative source has been checked
```

**Source precedence (highest → lowest):**

```
1. ORSR (orsrSyncedAt != null)
   → "v likvidácii"      → LIQUIDATION
   → "vymazaná"           → DISSOLVED
   → otherwise            → ACTIVE

2. Vestník (vestnikSyncedAt != null, has events)
   → eventType konkurz    → BANKRUPT
   → eventType reštrukt.  → RESTRUCTURING
   → eventType likvidácia → LIQUIDATION
   (only if ORSR didn't already set a more specific status)

3. RÚZ (ruzSyncedAt != null) — FALLBACK ONLY, never overrides ORSR
   → datumZrusenia != null → DISSOLVED  (only if ORSR not checked)
   → otherwise             → (no legal status claim — RÚZ doesn't certify legal activity)

4. None checked
   → UNKNOWN
```

**Conflict resolution rules (explicit):**

```
ORSR = DISSOLVED                    → DISSOLVED (final, no override)
ORSR = ACTIVE + Vestník konkurz     → ACTIVE (ORSR wins for legalStatus)
                                      + hasVestnikEvent = true (separate flag)
ORSR = ACTIVE + RÚZ datumZrusenia   → ACTIVE (ORSR wins, RÚZ never overrides)
ORSR not checked + RÚZ datumZrusenia → DISSOLVED (RÚZ fallback)
ORSR not checked + Vestník konkurz  → BANKRUPT
ORSR not checked + nothing          → UNKNOWN
```

**Critical principle — absence of evidence ≠ evidence of absence:**

```
No bankruptcy evidence found  ≠  "Not bankrupt"
No liquidation evidence found ≠  "Not in liquidation"

If no source has been checked → legalStatus = UNKNOWN (never ACTIVE by default)
```

This is the same philosophy as `vestnikClean`: missing data must not be interpreted as a positive finding.

**Staleness — freshness is separate from truth value:**

`legalStatus` is NOT degraded to UNKNOWN based on age. A company verified as ACTIVE 91 days ago is still ACTIVE — just with lower freshness.

```
legalStatus         = ACTIVE (last known, preserved)
legalStatusSource   = ORSR
legalStatusObservedAt = 2026-05-20  (when the source was last checked)
```

UI can display: "Active — ORSR verified 91 days ago"

Staleness affects **confidence**, not **truth value**. Degrading to UNKNOWN would create an absurd situation where status flips from ACTIVE to UNKNOWN on day 91 without anything changing in reality.

The screener may optionally offer a `freshOnly` filter param, but the default behavior preserves the last known status.

---

### Axis 2: `ruzReportingStatus`

**Definition:** Whether the company has accounting filings in RÚZ (Register of Accounting Entities).

```
enum RuzReportingStatus:
  VERIFIED    — Company exists in RÚZ and has ≥1 accounting filing
  NOT_FOUND   — Company exists in RÚZ but has 0 filings
  UNKNOWN     — RÚZ has not been checked (ruzSyncedAt = null)
```

**Source:** RÚZ API (`idUctovnychZavierok` array length)

**Important:** This is NOT "is the company active". It is "has the company filed accounts". A dissolved company may still have `VERIFIED` here (it filed before dissolution).

---

### Axis 3: `hasFinancials` (derived, not stored)

**Definition:** Whether we have parsed financial statement data for this company.

```
hasFinancials:
  true    — latestYear != null (at least one FinancialStatement row exists)
  false   — latestYear = null AND ruzReportingStatus = VERIFIED (RÚZ has filings but we didn't parse them)
  unknown — latestYear = null AND ruzReportingStatus != VERIFIED
```

**Note:** This is derived from `latestYear` + `ruzReportingStatus`. No new column needed. The `false` case (RÚZ has filings but we didn't parse) is a data gap worth tracking.

---

### Axis 4: `latestFinancialYear` (already exists)

**Definition:** Year of the most recent parsed financial statement.

Already stored as `Company.latestYear`. No change needed.

---

## 3. Screener Filter Mapping

### `status` filter → `legalStatus`

The screener `status` filter queries `legalStatus`, NOT `ruzReportingStatus`.

```
status=ACTIVE        → legalStatus = ACTIVE
status=LIQUIDATION   → legalStatus = LIQUIDATION
status=BANKRUPT      → legalStatus = BANKRUPT
status=DISSOLVED     → legalStatus = DISSOLVED
status=UNKNOWN       → legalStatus = UNKNOWN
```

**Removed from filter:** ~~`RESTRUCTURING`~~ — **Reinstated**: RESTRUCTURING is a materially different legal state users will want to filter by.

```
status=RESTRUCTURING  → legalStatus = RESTRUCTURING
```

### New filter: `hasFinancials` (FREE)

```
hasFinancials=yes    → latestYear != null
hasFinancials=no     → latestYear = null AND ruzReportingStatus = VERIFIED
hasFinancials=unknown → latestYear = null AND ruzReportingStatus != VERIFIED
```

### New filter: `ruzReporting` (FREE)

```
ruzReporting=verified    → ruzReportingStatus = VERIFIED
ruzReporting=not_found   → ruzReportingStatus = NOT_FOUND
ruzReporting=unknown     → ruzReportingStatus = UNKNOWN
```

---

## 4. Schema Changes

### New columns on `Company`

```prisma
legalStatus             String?    // ACTIVE | LIQUIDATION | BANKRUPT | RESTRUCTURING | DISSOLVED | UNKNOWN
legalStatusSource       String?    // ORSR | VESTNIK | RUZ | NONE — which source set legalStatus
legalStatusObservedAt   DateTime?  // When the source was last checked (for freshness display)
ruzReportingStatus      String?    // VERIFIED | NOT_FOUND | UNKNOWN
```

**Note:** `legalStatusObservedAt` is the timestamp when the source was checked. It is used for UI freshness display ("ORSR verified 91 days ago"), NOT for automatic degradation to UNKNOWN. The truth value of `legalStatus` is preserved regardless of age.

### Deprecated columns (kept for backward compat, NOT dropped in this migration)

```
status              — replaced by legalStatus + ruzReportingStatus
statusNormalized    — replaced by legalStatus
```

**Deprecation timeline:**
- Phase 1: Add new columns, keep old ones, screener uses new columns
- Phase 2: Audit all dependencies (screener, API, UI, scoring, exports, tests) — grep for `status` and `statusNormalized` usage
- Phase 3: Only when grep/tests show zero usage → DROP both columns in a separate migration

### New indexes

```
@@index([legalStatus])
@@index([ruzReportingStatus])
```

---

## 5. Migration Strategy

### Phase 1: Add columns + backfill from existing data

```sql
-- legalStatus: derive from current statusNormalized + ORSR sync state
UPDATE "Company" SET
  legalStatus = CASE
    WHEN "orsrSyncedAt" IS NOT NULL AND status = 'ACTIVE' THEN 'ACTIVE'
    WHEN "orsrSyncedAt" IS NOT NULL AND status = 'LIQUIDATION' THEN 'LIQUIDATION'
    WHEN "orsrSyncedAt" IS NOT NULL AND status = 'DISSOLVED' THEN 'DISSOLVED'
    WHEN statusNormalized = 'ACTIVE' THEN 'ACTIVE'  -- fallback: no ORSR, but was "active"
    ELSE 'UNKNOWN'
  END,
  legalStatusSource = CASE
    WHEN "orsrSyncedAt" IS NOT NULL THEN 'ORSR'
    WHEN statusNormalized = 'ACTIVE' THEN 'NONE'  -- we assumed active without ORSR
    ELSE 'NONE'
  END;

-- ruzReportingStatus: derive from current status values
UPDATE "Company" SET
  ruzReportingStatus = CASE
    WHEN status = 'ruz_active' THEN 'VERIFIED'
    WHEN status = 'ruz_checked' THEN 'NOT_FOUND'
    WHEN status IN ('active', 'ACTIVE') THEN 'UNKNOWN'  -- hardcoded, never checked RÚZ
    ELSE 'UNKNOWN'
  END;
```

### Phase 2: Update seed/sync scripts

- `orsr.ts`: set `legalStatus`, `legalStatusSource = 'ORSR'`, `legalStatusObservedAt = now()`
- `ruz.ts` / `seed-ruz-verification-bulk.ts`: set `ruzReportingStatus`, do NOT set `legalStatus` (RÚZ doesn't certify legal status). Exception: if `datumZrusenia != null` AND `orsrSyncedAt = null`, set `legalStatus = DISSOLVED`, `legalStatusSource = 'RUZ'`
- `seed-rpo-dump.ts`: set `legalStatus = 'UNKNOWN'`, `ruzReportingStatus = 'UNKNOWN'`
- Vestník scraper: set `legalStatus` only if ORSR hasn't been checked (source precedence #2)

### Phase 3: Update screener

- `status` filter → query `legalStatus`
- Add `hasFinancials` and `ruzReporting` filters
- Keep `status` and `statusNormalized` columns (deprecated, not dropped yet)

### Phase 4: Dependency audit + cleanup (separate future migration)

- `grep` codebase for `status` and `statusNormalized` usage
- Verify zero dependencies on old columns
- Only then: DROP both columns in a separate migration

---

## 6. Freshness Model (NOT staleness degradation)

**Principle:** `legalStatus` truth value is preserved regardless of age. Freshness is a separate concern.

| Field | Fresh | Stale | Very stale |
|-------|-------|-------|------------|
| `legalStatus` (ORSR source) | `legalStatusObservedAt` < 30 days | 30-90 days | > 90 days |
| `legalStatus` (Vestník source) | < 30 days | 30-90 days | > 90 days |
| `legalStatus` (RÚZ source) | < 90 days | 90-180 days | > 180 days |
| `ruzReportingStatus` | < 90 days | 90-180 days | > 180 days |

**What happens when data is stale:**

```
legalStatus           = ACTIVE (UNCHANGED — truth value preserved)
legalStatusObservedAt = 2026-05-20 (91 days ago)
```

UI displays: "Active — ORSR verified 91 days ago"

**What does NOT happen:**
- `legalStatus` does NOT flip to UNKNOWN
- No cron job to degrade statuses
- No automatic re-checking

**Optional screener param:** `freshOnly=true` — filters to companies with `legalStatusObservedAt` within freshness threshold. Default: off (returns all, regardless of freshness).

---

## 7. What This Contract Does NOT Define

- **Vestník backfill strategy** — separate task
- **ORSR bulk sync** — separate task (currently only 721 companies ORSR-synced)
- **Konkurz detection in ORSR** — ORSR scraper today only detects likvidácia/vymazaná, not konkurz. Adding konkurz detection is a separate enhancement.
- **UI presentation** — how to display multi-axis status to users is a separate UX decision
- **MATCH/NO_MATCH/UNKNOWN filter semantics** — separate contract covering all filters, not just status

---

## 8. Resolved Questions (Approved by Reviewer)

1. **`RESTRUCTURING` — separate enum value.** ✅ Approved. It is a materially different legal state users will want to filter by. Event flag is preserved separately (`hasVestnikEvent = true`).

2. **RÚZ `datumZrusenia` → `DISSOLVED` — fallback only, never overrides ORSR.** ✅ Approved. Explicit precedence: `ORSR ACTIVE + RÚZ datumZrusenia → ACTIVE`. `ORSR not checked + RÚZ datumZrusenia → DISSOLVED`.

3. **Staleness — freshness separated from truth value.** ✅ Approved with correction. `legalStatus` is NOT degraded to UNKNOWN based on age. `legalStatusObservedAt` tracks freshness for UI display. Optional `freshOnly` filter param, default off.

4. **`status` + `statusNormalized` — keep deprecated, drop after dependency audit.** ✅ Approved. Phase 4 (cleanup) is a separate future migration after grep/test verification of zero usage.

5. **`hasFinancials` — derived, tri-state.** ✅ Approved. No stored column. Derived from `latestYear` + `ruzReportingStatus`:
   - `true` = `latestYear != null`
   - `false` = `latestYear = null AND ruzReportingStatus = VERIFIED` (RÚZ has filings but we didn't parse)
   - `unknown` = `latestYear = null AND ruzReportingStatus != VERIFIED`

6. **`legalStatusSource` + `legalStatusObservedAt` — added for auditability.** ✅ Approved. Enables "Why does the system claim this company is dissolved?" traceability.

---

## 9. Approval Checklist

- [x] Axis definitions approved (legalStatus, ruzReportingStatus, hasFinancials, latestFinancialYear)
- [x] Source precedence approved (ORSR > Vestník > RÚZ > NONE)
- [x] Conflict resolution approved (ORSR wins; RÚZ never overrides ORSR)
- [x] Freshness model approved (no degradation; `legalStatusObservedAt` for UI display)
- [x] Open questions #1-6 resolved
- [x] Migration strategy approved (Phase 1-4, deprecation timeline)
- [x] Filter mapping approved (status → legalStatus, new hasFinancials + ruzReporting filters)
- [x] Absence-of-evidence principle approved (no source checked → UNKNOWN, never ACTIVE by default)

**Status: APPROVED — proceed to implementation.**
