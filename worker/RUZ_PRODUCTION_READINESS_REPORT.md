# RÚZ Financial Data Ingestion — Production-Readiness Report

**Date:** 2026-08-20
**Status:** ✅ PRODUCTION-READY
**Parser freeze:** Templates 687 (micro-firm) and 699 (standard) — FROZEN

---

## 1. Executive Summary

The RÚZ financial-data ingestion pipeline has been hardened with a comprehensive
permanent regression test suite covering all identified production bugs, edge cases,
and ingestion contract requirements. The pipeline is declared **production-ready**
after:

1. Successful balance-sheet reparse of all Financial Statements
2. Implementation of `dataQualityStatus` field (AVAILABLE / SOURCE_GAP / API_ERROR / PARSER_ERROR)
3. Two-tier test suite: 126 regression tests + 139 hardening tests = **265 tests, all passing**
4. Formal parser freeze and ingestion contract documentation

---

## 2. Test Suite Summary

### 2.1 Test Counts

| Suite | File | Tests | Status |
|-------|------|-------|--------|
| Regression | `test_ruz_regression.py` | 126 | ✅ All pass |
| Hardening | `test_ruz_hardening.py` | 139 | ✅ All pass |
| **Total** | | **265** | **✅ All pass** |

### 2.2 Test Matrix (Hardening Suite — 11 Sections)

| # | Section | Class | Tests | Coverage |
|---|---------|-------|-------|----------|
| 1 | Thousands-of-EUR heuristic | `TestThousandsOfEurHeuristic` | 10 | Unit detection (assets<5000 + employees>5), boundary values, all-fields multiplier |
| 1b | _fix_thousands large-company | `TestFixThousands` | 8 | Revenue>100M correction, guard logic, negative values, multi-field selectivity |
| 2 | Cash fallback chain | `TestCashFallbackChain` | 12 | 699: r.72→r.71→r.66; 687: r.22→r.21; zero/None/positive-only fallback |
| 3 | Micro-firm income detection | `TestMicroFirmIncomeDetection` | 12 | `_is_micro_income_format`: row count, r.38/r.61 presence, flat vs nested, boundaries |
| 4 | API error classification | `TestApiErrorClassification` | 7 | Mocked HTTP scenarios: 200/empty/malformed/403/timeout, transient vs source gap |
| 5 | Source gap semantics | `TestSourceGapSemantics` | 8 | 7 scenarios A-G: entity missing, no zavierka, no vykaz, empty tables, valid, malformed, unknown template |
| 6 | Expanded idempotency | `TestExpandedIdempotency` | 21 | All 18 golden fixtures × 2 parses, data quality status, equity, audit metadata |
| 7 | Cross-template contamination | `TestCrossTemplateContamination` | 9 | Adversarial: 687 uses 687 rows (not 699), 699 uses 699 rows (not 687), adjacent-row traps |
| 8 | Expanded invariants | `TestExpandedInvariants` | 23 | Non-negativity (assets, inventory, cash), loss allowed, no cross-row/column contamination, P&L isolation |
| 9 | Golden fixture expansion | `TestGoldenFixtureExpansion` | 13 | Every production bug has a permanent fixture; distinct values; format verification |
| 10 | Database contract | `TestDatabaseContract` | 9 | Schema has `dataQualityStatus` NOT NULL, migration backfills, enum validation |
| 11 | Production safety | `TestProductionSafety` | 7 | BS reparse preserves all P&L fields (revenue, net profit, income tax, operating costs, equity) |

### 2.3 Test Matrix (Regression Suite — 13 Sections)

| # | Section | Class | Tests | Coverage |
|---|---------|-------|-------|----------|
| 1 | Template structure | `TestTemplateStructure` | 6 | Table identification, row offsets, column counts |
| 2 | 687 balance sheet | `TestTemplate687BalanceSheet` | 10 | All BS field mappings for micro-firm template |
| 3 | 699 balance sheet | `TestTemplate699BalanceSheet` | 10 | All BS field mappings for standard template |
| 4 | Flat data format | `TestFlatDataFormat` | 6 | 687 flat (scalar) vs 699 nested (list-of-lists) |
| 5 | Missing/empty tables | `TestMissingEmptyTables` | 6 | Graceful handling of missing tables, empty rows |
| 6 | Source gaps | `TestSourceGap` | 8 | Empty tables → None metrics, no fabricated values |
| 7 | Partial data | `TestPartialData` | 4 | Missing equity, missing current assets, Pattern A/B |
| 8 | Error handling | `TestErrorHandling` | 10 | Malformed JSON, missing titulna, unknown template |
| 9 | Data quality status | `TestDataQualityStatusContract` | 5 | AVAILABLE vs SOURCE_GAP classification |
| 10 | Invariants | `TestInvariants` | 5 | Non-negativity, accounting identity, field isolation |
| 11 | Idempotency | `TestIdempotency` | 4 | Repeated parsing produces identical results |
| 12 | Cross-template regression | `TestCrossTemplateRegression` | 3 | 687/699 mapping isolation |
| 13 | P&L isolation | `TestPLIsolation` | 3 | P&L fields independent of BS parsing |
| 14 | Database integrity | `TestDatabaseIntegrity` | 5 | Schema constraints, migration correctness |
| 15 | Golden fixtures | `TestGoldenFixtures` | 28 | All 18 golden fixtures parse correctly |
| 16 | Available data | `TestAvailableData` | 13 | Full data extraction verification |

---

## 3. Golden Fixtures (18 Total)

| # | Name | Template | Category | Purpose |
|---|------|----------|----------|---------|
| 1 | `687_full_01` | 687 | full | Complete micro-firm with all fields |
| 2 | `687_full_02` | 687 | full | Second complete micro-firm variant |
| 3 | `687_full_03_loss` | 687 | full | Micro-firm with net loss (negative profit) |
| 4 | `687_full_04_minimal` | 687 | full | Minimal valid micro-firm (zeros) |
| 5 | `687_full_05_large` | 687 | full | Large micro-firm (high values) |
| 6 | `699_full_01` | 699 | full | Complete standard with all fields |
| 7 | `699_full_02` | 699 | full | Second complete standard variant |
| 8 | `699_full_03_consolidated` | 699 | full | Consolidated statement |
| 9 | `699_full_04_small` | 699 | full | Small standard company |
| 10 | `source_gap_01_empty_tables` | 687 | source_gap | Empty tables (0 rows) |
| 11 | `source_gap_02_no_tables_key` | 687 | source_gap | Missing tabulky key |
| 12 | `source_gap_03_699_empty` | 699 | source_gap | 699 with empty tables |
| 13 | `partial_01_687_no_current` | 687 | partial | Missing current assets |
| 14 | `partial_02_699_no_liabilities` | 699 | partial | Missing liabilities |
| 15 | `partial_03_699_pattern_a` | 699 | partial | Pattern A (totalAssets NULL, equity present) |
| 16 | `malformed_01_unknown_template` | 1181 | malformed | Unknown template (not 687/699) |
| 17 | `malformed_02_no_titulna` | 687 | malformed | Missing titulna strana |
| 18 | `malformed_03_no_obsah` | 687 | malformed | Missing obsah entirely |

---

## 4. Production Bugs Covered

| Bug | Root Cause | Test Coverage | Status |
|-----|-----------|---------------|--------|
| 687 totalAssets = nonCurrentAssets | Wrong row mapping (r.2 instead of r.1) | `TestCrossTemplateContamination.test_687_total_assets_from_correct_row` | ✅ Fixed |
| 687 currentAssets = NULL | 699 row mapping used for 687 | `TestCrossTemplateContamination.test_687_current_assets_from_correct_row` | ✅ Fixed |
| 687 shortTermLiabilities = NULL | 699 row mapping used for 687 | `TestCrossTemplateContamination.test_687_st_liabilities_from_correct_row` | ✅ Fixed |
| Cash = 0 when r.72 empty | No fallback to r.71/r.66 | `TestCashFallbackChain` (12 tests) | ✅ Fixed |
| P&L fields in thousands, BS in EUR | No unit detection heuristic | `TestThousandsOfEurHeuristic` (10 tests) | ✅ Fixed |
| Large company P&L in thousands | No _fix_thousands for revenue>100M | `TestFixThousands` (8 tests) | ✅ Fixed |
| 687 income parsed as 699 | No micro-format detection | `TestMicroFirmIncomeDetection` (12 tests) | ✅ Fixed |
| Source gaps classified as parser errors | No dataQualityStatus field | `TestSourceGapSemantics` (8 tests) + `TestDatabaseContract` (9 tests) | ✅ Fixed |
| Tax rate 24087% (unit mismatch) | PBT in thousands, tax in EUR | `TestFixThousands.test_correction_when_value_suspiciously_small` | ✅ Fixed |

---

## 5. dataQualityStatus Semantics

| Status | Condition | Action |
|--------|-----------|--------|
| `AVAILABLE` | totalAssets != NULL AND currentAssets != NULL | Display full BS |
| `SOURCE_GAP` | totalAssets == NULL OR currentAssets == NULL (API succeeded but no data) | Display source-gap message |
| `API_ERROR` | API request failed (timeout, 403, JSON decode) | Retry; classify as SOURCE_GAP after max retries |
| `PARSER_ERROR` | Parser exception (should never happen with frozen parser) | Alert; manual investigation |

**Database constraint:** `dataQualityStatus` is `NOT NULL` — every Financial Statement must have a status.

---

## 6. Ingestion Contract

See `CONTRACT.md` for the full ingestion contract documentation.

**Key principles:**
1. Parser is frozen — no changes to templates 687/699 without new golden fixtures + tests
2. `dataQualityStatus` is the single source of truth for data availability
3. SOURCE_GAP is not an error — it's a legitimate state where RÚZ has no data
4. P&L fields are never modified during BS reparse
5. All 18 golden fixtures must pass before any parser change is merged

---

## 7. Quality Gate

```
$ python3 -m pytest tests/test_ruz_regression.py tests/test_ruz_hardening.py --tb=short -q
265 passed, 4 warnings in 0.78s
```

**Gate criteria (all met):**
- ✅ All 265 tests pass
- ✅ No skipped tests (1 unrelated skip in broader suite)
- ✅ All 18 golden fixtures covered
- ✅ All 11 hardening sections implemented
- ✅ All 9 production bugs have dedicated tests
- ✅ dataQualityStatus enum validated against schema
- ✅ Idempotency verified across all fixtures
- ✅ Cross-template contamination tests are adversarial
- ✅ P&L preservation verified for BS reparse

---

## 8. Files

| File | Purpose |
|------|---------|
| `worker/src/ruz_parser.py` | Frozen parser (templates 687/699) |
| `worker/tests/golden_fixtures.py` | 18 golden RÚZ fixtures + builder utilities |
| `worker/tests/test_ruz_regression.py` | 126 regression tests (13 sections) |
| `worker/tests/test_ruz_hardening.py` | 139 hardening tests (11 sections) |
| `worker/CONTRACT.md` | Ingestion contract documentation |
| `frontend/prisma/schema.prisma` | dataQualityStatus field (NOT NULL) |
| `frontend/prisma/migrations/20260820090000_add_data_quality_status/` | Migration + backfill |

---

**Conclusion:** The RÚZ financial-data ingestion pipeline is production-ready. The
265-test permanent regression suite ensures that any future change that breaks the
ingestion contract will be caught before deployment.
