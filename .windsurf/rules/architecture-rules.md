# Architecture Rules — Technical State

These document the current technical state of Verifa's infrastructure.
Unlike domain rules, these CAN change as infrastructure evolves.
Update when endpoints, formats, or deployment changes.

---

## RÚZ API

### Endpoints (working from Docker container)

- `uctovne-jednotky?ico={ico}&zmenene-od=2000-01-01` → returns `{"id": [entity_id]}`
- `uctovna-jednotka?id={entity_id}` → entity detail with `idUctovnychZavierok`
- `uctovna-zavierka?id={zid}` → zavierka with `idUctovnychVykazov`
- `uctovny-vykaz?id={vid}` → vykaz with `obsah.tabulky`

### Known issues

- Search endpoints (`ekonomicke-subjekty`, `uctovne-zavierky`) may return 403 from server IP.
- Detail endpoints work fine from Docker container.
- `uctovne-jednotky?ico=...` works from Docker but may 403 from host.

### Table name format

- `nazov` in tables is a dict: `{"sk": "Strana aktív", "en": "Assets"}`
- Extract `sk` or `en` value.
- Normalize Slovak diacritics (NFKD) for matching.
- Match: "aktiv"/"asset" for aktív, "pasiv"/"liabilit" for pasív, "zisk"/"income" for income.

### Data format (2025+)

Flat array format (scalars grouped by data_cols):
- Aktív: stride=4, offset=1. Row N → `data[(N-1)*4 : (N-1)*4+4]`, current=col[2], prev=col[3]
- Pasív: stride=2, offset=79. Row N → `data[(N-79)*2 : (N-79)*2+2]`, current=col[0], prev=col[1]
- Income: stride=2, offset=1. Row N → `data[(N-1)*2 : (N-1)*2+2]`, current=col[0], prev=col[1]

Older format: list-of-lists where each row is a separate array.

### Key row numbers

- Aktív: 1=totalAssets, 2=nonCurrentAssets, 33=currentAssets, 72=cash
- Pasív: 80=equity, 102=longTermLiabilities, 122=shortTermLiabilities
- Income: 1=revenue, 10=operatingCosts, 12=materialConsumption, 14=servicesCosts, 28=valueAdded, 56=profitBeforeTax, 57=incomeTax, 61=netProfit

### Template guard

- idSablony=699: standard SK GAAP with full tables → parse all fields.
- idSablony!=699 (e.g. 684): consolidated → skip extended fields.
- Some vykazy have no `obsah.tabulky` (PDF-only) → skip.

### Cash fallback rows (ruz_parser)

If cash (row 72) is 0 or None, try fallback rows in order:
1. Row 72 (Peniaze a penazné ekvivalenty) — primary
2. Row 71 (Finančné účty) — fallback
3. Row 66 (Krátkodobý finančný majetok) — last resort

Each fallback step is logged.

### Unit detection (EUR vs thousands)

RÚZ JSON usually returns values in EUR. Some statements use thousands of EUR.
Detection heuristic:
- If totalAssets < 5000 AND employees > 5 → multiply all values × 1000
- Rationale: assets per employee should be > 1 EUR if unit=EUR

### Thousands correction (_fix_thousands)

For firms with revenue > 100M EUR:
- If a field value < 0.1% of revenue AND ×1000 ≤ 2× revenue → multiply ×1000
- Applied to: operatingCosts, materialConsumption, services, wageCosts, profitBeforeTax, incomeTax, interest, financialResult
- NOT applied to: taxesFees (naturally small even in correct units)

### ARCH-RUZ-001 — RÚZ API provides kraj and okres

**Status:** Verified technical fact

The RÚZ API provides geographic fields:
- `kraj` — NUTS3 region code (e.g. `SK031`)
- `okres` — LAU district code (e.g. `SK0316`)

Current ingestion/seed logic does not persist these fields to `Company`; they are currently discarded.

When modifying RÚZ ingestion or Company schema:
- preserve the raw API values;
- `kraj` must be stored as the RÚZ NUTS3 code;
- `okres` must be stored as the RÚZ LAU code;
- do not derive these values from city names or a static city→region mapping.

---

## Deployment

- Server: verifa.sk
- Docker Compose: `/opt/scripta/docker-compose.yml`
- Worker container: `verifa_worker` (memory limit: 4GB)
- Frontend container: `verifa_frontend`
- DB: PostgreSQL (connection from `DATABASE_URL` env var)
- DB DSN: `postgresql://verifa:***@postgres:5432/verifa`

### Deploy workflow

1. `git pull` on server
2. `docker compose build worker --no-cache`
3. `docker compose up -d worker`
4. Verify: `docker logs verifa_worker --tail 20`

---

## DB Schema (key tables)

- `FinancialStatement`: financial data per company per year
- `Company`: company master data
- `ReportRequest`: PDF report generation queue
- `NarrativeReport`: LLM-generated narrative analysis
- `ForensicScorecard`: scoring results (versioned)

---

## Concurrency & Rate Limits

- RÚZ API: max 3 concurrent calls, 300ms delay between calls.
- LLM (Gemini): rate limit per model, retry with exponential backoff.
- DB: use `asyncpg.create_pool` for bulk operations (not single connection — avoids InterfaceError).
