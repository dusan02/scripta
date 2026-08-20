# RÚZ Financial-Data Ingestion Contract

## Overview

This document defines the contract for the RÚZ financial-data ingestion pipeline.
It is enforced by the permanent regression test suite in `test_ruz_regression.py`.

## Data Flow

```
RÚZ API (registeruz.sk)
      ↓
uctovna-jednotka → uctovna-zavierka → uctovny-vykaz
      ↓
obsah.tabulky (structured JSON tables)
      ↓
ruz_parser.py (template-specific row mapping)
      ↓
FinancialMetrics (Pydantic model)
      ↓
FinancialStatement (DB record with dataQualityStatus)
      ↓
Financial calculations / LLM analysis / PDF report
```

## Templates

### Template 687 (Micro-firm / Zjednodušený účtovný výkaz)

- **Row mapping**: Different from 699
  - Aktív: 23 rows, 2 data columns [Bežné, Predchádzajúce]
  - Pasív: 22 rows, 2 data columns
  - Income: 38 rows, 2 data columns
- **Key rows (aktív)**:
  - r.1 = SPOLU MAJETOK (totalAssets)
  - r.2 = Neobežný majetok (nonCurrentAssets)
  - r.14 = Obežný majetok (currentAssets)
  - r.15 = Zásoby (inventory)
  - r.18 = Pohľadávky z obch. styku (tradeReceivables)
  - r.22 = Peniaze (cash)
- **Key rows (pasív)**:
  - r.25 = Vlastné imanie (equity)
  - r.34 = Záväzky (totalLiabilities)
  - r.35 = Dlhodobé záväzky (ltLiabilities)
  - r.38 = Krátkodobé záväzky (stLiabilities)
  - r.39 = Záväzky z obch. styku (tradePayables)
- **Data format**: Flat array (scalars, not list-of-lists)
- **Extended fields**: NOT extracted (asset/equity composition skipped)

### Template 699 (Standard SK GAAP)

- **Row mapping**: Standard SK GAAP
  - Aktív: 78 rows, 4 data columns [Brutto, Korekcia, Netto2, Netto3]
  - Pasív: 67 rows, 2 data columns [Bežné, Predchádzajúce]
  - Income: 61 rows, 2 data columns
- **Key rows (aktív)**:
  - r.1 = SPOLU AKTÍVA (totalAssets)
  - r.2 = Neobežný majetok (nonCurrentAssets)
  - r.33 = Obežný majetok (currentAssets)
  - r.34 = Zásoby (inventory)
  - r.54 = Pohľadávky z obch. styku (tradeReceivables)
  - r.72 = Peniaze (cash)
- **Key rows (pasív)**:
  - r.80 = Vlastné imanie (equity)
  - r.101 = Záväzky celkom (totalLiabilities)
  - r.102 = Dlhodobé záväzky (ltLiabilities)
  - r.122 = Krátkodobé záväzky (stLiabilities)
  - r.123 = Záväzky z obch. styku (tradePayables)
- **Data format**: List-of-lists or flat array
- **Extended fields**: Extracted (asset/equity composition, reserves, income detail)

### Critical Rule

**687 and 699 must never share row mapping.**

The historical bug (resolved) caused template 687 data to be parsed with
template 699 row mapping. This resulted in:
- `totalAssets` containing `nonCurrentAssets` values
- `currentAssets` being NULL
- `shortTermLiabilities` being NULL

## Data Quality Status

Every `FinancialStatement` must have a `dataQualityStatus` value (NOT NULL).

| Status | Meaning |
|--------|---------|
| `AVAILABLE` | RÚZ provided structured financial data; parser extracted values |
| `SOURCE_GAP` | RÚZ registered the filing, but the digital výkaz contains 0 data rows |
| `API_ERROR` | Transient: API request failed (timeout, 403, JSON decode). Must be retried |
| `PARSER_ERROR` | Transient: parser could not interpret data. Must be fixed/retried |

### Classification Logic

```
if totalAssets IS NOT NULL AND currentAssets IS NOT NULL:
    dataQualityStatus = AVAILABLE
elif totalAssets IS NULL:
    dataQualityStatus = SOURCE_GAP  # Pattern A
elif currentAssets IS NULL:
    dataQualityStatus = SOURCE_GAP  # Pattern B
```

### Transient States

`API_ERROR` and `PARSER_ERROR` are **transient/operational states**.
They must not become permanent without reconciliation:

```
API_ERROR → retry → AVAILABLE (data found) or SOURCE_GAP (empty source)
PARSER_ERROR → fix/retry → AVAILABLE or SOURCE_GAP
```

## Architectural Principle

> **NULL financial value ≠ data error.**
>
> A financial value may be NULL because the source does not provide
> structured data. Data availability must therefore be represented
> independently through `dataQualityStatus`.

This means:
- `currentAssets = NULL` does NOT mean "parser failed"
- `currentAssets = NULL` with `dataQualityStatus = SOURCE_GAP` means
  "RÚZ registered the filing but the digital výkaz has no structured data"
- `currentAssets = NULL` with `dataQualityStatus = AVAILABLE` would indicate
  a genuine parsing issue (this should never happen for BS fields)

## Regression Test Suite

**File**: `tests/test_ruz_regression.py`
**Fixtures**: `tests/golden_fixtures.py`

### Test Categories (17 sections)

| # | Section | Tests | Coverage |
|---|---------|-------|----------|
| 1 | Template structure | 6 | 687/699 detection, no cross-mapping |
| 2 | 687 balance sheet | 10 | Exact row mapping, distinct values |
| 3 | 699 balance sheet | 10 | Regression: 699 unchanged after 687 fix |
| 4 | Flat data format | 6 | Flat vs nested, metadata presence |
| 5 | Missing/empty tables | 6 | No invented values, no exceptions |
| 6 | Source gap | 7 | 0 rows → SOURCE_GAP, no fabrication |
| 7 | Available data | 13 | Full extraction, no contamination |
| 8 | Idempotency | 4 | Parse twice → identical results |
| 9 | Partial data | 4 | Available preserved, missing stays NULL |
| 10 | P&L isolation | 3 | BS reparse doesn't modify P&L |
| 11 | Cross-template | 3 | 687 vs 699 same data → different results |
| 12 | DQ status contract | 5 | AVAILABLE/SOURCE_GAP semantics |
| 13 | Golden fixtures | 28 | Raw → parser → expected values |
| 14 | Invariants | 5 | No cross-row contamination, balance check |
| 15 | DB integrity | 5 | NOT NULL, schema, migration |
| 16 | Error handling | 10 | Deterministic, no corruption |
| **Total** | | **126** | |

### Golden Fixtures (18)

| Category | Count | Description |
|----------|-------|-------------|
| 687 | 5 | Full balance sheet + income, various sizes |
| 699 | 5 | Full balance sheet + income, various sizes |
| source_gap | 3 | Empty tables, missing tables, 699 empty |
| partial | 3 | Missing currentAssets, missing liabilities, Pattern A |
| malformed | 2 | Unknown template, missing titulnaStrana |

### Untested Parser Branches

The following branches are not covered by deterministic fixtures and
would require live API integration tests:

1. **HTTP 403 / 429 / 502 / 503** — RÚZ API rate limiting responses
2. **Connection timeout / reset** — Network-level failures
3. **Thousands-of-EUR unit detection** — Heuristic for values < 5000 with employees > 5
4. **Per-field thousands correction** — `_fix_thousands` for large companies (>100M revenue)
5. **Cash fallback chain** — r.72 → r.71 → r.66 for 699; r.22 → r.21 for 687
6. **Micro-firm income detection** — `_is_micro_income_format` heuristic (38 vs 61 rows)

These branches are handled by the parser's error handling and heuristic logic,
but are not covered by deterministic fixtures because they depend on external
conditions (API state, data magnitude, etc.).
