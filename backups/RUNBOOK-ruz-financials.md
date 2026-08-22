# RÚZ Financials Import — Runbook

## Prerekvizície

### 1. RÚZ API prístup
RÚZ API (`https://www.registeruz.sk/cruz-public/api`) musí byť prístupné z prostredia.
Test:
```bash
curl -s -H "User-Agent: Verifa.sk/1.0" "https://www.registeruz.sk/cruz-public/api/uctovna-jednotka?ico=00112233&max=1" | head -c 200
```
Ak vráti JSON → API je prístupné. Ak vráti `Request Rejected` → WAF blokuje IP.

### 2. DB prístup
```bash
# Z frontend adresára
cd frontend
npx prisma db pull --print 2>&1 | head -5  # overí schema
```

### 3. DB backup
**Pred spustením urobiť backup:**
```bash
docker exec verifa_postgres_exposed pg_dump -U verifa -d verifa -Fc -Z 6 \
  --no-owner --no-privileges \
  > backups/verifa_pre_ruz_$(date +%Y%m%d_%H%M%S).dump
```

---

## Fáza 1: RÚZ Entity Verification (~2-3 hodiny)

**Cieľ:** Pre každú firmu v DB nájsť `ruzEntityId` a nastaviť `status='ruz_active'`.

**Skript:** `frontend/src/scripts/seed-ruz-verification-bulk.ts`

**Mechanizmus:**
1. Stream RÚZ entity IDs (pravna-forma=112 s.r.o. + 121 a.s., zmeneneOd=2026-01-01)
2. Pre každé ID: fetch entity detail (ico, velkostOrganizacie, skNace, etc.)
3. Cross-match s DB podľa IČO
4. Update: `ruzEntityId`, `status='ruz_active'` (ak má závierky) alebo `'ruz_checked'`, `employeeCount`, `naceCode`, `sizeCategory`, `ownershipType`, `ruzSyncedAt`

**Checkpoint z minulej session:** `seed-ruz-bulk-checkpoint.json`
- 491,856 entít už spracovaných (ale DB bola resetovaná, takže treba re-run)
- **Treba zmazať checkpoint pre fresh run:** `rm seed-ruz-bulk-checkpoint.json`

**Príkazy:**
```bash
cd frontend

# Test na 100 entitách
DATABASE_URL="postgresql://verifa:verifa_dev_password@HOST:5432/verifa" \
  npx tsx src/scripts/seed-ruz-verification-bulk.ts --limit=100

# Full run (s resume)
DATABASE_URL="postgresql://verifa:verifa_dev_password@HOST:5432/verifa" \
  npx tsx src/scripts/seed-ruz-verification-bulk.ts --resume --concurrency=5
```

**Očakávaný výsledok:**
- ~491K entít spracovaných
- ~404K firiem s `status='ruz_active'` (majú 2025 závierky)
- ~87K firiem s `status='ruz_checked'` (bez závierok)
- DB polia updateované: `ruzEntityId`, `employeeCount`, `naceCode`, `sizeCategory`, `ownershipType`, `ruzSyncedAt`

---

## Fáza 2: RÚZ Financial Statements Bulk Import (~42 hodiny)

**Cieľ:** Pre každú `ruz_active` firmu stiahnuť finančné výkazy a naplniť `FinancialStatement` tabuľku.

**Skript:** `frontend/src/scripts/seed-financials-bulk.ts`

**Mechanizmus:**
1. Pre každú firmu s `status='ruz_active'` AND `ruzEntityId IS NOT NULL` AND `latestYear IS NULL`:
   - Fetch entity detail → `idUctovnychZavierok`
   - Fetch závierka → `idUctovnychVykazov`
   - Fetch výkaz → parse tabulky (aktíva, pasíva, výsledovka)
   - Upsert `FinancialStatement` + update `Company.latestYear/Revenue/Profit/Assets/Equity`
2. ~3 API calls per company (entity + závierka + výkaz)
3. IFRS check: ak `pristupnostDat === "Verejné prílohy"` → PDF-only, skip

**Prerekvizície:** Fáza 1 musí byť dokončená (firmy musia mať `ruzEntityId` a `status='ruz_active'`).

**Príkazy:**
```bash
cd frontend

# Test na 100 firmách
DATABASE_URL="postgresql://verifa:verifa_dev_password@HOST:5432/verifa" \
  npx tsx src/scripts/seed-financials-bulk.ts --max=100 --concurrency=10

# Full run (s resume)
DATABASE_URL="postgresql://verifa:verifa_dev_password@HOST:5432/verifa" \
  npx tsx src/scripts/seed-financials-bulk.ts --resume --concurrency=20
```

**Očakávaný výsledok:**
- ~404K firiem spracovaných
- ~300-350K s aspoň 1 FinancialStatement (odhad — nie všetky majú JSON výkazy)
- DB polia updateované: `FinancialStatement.*`, `Company.latestYear/Revenue/Profit/Assets/Equity`

**Workload:**
- ~404K firiem × 3 API calls = ~1.2M API calls
- concurrency=20, 200ms delay: ~160 companies/min → ~42 hodín
- concurrency=10: ~84 hodín

---

## Fáza 3: Verifikácia

```bash
# Skontrolovať coverage
docker exec verifa_postgres_exposed psql -U verifa -d verifa -c "
SELECT 
  COUNT(*) as total,
  COUNT(*) FILTER (WHERE status = 'ruz_active') as ruz_active,
  COUNT(*) FILTER (WHERE \"ruzEntityId\" IS NOT NULL) as with_entity_id,
  COUNT(*) FILTER (WHERE \"latestYear\" IS NOT NULL) as with_financials,
  COUNT(*) FILTER (WHERE \"naceCode\" IS NOT NULL) as with_nace,
  COUNT(*) FILTER (WHERE \"employeeCount\" IS NOT NULL) as with_employees
FROM \"Company\";
"

# Skontrolovať FinancialStatement
docker exec verifa_postgres_exposed psql -U verifa -d verifa -c "
SELECT COUNT(*) as total_stmts, 
  COUNT(DISTINCT \"companyIco\") as companies_with_stmts,
  MIN(year) as min_year, MAX(year) as max_year
FROM \"FinancialStatement\";
"
```

---

## ORSR Full Bulk Seed (paralelné, nezávislé od RÚZ)

**Skript:** `worker/src/bulk_seed_orsr.py`

**Možno spustiť paralelne s RÚZ** — ORSR a RÚZ API sú nezávislé.

```bash
cd worker
.venv/bin/python -m src.bulk_seed_orsr --resume --concurrency 5
```

**Workload:** ~515K firiem, ~21.5 companies/min = ~400 hodín = ~17 dní.

**Non-destructive:** Preserves RPO-sourced CompanyPerson records.

---

## Súhrn pipeline

```
RPO dump → 518K Company (DONE)
                ↓
Vestník API → 4.7K events, 3.1K matched (DONE, FROZEN)
                ↓
RÚZ Fáza 1 → ruzEntityId + status + nace + employees (BLOCKED — WAF)
                ↓
RÚZ Fáza 2 → FinancialStatement + denormalized fields (BLOCKED — needs Fáza 1)
                ↓
ORSR → shareCapital + signingAuthority + businessActivity (VALIDATED, needs server)
                ↓
Scoring engine re-validation (needs FinancialStatement)
```
