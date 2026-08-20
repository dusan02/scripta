---
description: Re-seed financial data from RÚZ API for specific company or bulk
---

## Re-seed Single Company

1. Create a reseed script using the RÚZ API extraction logic from `test_seed_ruz_bulk.py`
2. Use these working API endpoints (older API, not blocked from server):
   - `uctovne-jednotky?ico={ico}&zmenene-od=2000-01-01` → returns `{"id": [entity_id]}`
   - `uctovna-jednotka?id={entity_id}` → returns entity detail with `idUctovnychZavierok`
   - `uctovna-zavierka?id={zid}` → returns zavierka with `idUctovnychVykazov`
   - `uctovny-vykaz?id={vid}` → returns vykaz with `obsah.tabulky`

3. Table name matching (Slovak diacritics):
   - `nazov` is a dict: `{"sk": "Strana aktív", "en": "Assets"}`
   - Normalize with `unicodedata.normalize("NFKD", ...)` then strip combining chars
   - Match: "aktiv"/"asset" for aktív, "pasiv"/"liabilit" for pasív, "zisk"/"income" for income

4. Data extraction (flat array format, 2025+):
   - Aktív: stride=4, offset=1. Row N → `data[(N-1)*4 : (N-1)*4+4]`, current=col[2], prev=col[3]
   - Pasív: stride=2, offset=79. Row N → `data[(N-79)*2 : (N-79)*2+2]`, current=col[0], prev=col[1]
   - Income: stride=2, offset=1. Row N → `data[(N-1)*2 : (N-1)*2+2]`, current=col[0], prev=col[1]

5. Key row numbers:
   - Aktív: 1=totalAssets, 2=nonCurrentAssets, 33=currentAssets, 72=cash
   - Pasív: 80=equity, 102=longTermLiabilities, 122=shortTermLiabilities
   - Income: 1=revenue, 10=operatingCosts, 12=materialConsumption, 14=servicesCosts, 28=valueAdded, 57=incomeTax, 56=profitBeforeTax, 61=netProfit

6. Skip vykazy with `idSablony != 699` and no `obsah.tabulky` (PDF-only attachments)

7. Update DB:
   ```sql
   UPDATE "FinancialStatement" SET
     "nonCurrentAssets" = $1, "currentAssets" = $2, "totalAssets" = $3,
     "equity" = $4, "shortTermLiabilities" = $5, "longTermLiabilities" = $6,
     "grossProfit" = $7, "materialConsumption" = $8, "servicesCosts" = $9,
     "operatingCosts" = $10, "ruzZavierkaId" = $11, "ruzVykazId" = $12
   WHERE "companyIco" = $13 AND year = $14
   ```

## Bulk Re-seed

Use `reseed_income_tax.py` pattern:
- `asyncpg.create_pool` for DB (not single connection — avoids InterfaceError)
- Concurrency limit: 3 concurrent API calls, 300ms delay
- Checkpoint to `output/income_tax_checkpoint.json` every 100 ICOs
- Filter: exclude ICO `""` and `"00000000"`
- DB DSN from `DATABASE_URL` env var

## RÚZ API Notes

- Search endpoints (`ekonomicke-subjekty`, `uctovne-zavierky`) return 403 from server IP
- Detail endpoints (`uctovna-jednotka`, `uctovna-zavierka`, `uctovny-vykaz`) work fine
- `uctovne-jednotky?ico=...` works from Docker container but may 403 from host
