# TASK 1 — Coverage Audit Report

**Date:** 2026-08-17
**DB:** production (verifa_postgres on 89.185.250.213)
**Method:** SQL queries via `docker exec verifa_postgres psql`
**Production code modified:** NONE

---

## Denominators

| Metric | Value |
|--------|-------|
| Total companies | 518,800 |
| Valid IČO (excl. `""`, `"00000000"`) | 518,798 |
| FinancialStatement rows | 1,351,825 |
| Companies with ≥1 FinancialStatement | 298,924 (57.6%) |
| VestnikEvent rows | **1** |
| Companies with ≥1 VestnikEvent | **1** |

---

## Coverage Matrix — Screener Fields (denominator = 518,798 valid companies)

| # | Filter | DB field | NOT NULL | % | Notes |
|---|--------|----------|----------|---|-------|
| 1 | Fulltext (názov/IČO) | `name` | 518,797 | 100.00% | avg length 20 chars, max 241 |
| 2 | NACE section (A–U) | `naceCode` → section | 491,229 | 94.69% | **NaceCode lookup table is EMPTY (0 rows). Section must be derived from numeric naceCode.** |
| 3 | NACE code (podrobne) | `naceCode` | 491,229 | 94.69% | `naceText` is 0% populated (all NULL) — descriptions unavailable |
| 4 | Právna forma | `legalForm` | 518,793 | 100.00% | 11 distinct values; s.r.o. = 501,294 (96.6%) |
| 5 | Ownership type | `ownershipType` | 491,230 | 94.69% | 27,568 NULL. Values are numeric codes (1–8) + 4 text outliers. No code→label mapping defined. |
| 6 | Mesto | `city` | 518,792 | 100.00% | Bratislava variants dominate (mestské časti as separate values) |
| 7 | Vek firmy (min/max) | `establishedAt` | 518,793 | 100.00% | min=1800-01-01 (implausible), max=2026-08-01, 0 future dates |
| 8 | Tržby (min/max) | `latestRevenue` | 220,778 | **42.56%** | Architect estimate 35-50% → CONFIRMED. NULL=298,020, zero=5,455, pos=215,117, neg=206 |
| 9 | Zisk (min/max) | `latestProfit` | 87,331 | **16.83%** | NULL=431,467, zero=3,888. Low coverage — most companies lack P&L data |
| 10 | Aktíva (min/max) | `latestAssets` | 191,329 | **36.88%** | NULL=327,469, zero=5,969 |
| 11 | Vlastné imanie (min/max) | `latestEquity` | 289,760 | **55.85%** | NULL=229,038, zero=2,365. Best coverage of all financial fields |
| 12 | Posledný rok dát | `latestYear` | 298,905 | 57.61% | 2025 dominates (202,602), then 2024 (13,210), 2026 (1,861) |
| 13 | Konkurz (AUTH) | `VestnikEvent` EXISTS | **1 company** | ~0% | **Only 1 VestnikEvent row in entire DB. Sync has never run (VestnikSyncCheckpoint = 0 rows).** |
| 14 | Likvidácia (AUTH) | `VestnikEvent` EXISTS | **0 companies** | 0% | 0 events matching `%likvid%` |
| 15 | Reštrukturalizácia (AUTH) | `VestnikEvent` EXISTS | **0 companies** | 0% | 0 events matching `%reštrukturaliz%` |
| 16 | vestnikClean (AUTH) | `VestnikEvent` NOT EXISTS | 518,797 | ~100% | All companies except 1 have no VestnikEvent |

---

## employeeCount Verification (frozen contract: excluded from MVP)

| Table | NOT NULL | % | > 0 | Notes |
|-------|----------|---|-----|-------|
| `Company.employeeCount` (from RÚZ) | 491,229 | 94.69% | 155,788 (30%) | NOT universally NULL. But 335,441 (68% of non-null) are **0**. |
| `FinancialStatement.employeeCount` (from vykaz) | 92 | 0.01% | 92 | Essentially unpopulated. |

**Conclusion:** `Company.employeeCount` is populated but 0-dominated. The frozen contract's exclusion from MVP is **confirmed correct** — a filter where 68% of non-null values are 0 is not useful. Unverified assumption #1 ("may not exist in RÚZ API") is **partially wrong** — the field exists and is populated, but mostly with 0.

---

## Critical Findings

### FINDING 1 — BLOCKER: NaceCode lookup table is EMPTY (0 rows)

The `NaceCode` table (schema has `code`, `description`, `section`, `sectionName`) contains **0 rows**. All 491,230 companies with `naceCode` are orphans (no matching NaceCode record).

**Impact on Filter #2 (NACE section A–U):** Cannot join to NaceCode table to get section letter. The section must be **derived from the numeric naceCode** using the public SK NACE Rev. 2 standard mapping (e.g., 01-03 → A, 10-33 → C, 41-43 → F, etc.).

**Impact on Filter #3 (NACE code podrobne):** Filtering by `naceCode` works directly (94.69% coverage). But displaying human-readable descriptions requires either populating NaceCode or hardcoding descriptions.

**Note:** `Company.naceText` is 0% populated (all NULL) — unverified assumption #5 is **FALSE**.

**Resolution options (DECISION REQUIRED):**
- (A) Hardcode the public NACE Rev. 2 section mapping (naceCode prefix → section letter) in `screener.ts`. This is a public classification standard, NOT a business rule.
- (B) Populate the `NaceCode` table as a separate data task (not in Tasks 1-8 scope).

**Recommendation:** Option (A) for MVP. The NACE section mapping is a deterministic public standard (EU NACE Rev. 2), not a Verifa business rule. Hardcoding it in `screener.ts` does not violate the "do not invent business rules" constraint.

---

### FINDING 2 — DATA GAP: VestnikEvent has only 1 row in production

The entire `VestnikEvent` table contains **1 row** (1 konkurz event for 1 company). `VestnikSyncCheckpoint` is empty (0 rows) — the Vestník sync has **never been run** in production.

**Impact on AUTH filters (#13-16):**
- Konkurz → returns 1 company
- Likvidácia → returns 0 companies
- Reštrukturalizácia → returns 0 companies
- vestnikClean → returns 518,797 companies (all except 1)

**Assessment:** This is a **production data gap**, not an architecture or implementation issue. The AUTH filter code (Task 3) should be implemented exactly as specified — the EXISTS/NOT EXISTS logic is correct. The filters will functionally work but return few results until Vestník sync is operationalized.

**Note:** `CompanyEvent` table has some vestnik-related events (1 from source=VESTNIK, 5 from source=RPO with eventType=VESTNIK_UDALOST) but the frozen contract specifies `VestnikEvent` for AUTH filters, not `CompanyEvent`. Do not substitute tables.

**Recommendation:** Implement AUTH filters as specified. Flag the Vestník sync gap to operations team separately. Not a blocker for Tasks 2-8.

---

### FINDING 3 — Architect claim correction: `status` is NOT hardcoded to "active"

The frozen contract states: `Company.status` hardcoded to "active" in seed scripts, 100% coverage of unverified value.

**Actual production data:**
| status | count |
|--------|-------|
| `ruz_active` | 404,785 (78.0%) |
| `ruz_checked` | 86,442 (16.7%) |
| `active` | 27,566 (5.3%) |
| `ACTIVE` | 2 |
| (NULL) | 5 |

**Assessment:** The architect's claim is **inaccurate** — there are 4 distinct non-null values, not a single hardcoded "active". However, ADR-006 (exclude status filter) **still holds**: the values `ruz_active`/`ruz_checked` are RÚZ API status flags, not reliable indicators of whether a company is actually operational. The exclusion decision is correct; the justification was wrong.

**No action needed** — status filter remains excluded per frozen contract.

---

### FINDING 4 — Open Question #4 resolved: Základné imanie (shareCapital) NOT viable

`Company.shareCapital` coverage: **0.13%** (663 records out of 518,798).

**Resolution:** Základné imanie is **not** a Screener filter in the frozen contract (filter #11 is Vlastné imanie = `latestEquity`, 55.85% coverage). The 0.13% shareCapital coverage confirms it should not be added. Open Q #4 → **NO**.

---

### FINDING 5 — Open Question #2 unresolved: No premium users exist

All 8 production users have `planName = NULL` and `subscriptionStatus = NULL`. No PREMIUM subscribers exist.

**Impact:** Tier enforcement code can be implemented and tested with mock/seed users, but cannot be verified against real premium users in production. The `planName` → PREMIUM mapping (Open Q #2) remains **unresolved** — no data to infer from.

**Not a blocker for implementation** — the enforcement logic uses `accessLevel` (FREE/AUTH/PREMIUM), and the PREMIUM tier mapping is a separate auth-layer concern. Task 3-5 implement FREE + AUTH tiers; PREMIUM is Phase 2.

---

### FINDING 6 — establishedAt has implausible dates

`min(establishedAt) = 1800-01-01`. The "Vek firmy" filter (Task 3) must handle implausible dates. Companies with `establishedAt` before ~1990 (Slovakia didn't exist as a business registry before 1990s) should not produce negative or absurd ages.

**Recommendation for Task 3:** When computing age from `establishedAt`, clamp or filter dates before 1993-01-01 (Slovakia's founding). This is a data sanitization detail, not a business rule. Flag as implementation note for Task 3.

---

### FINDING 7 — Index coverage for Screener filters

**Existing indexes on Company:** `legalForm`, `city`, `naceCode`, `status`, `establishedAt`, `latestRevenue`, `latestProfit`, `latestAssets`, `orsrSyncedAt`, `ruzSyncedAt`, `pkey(ico)`.

**Missing indexes (relevant to Screener filters):**
- `latestEquity` (filter #11, 55.85% coverage)
- `latestYear` (filter #12, 57.61% coverage)
- `ownershipType` (filter #5, 94.69% coverage)
- `name` (filter #1 fulltext — ILIKE cannot use btree, but trigram/pg_trgm could help)

**Assessment:** With 518K rows, missing btree indexes on `latestEquity`/`latestYear`/`ownershipType` will cause sequential scans when those filters are used. For MVP this is acceptable (SSR, 20-50 result cap). The frozen contract does not specify adding indexes except for kraj/okres (Task 2).

**Recommendation:** Note for Task 8 review. Not a blocker. Consider adding indexes in a future optimization task.

---

### FINDING 8 — ownershipType values are opaque numeric codes

| code | count |
|------|-------|
| 2 | 398,112 |
| 7 | 73,266 |
| (NULL) | 27,568 |
| 8 | 16,814 |
| 6 | 1,265 |
| 5 | 977 |
| 3 | 562 |
| 4 | 227 |
| 1 | 3 |
| Súkromné zahraničné | 2 |
| Zahraničné | 2 |

The frozen contract filter #5 is "Ownership type" with no code→label mapping defined. The filter can work on raw values (pass `ownershipType=2` in URL). But the UI (Task 5) needs human-readable labels.

**DECISION REQUIRED:** What do codes 1-8 mean? The RÚZ API documentation defines these (druh vlastníctva: 1=štátne, 2=súkromné, 3=zmiešané, etc.). This is a **public API specification**, not a Verifa business rule. Using the RÚZ API's documented values is not "inventing a business rule."

**Recommendation:** Use RÚZ API documented labels for UI. For Task 3, the filter operates on raw `ownershipType` value — no interpretation needed in query layer.

---

## Summary of Decisions Required

| # | Question | Recommendation | Blocks Task |
|---|----------|----------------|-------------|
| 1 | NaceCode table empty — how to derive NACE section for filter #2? | Hardcode public NACE Rev. 2 prefix→section mapping in screener.ts | Task 3 |
| 2 | ownershipType code→label mapping for UI | Use RÚZ API documented values (public spec, not business rule) | Task 5 |
| 3 | establishedAt implausible dates (1800-01-01) | Clamp age calculation at 1993-01-01 in Task 3 | Task 3 |
| 4 | Premium planName mapping (Open Q #2) | Unresolved — no premium users exist. Not needed for FREE/AUTH MVP. | None (Phase 2) |

## Non-blockers (data gaps, not implementation blockers)

- VestnikEvent has 1 row → AUTH filters return near-empty results. Implement as specified.
- NaceCode table empty → use hardcoded public mapping (decision #1 above).
- No premium users → PREMIUM tier is Phase 2, not MVP.

## Confirmed vs. Corrected Architect Claims

| Claim | Status |
|-------|--------|
| `latestRevenue` coverage 35-50% | **CONFIRMED** — 42.56% |
| `pocetZamestnancov` possibly 0% coverage | **PARTIALLY WRONG** — 94.69% not-null but 68% of those are 0 |
| `Company.status` hardcoded "active", 100% coverage | **WRONG** — 4 distinct values (ruz_active, ruz_checked, active, ACTIVE) |
| `naceText` populated for all companies with naceCode | **WRONG** — 0% populated (all NULL) |
| RÚZ API provides kraj/okres, seed discards them | **CONFIRMED** — kraj/okres columns don't exist in Company table |
| VestnikEvent has index on companyIco | **CONFIRMED** |
| Vestník "clean" companies are truly clean | **UNVERIFIABLE** — only 1 event in DB, sync never run |

---

## Audit complete. No production code was modified.

Awaiting decisions on the 4 items above before proceeding to Task 2.
