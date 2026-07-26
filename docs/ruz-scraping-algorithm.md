# RÚZ Scraping Algorithm — Technical Documentation

## Overview

This document describes the complete pipeline for downloading and processing financial data from the Register účtovných závierok (RÚZ) — the Slovak accounting register. The pipeline spans three layers: scraper, API client, and parser.

---

## Architecture: 3 Layers

```
┌─────────────────────────────────────────────────────────┐
│  1. SCRAPER LAYER (main.py → registeruz.py)             │
│     - Orchestrates RÚZ scraper alongside 25+ others     │
│     - Retry mechanism for failed/unavailable scrapers   │
│     - Passes raw file list to pipeline                  │
├─────────────────────────────────────────────────────────┤
│  2. API CLIENT LAYER (ruz_api.py)                       │
│     - Calls RÚZ Open API (JSON, no API key, no browser) │
│     - Downloads structured tables → .txt files          │
│     - Downloads PDF attachments → .pdf files            │
│     - Invokes JSON parser for SK GAAP statements        │
│     - Saves .metrics.json sidecar if parser succeeds    │
├─────────────────────────────────────────────────────────┤
│  3. PARSER LAYER (ruz_parser.py)                        │
│     - Parses structured JSON tables into FinancialMetrics│
│     - Based on template 699 (SK GAAP Úč POD)            │
│     - Deterministic extraction (no LLM)                 │
└─────────────────────────────────────────────────────────┘
```

---

## Layer 1: Scraper Orchestration

### Files involved:
- `worker/src/main.py` — main worker loop, scraper orchestration, retry logic
- `worker/src/scrapers/registeruz.py` — RÚZ scraper class
- `worker/src/scrapers/base.py` — BaseScraper with `_make_result()`

### Flow:

1. **main.py** runs all scrapers in parallel via `asyncio.gather()`
2. Each scraper returns a `ScrapedSource` object with status: `SUCCESS`, `FAILED`, or `UNAVAILABLE`
3. **Retry mechanism**: If a scraper returns `FAILED` or `UNAVAILABLE`, main.py retries it with exponential backoff:
   - Attempt 1: immediate
   - Attempt 2: 3s delay
   - Attempt 3: 10s delay
   - Attempt 4: 30s delay
4. After all retries, if RÚZ scraper is still `UNAVAILABLE` or `FAILED`, main.py logs a `CRITICAL` warning
5. If RÚZ scraper is `SUCCESS`, its `raw_data` (list of file paths) is passed to the AI pipeline

### RegisterUzScraper (`registeruz.py`):

```python
class RegisterUzScraper(BaseScraper):
    source_type = "REGISTER_UZ"

    async def run(self, *, ico, output_dir, **kwargs) -> ScrapedSource:
        # 1. Calls ruz_api.download_ifrs_reports(ico, max_years, output_dir)
        # 2. If no files returned → returns UNAVAILABLE (triggers retry)
        # 3. If files returned → merges PDFs, returns SUCCESS with raw_data=file_list
        # 4. On exception → returns FAILED
```

**Key decision point**: If `download_ifrs_reports()` returns an empty list, the scraper returns `UNAVAILABLE` (not `SUCCESS`), which triggers the retry mechanism in main.py. This distinguishes "API failure" from "firm legitimately has no statements in RÚZ".

**FIXED**: The code now distinguishes between:
- **Entity not found in RÚZ** → `download_ifrs_reports()` returns `['__ENTITY_NOT_FOUND__']` sentinel → scraper returns `SUCCESS` (legitimate, no retry needed)
- **API call failed** (entity exists but detail fetch failed) → `download_ifrs_reports()` returns empty list `[]` → scraper returns `UNAVAILABLE` (triggers retry)
- **Entity has no statements** (entity exists, has no závierky/VS) → logs warning, returns empty list → scraper returns `UNAVAILABLE`

---

## Layer 2: RÚZ API Client (`ruz_api.py`)

### API Endpoints Used:

| Step | Endpoint | Parameters | Returns |
|------|----------|------------|---------|
| 1 | `/api/uctovne-jednotky` | `ico`, `zmenene-od`, `max-zaznamov` | `{"id": [12345, ...]}` |
| 2 | `/api/uctovna-jednotka` | `id` | Entity detail with `idUctovnychZavierok`, `idVyrocnychSprav` |
| 3 | `/api/uctovna-zavierka` | `id` | Závierka detail with `idUctovnychVykazov`, `obdobieOd`, `obdobieDo`, `konsolidovana` |
| 4 | `/api/uctovny-vykaz` | `id` | Výkaz with `obsah.tabulky` (structured JSON tables) + `prilohy` (PDF attachments) |
| 5 | `/domain/financialreport/attachment/{id}` | — | PDF binary |
| 6 | `/api/vyrocna-sprava` | `id` | Výročná správa with `prilohy` (PDF attachments) |

Base URL: `https://www.registeruz.sk/cruz-public`

### `download_ifrs_reports()` — Main Function:

```
INPUT:  ico (str), max_years (int), output_dir (str)
OUTPUT: list[str] — file paths to downloaded .txt and .pdf files
```

**Step-by-step flow:**

1. **Cache check**: If `output_dir` already contains files with this IČO (size > 100 bytes, age < 24h), return them immediately — skip all HTTP calls. Files older than 24h are ignored and re-downloaded.

2. **Find entity** (API call 1): `GET /api/uctovne-jednotky?ico=XXX`
   - If no entity IDs returned → log warning, return empty list
   - Takes first entity ID: `entity_ids["id"][0]`

3. **Get entity detail** (API call 2): `GET /api/uctovna-jednotka?id=XXX`
   - Extracts `idUctovnychZavierok` (accounting statement IDs) and `idVyrocnychSprav` (annual report IDs)
   - If entity has no závierky and no VS → logs warning

4. **Fetch all závierky and VS details in parallel** (API calls 3):
   - Uses `asyncio.gather()` with semaphore (concurrency=10)
   - Sorts by period (newest first)
   - Deduplicates by period, keeps top `max_years` entries

5. **Process each závierka** (`_process_zavierka()`):
   - Fetches all výkazy in parallel (API call 4, concurrency=10)
   - For each výkaz:
     - If `obsah.tabulky` is non-empty → format tables to text → add to `extracted_tables`
     - If `obsah.tabulky` is empty → download PDF prílohy → add to `downloaded_pdfs`
   - **JSON Parser invocation** (SK GAAP only, non-consolidated):
     - Calls `ruz_parser.parse_zavierka_to_metrics(all_vykazy, ico)`
     - If parser returns metrics with `celkove_aktiva is not None` → save `.metrics.json` sidecar
     - If parser returns metrics with all `None` values → log warning, do NOT save sidecar (LLM extraction will be used)
     - If parser returns `None` → no sidecar (LLM extraction will be used)
   - Save extracted tables to `.txt` file: `IFRS_{ico}_{year}_{index}.txt`
   - Merge downloaded PDFs:
     - If tables were extracted → save as `IFRS_{ico}_{year}_{index}_notes.pdf` (auditor notes)
     - If no tables → save as `IFRS_{ico}_{year}_{index}.pdf` (IFRS consolidated)

6. **Process each výročná správa** (`_process_vs()`):
   - Downloads all PDF prílohy
   - Merges to `VS_{ico}_{year}_{index}.pdf`

7. **Return** list of all saved file paths

### Retry mechanism in API client:

`_api_get()` has its own retry logic:
- 2 retries with 2s delay (default)
- Retries on HTTP 5xx errors, HTTP 429 (Too Many Requests), and exceptions
- HTTP 429 uses 3× longer delay (6s) to respect rate limiting
- Does NOT retry on HTTP 4xx (client errors, except 429)

### Text formatting (`_format_vykaz_tables()`):

Converts JSON tables to pipe-delimited text format:
```
DOKUMENT: IFRS
OBDOBIE: 2025-01-2025-12

--- STRANA AKTÍV ---
137305528 | 10769888 | 126535640 | ...
```

Also extracts state liabilities (rows 131-133 from template 699):
- Záväzky voči zamestnancom
- Záväzky zo sociálneho poistenia
- Daňové záväzky a dotácie

---

## Layer 3: JSON Parser (`ruz_parser.py`)

### Purpose:
Eliminates LLM hallucinations by extracting financial metrics directly from structured JSON tables returned by the RÚZ API. Based on official template 699 (Účtovná závierka podnikateľa).

### Template 699 Structure:

| Table | Name | Rows | Data Columns |
|-------|------|------|--------------|
| 0 | Strana aktív | 1-78 | [Brutto, Korekcia, Netto2 (current), Netto3 (preceding)] |
| 1 | Strana pasív | 79-145 | [Bežné (current), Predchádzajúce (preceding)] |
| 2 | Výkaz ziskov a strát | 1-61 | [Bežné (current), Predchádzajúce (preceding)] |

### Row Mapping (cisloRiadku → metric):

**Strana aktív (table 0):**
| Row | Metric | Field |
|-----|--------|-------|
| 1 | Celkové aktíva | `celkove_aktiva` |
| 33 | Obežný majetok | `obezny_majetok` |
| 34 | Zásoby | `zasoby` |
| 54 | Pohľadávky z obchodného styku | `pohladavky_z_obchodneho_styku` |
| 72 | Peniaze | `peniaze_a_penazne_ekvivalenty_k_31_12` |

**Strana pasív (table 1):**
| Row | Metric | Field |
|-----|--------|-------|
| 80 | Vlastné imanie celkom | `vlastne_imanie_celkom` |
| 102 | Dlhodobé záväzky | `dlhodobe_zavazky` |
| 122 | Krátkodobé záväzky | `kratkodobe_zavazky` |
| 123 | Záväzky z obchodného styku | `zavazky_z_obchodneho_styku` |
| 131 | Záväzky voči zamestnancom | `zavazky_zamestnanci` |
| 132 | Záväzky zo sociálneho poistenia | `zavazky_sp` |
| 133 | Daňové záväzky | `danove_zavazky` |

**Výkaz ziskov a strát (table 2):**
| Row | Metric | Field |
|-----|--------|-------|
| 1 | Tržby z hlavnej činnosti | `trzby_z_hlavnej_cinnosti` |
| 15 | Osobné náklady | `osobne_naklady` |
| 21 | Odpisy | `odpisy` |
| 49 | Úroky | `uroky` |
| 61 | Čistý zisk/strata | `zisk_alebo_strata_po_zdaneni` |

### Table Identification (`_identify_tables()`):

The parser identifies tables by their Slovak names in `tab.nazov.sk`:
- `"strana akt"` or `"aktív"` → aktiv table
- `"strana pas"` or `"pasív"` → pasiv table
- `"ziskov a str"` or `"profit and loss"` → income table

**Critical failure point**: If `obsah.tabulky` is an empty list `[]`, `_identify_tables()` returns `{}`, and `parse_tables_to_metrics()` returns `None` at the check:
```python
if not tables:
    return None
```

### Index Calculation:

Row indices (cisloRiadku) are converted to data[] array positions:
- Aktív: `data_index = cisloRiadku - 1` (first row = index 0)
- Pasív: `data_index = cisloRiadku - 79` (first row = index 0)
- Income: `data_index = cisloRiadku - 1` (first row = index 0)

### Value Extraction (`_extract_row_value()`):

Handles two row formats:
1. **Full rows** (with label columns): `len(row) > data_cols` → takes last `data_cols` elements
2. **Data-only rows**: `len(row) == data_cols` → takes from index 0

### Unit Detection (EUR vs thousands EUR):

Heuristic: If `celkove_aktiva < 1000` AND `pocet_zamestnancov > 10`, assumes values are in thousands EUR and multiplies all metrics × 1000.

### Sanity Checks:

1. **Balance sheet balance**: `assets ≈ equity + total_liabilities` (1% tolerance)
2. **Revenue non-negative**: warns if `trzby < 0`
3. **Personnel costs non-negative**: warns if `osobne_naklady < 0`

### Sidecar Files:

- **Saved as**: `{txt_path}.metrics.json` (e.g., `IFRS_00684881_2025_0.metrics.json`)
- **Contains**: `{"ico": null, "metriky": {...FinancialMetrics...}, "source": "ruz_json_parser"}`
- **Saved only if**: `parsed_metrics.celkove_aktiva is not None` (after fix)
- **Loaded by**: `ruz_parser.load_metrics_sidecar(txt_path)` in pipeline.py

---

## Layer 4: Pipeline Processing (`pipeline.py`)

### How RÚZ files are consumed:

1. **File routing**: `main.py` passes `ruz_files` (from scraper) to `process_company()` in pipeline.py
   - If scraper was `SUCCESS` → `ruz_files` = list of file paths
   - If scraper failed → `ruz_files` = `None` → pipeline attempts its own `download_ifrs_reports()`

2. **File classification** (pipeline.py line 827-834):
   - Files starting with `IFRS_` → `ifrs_files` (financial statements)
   - Files starting with `VS_` → `vs_files` (annual reports)

3. **Smart routing** (line 842-855):
   - If an IFRS PDF has ≤ 2 pages AND a VS file exists for the same year → replace IFRS with VS (handles companies that embed IFRS in annual reports)

4. **IFRS processing** (`_process_ifrs()`, line 861):
   For each IFRS file:
   
   a. **Notes PDF skip**: If file ends with `.pdf` and contains "notes" → skip LLM extraction (processed separately by `_process_notes`)
   
   b. **SK GAAP fast path** (line 877-889): If file ends with `.txt`:
   - Load `.metrics.json` sidecar via `load_metrics_sidecar()`
   - **If sidecar exists AND `celkove_aktiva is not None`** → use parsed metrics directly, skip LLM
   - **If sidecar exists but `celkove_aktiva is None`** → log warning, fall through to LLM extraction
   - **If no sidecar** → fall through to LLM extraction
   
   c. **LLM extraction** (line 891+): 
   - For `.pdf` files: calls `extract_financial_data()` + `verify_critical_numbers_blind()` in parallel
   - For `.txt` files: calls `extract_financial_data()` only
   - Uses Gemini 2.5 Flash model
   - **Non-deterministic** — LLM may interpret text differently each run

5. **Results collection**: Extracted data is collected in `_ifrs_results` list

6. **Post-extraction check** (line 1113+): If `_ifrs_results` is empty → logs `CRITICAL` warning and saves `FINANCIAL_DATA_MISSING` event to DB

---

## Known Issues & Failure Modes

### 1. RÚZ API Returns Empty Tables (`obsah.tabulky = []`)

**Symptom**: RÚZ API returns a výkaz (accounting statement) but the `obsah.tabulky` field is an empty list. The parser has nothing to parse.

**Impact**: Parser returns `FinancialMetrics` with all `None` values. Sidecar is not saved (after fix). Pipeline falls back to LLM extraction from `.txt` file.

**Root cause**: Unknown — possibly RÚZ API serves výkazy with tables only for certain templates/periods, or the API response structure has changed.

**Current mitigation**: LLM extraction fallback (non-deterministic, may produce different results each run).

### 2. Non-deterministic LLM Extraction

**Symptom**: Same IČO produces different `verifaScore` across runs (e.g., 85 locally vs 62 on production).

**Root cause**: When JSON parser fails (empty tables), pipeline falls back to Gemini LLM to extract financial metrics from `.txt` files. LLM is non-deterministic — it may interpret numbers differently, miss values, or hallucinate.

**Impact on score**: The algorithmic scorecard uses financial metrics (revenue, profit, assets, equity) to compute a deterministic score. Different metrics → different score:
- Local run: `netProfitLoss 2025 = +37M` → algo score = 88
- Production run: `netProfitLoss 2025 = -1.9M` → algo score = 67

**Fix**: Make JSON parser work (so LLM is never used for SK GAAP), OR accept LLM variance.

### 3. Cache Invalidation (FIXED)

**Previous issue**: If `output_dir` already contained files for an IČO, `download_ifrs_reports()` returned cached files indefinitely without hitting the API.

**Fix applied**: Cache now has a **24-hour max age** (`_CACHE_MAX_AGE = 86400` seconds). Files older than 24h are ignored and re-downloaded from the RÚZ API. This ensures that if the parser previously failed (no sidecar saved), a re-run within 24h will still use cached files, but after 24h the API is hit again.

**Impact**: Stale cache from failed parser runs no longer persists indefinitely.

### 4. Sidecar Truthiness Bug (FIXED)

**Original bug**: `ruz_api.py` line 347 checked `if parsed_metrics:` — a `FinancialMetrics` object is always truthy in Python, even with all `None` values. This caused empty sidecars to be saved.

**Pipeline bug**: `pipeline.py` line 880 checked `if parsed_metrics is not None:` — accepted empty metrics, skipped LLM extraction, and used all-`None` data for the report.

**Fix applied**: Both checks now verify `parsed_metrics.celkove_aktiva is not None` before using parsed data.

---

## Configuration

| Setting | Location | Default | Description |
|---------|----------|---------|-------------|
| `ruz_max_years` | `config.py` | 10 | Maximum years of statements to download |
| `_TIMEOUT` | `ruz_api.py` | 30s | HTTP timeout per API call |
| `_API_RETRIES` | `ruz_api.py` | 2 | Number of retries per API call |
| `_API_RETRY_DELAY` | `ruz_api.py` | 2.0s | Delay between retries |
| `_FETCH_CONCURRENCY` | `ruz_api.py` | 10 | Parallel HTTP calls for výkazy |
| `_CONCURRENCY` | `ruz_api.py` | 5 | Parallel PDF downloads |

---

## File Naming Convention

| Pattern | Type | Content |
|---------|------|---------|
| `IFRS_{ico}_{year}_{index}.txt` | SK GAAP tables | Pipe-delimited text from JSON tables |
| `IFRS_{ico}_{year}_{index}.pdf` | IFRS consolidated | Full PDF statement |
| `IFRS_{ico}_{year}_{index}_notes.pdf` | SK GAAP notes | Auditor report + notes PDF |
| `IFRS_{ico}_{year}_{index}.metrics.json` | Parser sidecar | Deterministic FinancialMetrics |
| `VS_{ico}_{year}_{index}.pdf` | Annual report | Merged PDF prílohy |

---

## Data Flow Summary

```
RÚZ API
  │
  ├─ uctovne-jednotky?ico=XXX → entity_id
  │
  ├─ uctovna-jednotka?id=XXX → zavierka_ids[], vs_ids[]
  │
  ├─ uctovna-zavierka?id=XXX → vykaz_ids[], obdobie, konsolidovana
  │
  ├─ uctovny-vykaz?id=XXX
  │     │
  │     ├─ obsah.tabulky NON-EMPTY → _format_vykaz_tables() → .txt
  │     │                                                    │
  │     │                                    ruz_parser.parse_zavierka_to_metrics()
  │     │                                                    │
  │     │                                    ├─ celkove_aktiva NOT None → save .metrics.json sidecar
  │     │                                    └─ celkove_aktiva IS None → no sidecar (LLM fallback)
  │     │
  │     └─ obsah.tabulky EMPTY → download prilohy PDFs → _notes.pdf
  │
  └─ vyrocna-sprava?id=XXX → download prilohy PDFs → VS_{ico}_{year}.pdf

PIPELINE (pipeline.py)
  │
  ├─ .txt file + .metrics.json sidecar (celkove_aktiva NOT None)
  │     → use parsed metrics directly (DETERMINISTIC, no LLM)
  │
  ├─ .txt file + no sidecar (or celkove_aktiva IS None)
  │     → LLM extraction via Gemini (NON-DETERMINISTIC)
  │
  └─ .pdf file (IFRS consolidated)
        → LLM extraction via Gemini (NON-DETERMINISTIC)
```

---

## Open Questions for Review

1. **Why does RÚZ API return `obsah.tabulky = []` for some výkazy?** Is this a template mismatch (not template 699)? Is the API serving incomplete data? Is there a different endpoint for structured tables?

2. **Is the table identification logic (`_identify_tables`) robust enough?** It matches on Slovak name substrings. Could the API return different name formats?

3. **Should the parser support templates other than 699?** Template 699 is for "Účtovná závierka podnikateľa". Other templates (e.g., 700 for non-profits, 701 for banks) may have different row mappings.

4. **Should LLM adjustment (`llm_score_adjustment`) be disabled for determinism?** Currently -10 to +10 points are added by Gemini, making the final score non-deterministic even when the algorithmic score is stable.

5. **~~Should the cache in `download_ifrs_reports()` be invalidated after a certain time?~~** **FIXED**: Cache now expires after 24 hours (`_CACHE_MAX_AGE = 86400`).
