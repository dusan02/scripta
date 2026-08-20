# SCREENER — FROZEN ARCHITECTURE CONTRACT

**STATUS: ARCHITECT PHASE COMPLETE. Architecture frozen. Do not redesign. Execute Tasks 1–8 exactly as specified.**

---

## 10 Implementation Constraints (binding)

1. Premium Screener queries only precomputed intelligence stored in DB. A Screener request must never trigger scraping, Gemini agents, scoring, report generation, or other expensive computation.

2. `kraj` and `okres` are persisted in DB now from RÚZ API (`kraj` = NUTS3 code like `SK031`, `okres` = LAU code like `SK0316`). UI filters may be deferred, but the schema migration and re-seed happen in the implementation phase. Persist now, expose later.

3. Preset names and descriptions may be visible as teasers to free users. Exact preset logic (filter conditions, thresholds, weightings) remains proprietary and is never exposed in client-side code, API responses, or URL parameters.

4. Customer-facing messaging emphasizes information advantage — "Komplexná analýza firmy z 10+ zdrojov" — not internal implementation details like Gemini agent count or computation time.

5. Company profile teaser explains dimensions of Verifa Intelligence with short descriptions, not just locked labels:
   - Financial Health → "Analýza profitability, zadlženia a finančnej stability"
   - Stability → "Hodnotenie dlhodobej finančnej kondície firmy"
   - Liquidity → "Schopnosť firmy plniť krátkodobé záväzky"
   - Forensic Risk → "Identifikácia neštandardných finančných a registračných signálov"
   - Data Quality → "Úplnosť a spoľahlivosť dát použitých pri hodnotení"

6. FREE public data remains crawlable and indexable. No authentication barriers for SEO pages. `/screener`, `/screener?nace=C`, `/firma/[ico]` are server-rendered and indexable.

7. No premium leakage. No premium field, boolean, score existence, or premium-filter result count may leak through non-premium payloads, response shapes, HTML source, meta tags, or alternate endpoints. Premium params are silently ignored for non-premium users.

8. REPORT_ONLY data is completely separate from Screener and Pro API contracts. Gemini agent outputs, Chief Auditor, forensic narratives, contradictions, and source audit trails exist only in generated PDF reports.

9. Filter system is declarative. New PREMIUM filters and presets can be added by appending to a filter definition array — no rewriting of query architecture.

10. Four data layers are explicitly separated:
    - FREE → "Čo vieme o firme?" (public data aggregation)
    - PREMIUM → "Čo z týchto dát vyplýva?" (derived analytics, proprietary intelligence)
    - REPORT → "Prečo si myslíme, že to tak je?" (AI analysis, decision support)
    - Internal architecture (Gemini count, scraper count, computation time) is never customer-facing messaging

---

## 3 Enforcement Rules (binding)

### Enforcement #1 — `accessLevel` is enforcement, not metadata

```
URL params → parse → tier authorization → sanitized params → Prisma query → tier-specific SELECT → HTML
```

No manual per-filter checks. The entire flow enforces access level automatically.

### Enforcement #2 — `total` count is safe

Premium params are stripped BEFORE COUNT query:

```
strip premium → COUNT(free filters only) → return count  // ✅
```

NOT:

```
COUNT(all filters) → strip premium → return count  // ❌ LEAKAGE
```

### Enforcement #3 — Explicit SELECT per tier

```typescript
const FREE_SELECT = { ico: true, name: true, naceCode: true, ... } as const;
const AUTH_SELECT = { ...FREE_SELECT, hasVestnikEvent: true } as const;
const PREMIUM_SELECT = { ...AUTH_SELECT, verifaScore: true, riskCategory: true } as const;
```

No `findMany` without `select`. No removing fields after query.

---

## Executor Rule

If Executor encounters ambiguity outside these constraints → mark as `DECISION REQUIRED` or `BLOCKER`. Do NOT create custom business rules. Do NOT redesign architecture.

---

## Data Access Classification

| Layer | What it sells | Price | Access |
|-------|--------------|-------|--------|
| FREE | Data — public facts | €0 | No registration |
| AUTH | Access — more results, pagination, Vestník, saved searches | €0 (registration) | Registered |
| PREMIUM | Intelligence — Verifa Score, ratios, risk model, presets | €29–99/m | Pro subscribers |
| REPORT_ONLY | Decision support — full DD, Gemini analysis, forensic findings | €29–99/report | Per-report |

---

## MVP FREE filters (12) — no auth

1. Fulltext (názov / IČO)
2. NACE section (A–U)
3. NACE code (podrobne)
4. Právna forma
5. Ownership type
6. Mesto
7. Vek firmy (min/max)
8. Tržby (min/max)
9. Zisk (min/max)
10. Aktíva (min/max)
11. Vlastné imanie (min/max)
12. Posledný rok dát

## MVP AUTH filters (4) — registration required

13. Konkurz (EXISTS on VestnikEvent)
14. Likvidácia (EXISTS)
15. Reštrukturalizácia (EXISTS)
16. vestnikClean (NOT EXISTS)

## Excluded from MVP

- Verifa Score / risk category / pillar scores → PREMIUM Phase 2, never free
- Financial ratios (Altman, Piotroski, Beneish, ROE, ROA, D/E) → PREMIUM Phase 2
- Data Quality → PREMIUM Phase 2
- Presets → PREMIUM Phase 2
- Počet zamestnancov → API field unconfirmed, possibly 0% coverage
- Status firmy → hardcoded "active", unreliable
- Kraj/Okres UI filter → DB migration in scope, UI filter deferred
- API route → not needed for MVP (SSR sufficient)

---

## Result limits

| Tier | Max results | Pagination |
|------|-------------|------------|
| FREE | 20 | No |
| AUTH | 50/page | Full |
| PREMIUM | 50/page | Full + export (future) |

## Rate limiting

| Tier | Requests/min | Requests/hour |
|------|-------------|---------------|
| FREE (anonymous) | 10 | 100 |
| AUTH (registered) | 30 | 500 |
| PREMIUM (Pro) | 60 | Unlimited |

---

## Architecture decisions

- **ADR-001:** `/screener` separate from `/firmy`. Different UX, different query complexity.
- **ADR-002:** Hybrid SSR + client-side filtering. Server renders initial HTML. Client updates via `router.push()`.
- **ADR-003:** URL query parameters for all filter state. Deterministic, shareable, crawlable.
- **ADR-004:** Kraj/okres from RÚZ API (NUTS codes), not static city map. Requires migration + re-seed.
- **ADR-005:** No denormalization in MVP beyond existing `latestRevenue/Profit/Assets/Equity/Year`.
- **ADR-006:** Status filter excluded — hardcoded "active" is unreliable.
- **ADR-007:** No `/api/screener` route in MVP. SSR with Prisma in server component.
- **ADR-008:** Verifa Intelligence is PREMIUM. Justified by information advantage, not computation cost. Coverage irrelevant to tier decision.
- **ADR-009:** Teaser layer on company profiles. Locked labels with descriptions. Primary conversion mechanism.
- **ADR-010:** FREE public data remains crawlable and indexable. No auth barriers for SEO.

---

## Key facts from Architect audit

- RÚZ API provides `kraj` (NUTS3) and `okres` (LAU) — seed scripts discard them. Measured from live API.
- `Company.status` hardcoded to "active" in both `seed_ruz_bulk.py:195` and `ruz.ts:390`. 100% coverage of unverified value.
- `pocetZamestnancov` not seen in 2 live API responses. Coverage unknown, possibly 0%.
- RPO data not persisted in DB. Not a Screener data source.
- RPVS data not persisted in DB. Not a Screener data source.
- `latestRevenue/Profit/Assets/Equity` denormalized from `FinancialStatement` at `ruz.ts:422-426`.
- VestnikEvent has index on `companyIco`.
- `/firmy` uses SSR with `searchParams` and server-side Prisma query.
- Middleware does not protect `/firmy`.

---

## Domain rules affected

| Rule ID | Status |
|---------|--------|
| DATA-001 | Enforced — NULL ≠ 0 in all filters |
| DATA-002 | Noted — kraj from API is a transformation |
| DATA-004 | Deferred — consolidated/individual = PREMIUM Phase 2 |
| ENT-001 | Enforced — IČO validation |
| ENT-003 | Enforced — legal form values consistent |
| SCORE-001 | Deferred — V2 production, PREMIUM only |
| SCORE-007 | Deferred — AAA/A/B/C, PREMIUM only |
| DQ-003 | Deferred — data quality, PREMIUM Phase 2 |

No new domain rules created. No existing financial calculations reimplemented.

---

## Atomic implementation tasks

### Task 1: Coverage Audit
SQL queries against production DB. Measure actual coverage for every field. Verify `employeeCount` is not universally NULL. Output: updated matrix with MEASURED confidence. **Do not modify production code before reporting audit results.**

### Task 2: Kraj/Okres Migration
Add `kraj`/`okres` columns to `Company`. Batch re-seed from RÚZ API. Add indexes. No UI filter yet.

### Task 3: Screener Query Backend
Create `frontend/src/lib/screener.ts`. Declarative filter definitions with `accessLevel`. Implement 12 FREE + 4 AUTH filters. URL param parsing. Pagination + sorting. EXISTS subqueries for Vestník. NULL handling per DATA-001. Tier-based param filtering. Explicit SELECT per tier.

### Task 4: Screener Page (SSR)
Create `frontend/src/app/screener/page.tsx` (server component). Parse searchParams → filter by tier → call `screener.ts`. Render results table + filter sidebar. Anonymous cap (20). Auth cap (50). Rate limiting.

### Task 5: Screener Filter UI
Create `frontend/src/components/screener-filters.tsx` (client component). 12 FREE filter controls + 4 AUTH (locked for anonymous, redirect to login). URL state via `router.push()`. Sort dropdown. No API calls.

### Task 6: Navigation Integration
Add "Screener" to `LandingNav.tsx` and `NavBar.tsx`. Add `/screener` to `NavWrapper.tsx` exclusion list. Add link from `/firmy` → `/screener`.

### Task 7: Tests
All 16 filters. NULL ≠ 0. Vestník EXISTS. Tier enforcement. URL round-trip. No premium leakage. No status filter. No employeeCount filter.

### Task 8: Fresh Review
Git diff review. Check: no financial formulas reimplemented, NULL handling, no denormalization without justification, anonymous cap, tier enforcement, no premium leakage, URL deterministic, `/firmy` not broken.

---

## Open questions (require human decision before/during implementation)

1. Vestník events: AUTH tier confirmed? (Recommendation: AUTH)
2. Premium plan mapping: which `planName` values = PREMIUM?
3. Anonymous result count: exact or estimated? (Recommendation: exact for FREE filters only)
4. Základné imanie in MVP? Conditional on coverage audit.
5. Preset definitions correct? (5 presets: 🟢🏆🔴⚠️🔍)
6. Sort default: name A-Z or revenue desc?

---

## Unverified assumptions

1. `pocetZamestnancov` may not exist in current RÚZ API. Not seen in 2 live samples.
2. Coverage of `latestRevenue` estimated 35-50%. Must be measured.
3. Vestník "clean" companies are truly clean. Sync may not cover all.
4. `Company.status = "active"` is wrong for dissolved companies.
5. `naceText` populated for all companies with `naceCode`.
