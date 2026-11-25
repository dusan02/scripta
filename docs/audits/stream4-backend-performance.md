# Stream 4 — Backend & Application Performance Audit & Optimization Roadmap (P2)

**Date:** 2026-11-25  
**Scope:** Read-only production measurement on VPS (`89.185.250.213`), PostgreSQL & Redis profiling, Next.js SSR/API & Python worker codebase audit.  
**Production Safety:** 100% read-only inspection (zero schema changes, zero `ANALYZE`/`VACUUM`, zero restarts, zero deploys).

---

## 1. Executive Summary

Verifa's production backend is currently operating under severe **PostgreSQL I/O saturation and cache starvation**:

- **PostgreSQL buffer cache hit ratio is only `69.76%`** (`2.89B` hits vs `1.25B` disk block reads; healthy OLTP target is `>99%`). The VPS has `7.8 GiB` RAM (`2.1 GiB` actively swapped), `shared_buffers = 384MB`, `random_page_cost = 4` (HDD default on SSD), and `pg_stat_statements` is **not installed**.
- **Redis (`verifa_redis`) is `99.56%` idle** — `1.76 MiB` used out of `400 MiB` (`maxmemory`), **`0.81%` hit ratio** (`232,778` hits vs `28,667,475` misses — almost exclusively ARQ worker polling). Next.js caches **zero** application queries in Redis.
- **Nginx latency across `467,254` requests** (`/var/log/nginx/verifa_perf.log` + `.log.1`, ~38h window):
  - `/{lang}/firma/...` (135,623 reqs): **P50 `201.0 ms` / P95 `6,941.9 ms` / P99 `25,329.3 ms`** — cache HIT rate is **`0.95%`** (`68,185` MISS, `64,084` uncached `-`).
  - `/firma/[ico-slug]` (134,100 reqs): **P50 `120.5 ms` / P95 `5,281.0 ms` / P99 `23,427.1 ms`** — MISS P50 **`565.0 ms`**, P95 **`6,778.4 ms`**, P99 **`22,435.7 ms`**.
  - `/firmy` (9,328 reqs): **P50 `345.0 ms` / P95 `6,480.0 ms` / P99 `22,419.6 ms`** — **0% cached** (`-: 9,328`).
  - `/sitemap*.xml` (113 reqs): **P50 `43,913.0 ms` / P95 `49,996.8 ms` / P99 `50,001.0 ms`** — majority returning **HTTP 499** (client timeout at ~50s) or **empty 153-byte XML** due to `Parallel Seq Scan` + `OFFSET` sort on 722K rows!
- **Root causes identified in code & schema:**
  1. `RelatedFirms` (`frontend/src/components/related-firms.tsx`) triggers a backward scan of `Company_latestRevenue_idx` (`398.7M` heap fetches) and BitmapAnd scans of `Company_kraj_idx` (**`23.39B`** index tuples read) + `Company_naceCode_revenue_idx` (`1.97B` index tuples read) on every cache-miss firma render.
  2. `sitemap/[id]/route.ts` executes `WHERE "fsCount" >= 2 ORDER BY ico ASC OFFSET N LIMIT 8000` with no partial `(ico) WHERE "fsCount" >= 2` index, forcing a **Parallel Seq Scan + disk Sort** on the 2.2 GB `Company` table.
  3. `getCrossFirmPersons` (`frontend/src/components/cross-firm-persons.tsx`) executes **1 redundant query + up to 5 sequential N+1 queries** per firma SSR render (`1.37M` `CompanyPerson` index scans).
  4. `Company` carries **35 indexes totaling `902 MB`**, of which **17 indexes (`~334 MB`) have `idx_scan = 0`** (plus 4 unused/redundant indexes on `CompanyEvent`/`VestnikEvent`), bloating memory and slowing writes.

---

## 2. Measured Production Baseline (Read-Only)

### 2.1 Nginx Latency by Route Group (`467,254` requests, `verifa_perf.log` + `verifa_perf.log.1`)

`93,910` requests (`20.1%`) are Next.js `_rsc=` payloads.

| Route Group | Count | P50 (ms) | P95 (ms) | P99 (ms) | Max (ms) | Cache Breakdown |
|---|---:|---:|---:|---:|---:|---|
| `/{lang}/firma/...` | 135,623 | 201.0 | **6,941.9** | **25,329.3** | 300,004.0 | `MISS:68185, -:64084, STALE:2061, HIT:1293` |
| `/firma/[ico-slug]` | 134,100 | 120.5 | **5,281.0** | **23,427.1** | 300,004.0 | `MISS:41630, -:40732, STALE:29184, HIT:22554` |
| `other` | 135,437 | 49.0 | 1,503.0 | 5,137.3 | 218,584.0 | `-:128967, HIT:6470` |
| `/api/...` | 33,188 | 11.0 | 318.0 | 1,685.0 | 300,008.0 | `-:33188` |
| `/_next/...` | 9,664 | 58.0 | 1,828.9 | 5,668.5 | 12,844.0 | `-:9579, STALE:83, MISS:2` |
| `/firmy` | 9,328 | 345.0 | **6,480.0** | **22,419.6** | 300,001.0 | `-:9328` |
| `/ (home)` | 7,700 | 133.0 | 2,171.3 | 6,490.1 | 22,644.0 | `-:7700` |
| `/screener` | 2,101 | 129.0 | 1,247.0 | 4,244.0 | 18,375.0 | `-:2101` |
| `/sitemap*.xml` | 113 | **43,913.0** | **49,996.8** | **50,001.0** | 50,008.0 | `-:113` |

**Cache MISS latency only (pure origin SSR cost):**

| Route Group (MISS only) | Count | P50 (ms) | P95 (ms) | P99 (ms) | Max (ms) |
|---|---:|---:|---:|---:|---:|
| `/{lang}/firma/...` | 68,185 | **729.0** | **6,624.4** | **19,390.3** | 277,372.0 |
| `/firma/[ico-slug]` | 41,630 | **565.0** | **6,778.4** | **22,435.7** | 287,762.0 |

**Top API Sub-Routes:**

| API Route | Count | P50 (ms) | P95 (ms) | P99 (ms) | Max (ms) | Notes |
|---|---:|---:|---:|---:|---:|---|
| `/api/auth/session` | 32,827 | 11.0 | 287.0 | **1,441.0** | 16,161.0 | 98.9% of API volume; periodic DB verify |
| `/api/companies/:id/live-check` | 165 | 85.0 | **1,781.4** | **3,734.1** | 4,674.0 | Live check + DB read |
| `/api/reports/recover-stuck` | 116 | 548.0 | **10,400.0** | **12,850.5** | 14,860.0 | Cron with N+1 loop on failed reports |
| `/api/cron/orsr-refresh` | 14 | **210,199.0** | **278,522.2** | **295,710.8** | 300,008.0 | Synchronous 500-company loop w/ per-row DB lookup |
| `/api/companies/search` | 12 | 153.5 | **3,004.9** | **5,038.6** | 5,547.0 | `ILIKE` trigram + `ORDER BY latestRevenue DESC` |

### 2.2 PostgreSQL Stats (`verifa_postgres`)

- **Host:** 2 vCPU, `7.8 GiB` RAM (`6.1 GiB` used, `2.1 GiB` swap in use). Container limit `3 GiB` (`1.14 GiB` used).
- **Config:** `shared_buffers = 384MB`, `work_mem = 4MB`, `effective_cache_size = 1GB`, `max_connections = 100`, `random_page_cost = 4`, `shared_preload_libraries = pgaudit` (**no `pg_stat_statements`**).
- **Extensions:** `plpgsql 1.0`, `pg_trgm 1.6`, `unaccent 1.1`.
- **Buffer Cache Hit Ratio:** **`69.76%`** (`blks_hit = 2,889,710,798`, `blks_read = 1,252,509,172`, `numbackends = 33`).

| Table | Est. Rows | Heap Size | Index Size | Total Size | `seq_scan` | `seq_tup_read` | `idx_scan` | `idx_tup_fetch` |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| `Company` | 721,910 | 2,221 MB | **902 MB** | **3,134 MB** | 162 | **34,242,106** | 2,850,532 | **5,272,409,763** |
| `FinancialStatement` | 1,357,140 | 900 MB | 231 MB | 1,132 MB | 26 | **13,571,660** | 337,655 | 3,201,011 |
| `CompanyPerson` | 1,298,650 | 350 MB | 255 MB | 604 MB | 2 | 2,566,142 | 1,417,736 | 10,358,626 |
| `VestnikEvent` | 4,762 | 3.2 MB | 800 kB | 4.1 MB | 7 | 33,334 | 337,625 | 3,609 |
| `CompanyEvent` | 1,207 | 488 kB | 312 kB | 840 kB | 7 | 8,757 | 337,841 | 10,800 |
| `FirmyFilterOptions` | 1 | 16 kB | 0 B | 16 kB | 1,820 | 1,820 | — | — |
| `AuditVerdict` | 68 | 152 kB | 32 kB | 656 kB | 81 | 5,994 | 0 | 0 |

### 2.3 Redis Stats (`verifa_redis`)

- **Memory:** `used_memory_human = 1.76M` / `maxmemory_human = 400.00M` (**0.44% utilization**), policy `allkeys-lru`.
- **Keyspace:** `db0: keys=1` (`arq:queue:health-check`), `db1: keys=2`.
- **Hit Ratio:** **`0.81%`** (`keyspace_hits = 232,778`, `keyspace_misses = 28,667,475`, `total_commands_processed = 75.38M`, `8 ops/s`).
- **What is cached:** Only ARQ worker queue metadata and ephemeral `ratelimit:*` keys (from `frontend/src/lib/rateLimit.ts`). **Zero** SSR/API query caching uses Redis.

---

## 3. Findings Ordered by Severity

### [P0 — Critical] 1. `RelatedFirms` Causes 5.27B Heap Fetches & 23.4B Index Tuple Reads on Every Firma SSR

- **Location:** [related-firms.tsx](file:///Users/dusanbaran/.gemini/antigravity/worktrees/2b999ff4-b70a-4525-bbf6-3a8298bf3258/subagent-Stream-4-Backend-Performance-Analyst-self-8c4d4af6/frontend/src/components/related-firms.tsx#L32-L95)
- **Measured Evidence:**
  - `EXPLAIN` for `getRelatedByNaceInKraj`:
    ```text
    Limit (cost=0.42..5726.74 rows=6 width=53)
      -> Index Scan Backward using "Company_latestRevenue_idx" on "Company" (cost=0.42..1201571.15 rows=1259)
           Index Cond: ("latestRevenue" IS NOT NULL)
           Filter: (("fsCount" >= 1) AND ("naceCode" = '62010') AND (kraj = 'SK010'))
    ```
  - `Company_kraj_idx`: `295,376` scans reading **`23,392,878,613`** index tuples (~79,197/scan).
  - `Company_naceCode_revenue_idx`: `435,592` scans reading **`1,967,234,560`** index tuples.
  - `Company_latestRevenue_idx`: `247,524` scans fetching **`398,731,391`** heap rows.
- **Root Cause:** No composite partial index exists for `("naceCode", kraj, "latestRevenue" DESC NULLS LAST) WHERE "fsCount" >= 1 AND "latestRevenue" IS NOT NULL`. Moreover, `RelatedFirms` runs 3 parallel DB queries on every cache-miss `/firma/*` render even though the top-7 firms per `(naceCode, kraj)`, `(naceCode)`, and `(city)` are shared across thousands of companies.
- **Fix:**
  1. Add partial composite indexes on `Company` (draft SQL in §4.2).
  2. Cache `related:nace-kraj:{nace}:{kraj}`, `related:nace:{nace}`, and `related:city:{city}` (`take: 7`, filter `ico !== currentIco` in memory) in **Redis with 6h TTL** (+ in-process LRU fallback).
- **Estimated Gain:** **-60% to -80% origin SSR latency** on `/firma/*` & `/{lang}/firma/*` cache misses (P50 `565–729 ms` -> `~120–180 ms`, P95 `6.7s` -> `<1.2s`), and **>85% reduction** in Postgres heap reads.

---

### [P0 — Critical] 2. `/sitemap/[id].xml` Triggers Parallel Seq Scan + Disk Sort (43.9s–50.0s, HTTP 499 & Empty XML)

- **Location:** [route.ts](file:///Users/dusanbaran/.gemini/antigravity/worktrees/2b999ff4-b70a-4525-bbf6-3a8298bf3258/subagent-Stream-4-Backend-Performance-Analyst-self-8c4d4af6/frontend/src/app/sitemap/[id]/route.ts#L165-L189)
- **Measured Evidence:**
  - Nginx `/sitemap*.xml`: **P50 `43.9s`, P95 `50.0s`, P99 `50.0s`**. Bingbot requests repeatedly fail with **HTTP 499** at `49.7–50.0s` or receive **`200 153 bytes`** (empty `<urlset></urlset>` because the `catch` block silently returns `entries = []` on DB timeout!).
  - `EXPLAIN` for `OFFSET 200000 LIMIT 8000`:
    ```text
    Limit (cost=331356.25..332289.65 rows=8000)
      -> Gather Merge (cost=308021.29..345751.12 rows=323376)
           -> Sort (Sort Key: ico)
                -> Parallel Seq Scan on "Company" (Filter: "fsCount" >= 2)
    ```
  - Also selects `auditVerdict: { select: { createdAt: true } }` which triggers a separate query over `AuditVerdict` (`seq_scan = 81`).
- **Fix:**
  1. Add partial index: `CREATE INDEX CONCURRENTLY "Company_sitemap_fs2_ico_idx" ON "Company" (ico ASC) WHERE "fsCount" >= 2;` (enables Index-Only / Index Scan without seq scan or sort).
  2. Cache generated sitemap XML per `sitemapId` in **Redis (TTL 6h)** or pre-generate static chunks on disk/Redis via cron.
  3. Drop `auditVerdict` join from `sitemap/[id]` (`ruzSyncedAt ?? updatedAt` is already non-null for all synced companies).
  4. Never silently return HTTP `200` empty `<urlset>` on DB error — return `503` so crawlers retry instead of de-indexing URLs.
- **Estimated Gain:** `/sitemap/[id].xml` P50 **`43,913 ms` -> `<50 ms`** (Redis HIT) / **`<400 ms`** (cold DB miss); eliminates `Company` parallel seq scans and Bingbot/Googlebot 499 failures.

---

### [P0 — Critical] 3. `getCrossFirmPersons` N+1 Query Loop on Every Firma SSR Render

- **Location:** [cross-firm-persons.tsx](file:///Users/dusanbaran/.gemini/antigravity/worktrees/2b999ff4-b70a-4525-bbf6-3a8298bf3258/subagent-Stream-4-Backend-Performance-Analyst-self-8c4d4af6/frontend/src/components/cross-firm-persons.tsx#L29-L82), called from [firma-page.tsx](file:///Users/dusanbaran/.gemini/antigravity/worktrees/2b999ff4-b70a-4525-bbf6-3a8298bf3258/subagent-Stream-4-Backend-Performance-Analyst-self-8c4d4af6/frontend/src/components/firma-page.tsx#L240)
- **Measured Evidence:**
  - `firma-page.tsx` already loads `company.companyPersons` via `getCompanyData(ico)`, yet `getCrossFirmPersons(company.ico)` re-queries `CompanyPerson` (`624,851` scans on `CompanyPerson_companyIco_isActive_idx`), then loops over up to 5 persons issuing **up to 5 sequential `await prisma.companyPerson.findMany(...)` queries** with a `Company` join (`748,533` scans on `CompanyPerson_cleanName_city_isActive_role_idx`).
- **Fix:**
  1. Pass already-loaded `company.companyPersons` into `getCrossFirmPersons(ico, company.companyPersons)` (removes 1 query immediately).
  2. Replace the `for` loop with a **single batched query** using `OR: candidates.map(p => ({ cleanName: p.cleanName, ...(p.city ? { city: p.city } : {}) }))` with `take: 15`, then deduplicate in memory.
  3. Run `getCrossFirmPersons` in parallel (`Promise.all`) with `RelatedFirms` rather than blocking `RelatedFirms` sequentially.
- **Estimated Gain:** Reduces DB round-trips per firma SSR by **5 queries** (from up to 6 -> 1), cutting `CompanyPerson` query volume by **~75%** and saving `40–150 ms` on every cache-miss render.

---

### [P1 — High] 4. PostgreSQL Memory Starvation (`69.76%` Buffer Hit Ratio) & 21 Unused Indexes (`~340 MB`)

- **Measured Evidence:**
  - `shared_buffers = 384MB`, `work_mem = 4MB`, `effective_cache_size = 1GB`, `random_page_cost = 4`, `blks_hit` ratio = **`69.76%`** (`1.25B` disk reads!).
  - `Company` has **17 unused indexes (`idx_scan = 0`) totaling `~334 MB`**, plus 4 unused indexes on `CompanyEvent`/`VestnikEvent`:
    - Largest unused on `Company`: `Company_latestAssets_idx` (60 MB), `Company_latestAssets_desc_nulls_last_idx` (29 MB), `Company_latestEquity_desc_nulls_last_idx` (26 MB), `Company_status_idx` (26 MB), `Company_legalForm_idx` (23 MB), `Company_name_idx` (23 MB), `Company_city_idx` (22 MB), `Company_ruzSyncedAt_idx` (20 MB), `Company_sizeCategoryNormalized_idx` (20 MB), `Company_statusNormalized_idx` (18 MB), `Company_establishedAt_idx` (14 MB), `Company_ruzReportingStatus_idx` (14 MB), `Company_vestnikSyncedAt_idx` (13 MB), `Company_legalStatus_idx` (13 MB), `Company_latestYear_idx` (5.9 MB), `Company_ownershipType_idx` (5.7 MB), `Company_establishedAt_desc_nulls_last_idx` (4.4 MB).
    - Redundant single-column indexes already covered by leading column of composites: `CompanyEvent_companyIco_idx`, `VestnikEvent_companyIco_idx`.
  - `pg_stat_statements` is not in `shared_preload_libraries`.
- **Fix (in maintenance window — NOT applied now):**
  1. Tune Postgres (inside `3 GiB` container limit): `shared_buffers = 1GB`, `effective_cache_size = 2GB`, `work_mem = 16MB`, `random_page_cost = 1.1`, `shared_preload_libraries = 'pgaudit,pg_stat_statements'`.
  2. Drop verified-unused/redundant indexes (`DROP INDEX CONCURRENTLY`) after confirming no screener/cron regression, reclaiming `~340 MB` of index pages and accelerating ORSR/RUZ bulk upserts.
- **Estimated Gain:** Lifts Postgres buffer cache hit ratio from **`69.76%` -> `>97%`**, eliminates disk sorts (`work_mem = 16MB`), and gives full query-level observability via `pg_stat_statements`.

---

### [P1 — High] 5. `/firmy` & Hub Pages: Uncached (`cache=-`), Missing `fsCount >= 2` Composite Indexes, 4 Sequential Queries

- **Location:** [hub.ts](file:///Users/dusanbaran/.gemini/antigravity/worktrees/2b999ff4-b70a-4525-bbf6-3a8298bf3258/subagent-Stream-4-Backend-Performance-Analyst-self-8c4d4af6/frontend/src/lib/hub.ts#L150-L293), [firmy.ts](file:///Users/dusanbaran/.gemini/antigravity/worktrees/2b999ff4-b70a-4525-bbf6-3a8298bf3258/subagent-Stream-4-Backend-Performance-Analyst-self-8c4d4af6/frontend/src/lib/firmy.ts#L136-L160)
- **Measured Evidence:**
  - `/firmy` (9,328 reqs): **P50 `345.0 ms` / P95 `6,480.0 ms` / P99 `22,419.6 ms`**, `cache=-` (zero nginx caching).
  - `hub.ts:152` comments claim `Uses composite indexes (kraj, fsCount, latestRevenue DESC)`, but **no such indexes exist** in `pg_indexes`! Only `(kraj, latestRevenue DESC)` exists without `fsCount >= 2`, forcing Postgres to bitmap-intersect with `Company_fsCount_idx` (`9.24B` index tuples read!).
  - `queryHubCompanies` + `getHubStats` execute **4 sequential queries** (`SELECT ... LIMIT 50`, `SELECT COUNT(*)`, `getSubHubs` `GROUP BY`, `SUM/COUNT(DISTINCT city)`).
- **Fix:**
  1. Add partial composite indexes with `WHERE "fsCount" >= 2` for `(kraj, "latestRevenue" DESC NULLS LAST)`, `(okres, "latestRevenue" DESC NULLS LAST)`, and `(city, "latestRevenue" DESC NULLS LAST)`.
  2. Cache `getHubStats`, `getSubHubs`, and `getHubCompanyCount` in **Redis (TTL 6h)** — hub aggregates change only on daily/weekly RUZ syncs.
  3. Run `companies`, `count`, `subHubs`, and `stats` via `Promise.all` on cache miss.
- **Estimated Gain:** `/firmy` & hub pages P50 **`345 ms` -> `<40 ms`** (Redis HIT), P95 **`6,480 ms` -> `<500 ms`**.

---

### [P1 — High] 6. Localized `/{lang}/firma/...` Has `0.95%` Cache Hit Rate vs `38.6%` on `/firma/[ico-slug]`

- **Measured Evidence:**
  - `/{lang}/firma/...` receives **135,623 requests** (more than SK `/firma/[ico-slug]`'s 134,100!), yet has only `1,293` HITs (`0.95%`), `68,185` MISSes, and `64,084` uncached (`-`).
  - Every MISS triggers a full SSR render (`P50 729 ms`, `P95 6,624 ms`, `P99 19,390 ms`) and hits Postgres with up to 14 queries — **multiplying DB load by 6x** across languages (`en`, `de`, `cs`, `hu`, `pl`, `sk`) for the exact same underlying `Company` row!
- **Fix:**
  1. Cache the raw DB payload of `getCompanyData(ico)` in **Redis (TTL 1–6h)** keyed by `company:v1:{ico}` (language-independent!). Even when nginx misses on `/de/firma/123` right after `/en/firma/123`, origin SSR hits Redis in `<2 ms` instead of running 5+ Postgres queries.
  2. Coordinate with ISR/nginx cache tuning (owned outside Stream 4) to investigate why `64,084` requests had `cache=-` (likely `_rsc=` query params or `Set-Cookie`/Vary headers bypassing nginx proxy_cache).
- **Estimated Gain:** Eliminates **~80–90% of `Company`/`FinancialStatement`/`VestnikEvent`/`CompanyEvent` DB queries** caused by multi-language crawlers.

---

### [P2 — Medium] 7. N+1 Queries in Cron Endpoints & Worker DB Repository

1. **`/api/reports/recover-stuck` ([route.ts](file:///Users/dusanbaran/.gemini/antigravity/worktrees/2b999ff4-b70a-4525-bbf6-3a8298bf3258/subagent-Stream-4-Backend-Performance-Analyst-self-8c4d4af6/frontend/src/app/api/reports/recover-stuck/route.ts#L102-L121)) — P95 `10.4s`, P99 `12.85s`:**
   - Loops over up to `100` `FAILED` reports and runs **2 sequential `prisma.walletTransaction.findFirst` queries per report** (up to 200 queries/run).
   - **Fix:** Single query `prisma.walletTransaction.findMany({ where: { reportRequestId: { in: ids }, type: { in: ["CHARGE", "REFUND"] } } })` and group in a `Map`.
2. **`/api/cron/orsr-refresh` ([route.ts](file:///Users/dusanbaran/.gemini/antigravity/worktrees/2b999ff4-b70a-4525-bbf6-3a8298bf3258/subagent-Stream-4-Backend-Performance-Analyst-self-8c4d4af6/frontend/src/app/api/cron/orsr-refresh/route.ts#L46-L86)) — P50 `210.2s`, Max `300s`:**
   - Selects only `{ ico, orsrSyncedAt }` in the initial batch query, then executes `prisma.company.findUnique` inside the 500-item loop to fetch `oldCompany` fields (500 redundant queries) while holding an HTTP request open for 3.5–5 minutes.
   - **Fix:** Include `status, shareCapital, signingAuthority, businessActivity, legalStatus` in the initial `findMany` `select`, and consider offloading long refresh batches to the ARQ worker queue.
3. **Worker `db_repository.py` ([db_repository.py](file:///Users/dusanbaran/.gemini/antigravity/worktrees/2b999ff4-b70a-4525-bbf6-3a8298bf3258/subagent-Stream-4-Backend-Performance-Analyst-self-8c4d4af6/worker/src/db_repository.py#L118-L147), [L680-L706](file:///Users/dusanbaran/.gemini/antigravity/worktrees/2b999ff4-b70a-4525-bbf6-3a8298bf3258/subagent-Stream-4-Backend-Performance-Analyst-self-8c4d4af6/worker/src/db_repository.py#L680-L706), [L940-L997](file:///Users/dusanbaran/.gemini/antigravity/worktrees/2b999ff4-b70a-4525-bbf6-3a8298bf3258/subagent-Stream-4-Backend-Performance-Analyst-self-8c4d4af6/worker/src/db_repository.py#L940-L997)):**
   - `save_company_events_to_db`, `save_company_persons`, `upsert_report_sources`, and `update_source_page_counts` execute row-by-row `INSERT`/`UPDATE` inside Python `for` loops.
   - **Fix:** Batch `INSERT ... VALUES ... ON CONFLICT DO NOTHING` / `create_many` / `UPDATE ... FROM (VALUES ...)` for multi-row writes.
4. **Minor SSR redundancy (`firma-page.tsx:572, 581`):** `computeFinancialIndicators(stmts)` is computed twice synchronously; hoist to a single `const indicators = computeFinancialIndicators(stmts)`.

---

## 4. Concrete Optimization Roadmap & SQL Index Draft

### 4.1 Prioritized Implementation Plan

| Priority | Optimization | Target Files / Layer | Est. Latency Impact | Est. DB Load Impact |
|---|---|---|---|---|
| **1 (P0)** | Partial composite indexes for `RelatedFirms`, `Sitemap`, and `Hub` queries | SQL migration (`CONCURRENTLY`) | Sitemap P50 `43.9s -> <0.4s`; Firma MISS P95 `6.7s -> <1.5s` | **-80% heap & index tuple reads** |
| **2 (P0)** | Redis cache layer (`company:v1:{ico}`, `related:*`, `hub:*`, `sitemap:*`) using existing 400 MB `verifa_redis` | `frontend/src/lib/cache.ts` (new) + `ruz.ts`, `related-firms.tsx`, `hub.ts`, `sitemap/[id]/route.ts` | Firma MISS P50 `565–729ms -> <120ms`; `/firmy` P50 `345ms -> <40ms`; Redis hit ratio `0.81% -> >80%` | **-85% Postgres read QPS** |
| **3 (P0)** | Eliminate `getCrossFirmPersons` N+1 loop + pass preloaded `companyPersons` | `frontend/src/components/cross-firm-persons.tsx`, `firma-page.tsx` | `-40 to -150 ms` per firma MISS | **-75% `CompanyPerson` queries** |
| **4 (P1)** | Tune PostgreSQL (`shared_buffers=1GB`, `work_mem=16MB`, `random_page_cost=1.1`, enable `pg_stat_statements`) + drop 19–21 unused indexes (`~340 MB`) | Postgres config / migration | Global P95/P99 tail reduction (`30–50%`) | Buffer hit ratio `69.76% -> >97%` |
| **5 (P2)** | Batch N+1 queries in `/api/reports/recover-stuck`, `/api/cron/orsr-refresh`, and `worker/src/db_repository.py` | API cron routes + worker repo | `recover-stuck` P95 `10.4s -> <0.5s` | Removes cron lock/pool spikes |

### 4.2 Proposed Index Migration Draft (**DO NOT RUN AUTOMATICALLY — Maintenance Window Only**)

All `CREATE INDEX CONCURRENTLY` / `DROP INDEX CONCURRENTLY` statements must be executed **outside a transaction block** (not inside Prisma's default transactional migration wrapper) during a low-traffic window:

```sql
-- 1. RelatedFirms: eliminates 398M heap fetches & 23.4B kraj index reads
CREATE INDEX CONCURRENTLY IF NOT EXISTS "Company_nace_kraj_fs1_rev_idx"
  ON "Company" ("naceCode", kraj, "latestRevenue" DESC NULLS LAST)
  WHERE "fsCount" >= 1 AND "latestRevenue" IS NOT NULL;

CREATE INDEX CONCURRENTLY IF NOT EXISTS "Company_nace_fs1_rev_idx"
  ON "Company" ("naceCode", "latestRevenue" DESC NULLS LAST)
  WHERE "fsCount" >= 1 AND "latestRevenue" IS NOT NULL;

CREATE INDEX CONCURRENTLY IF NOT EXISTS "Company_city_fs1_rev_idx"
  ON "Company" (city, "latestRevenue" DESC NULLS LAST)
  WHERE "fsCount" >= 1 AND "latestRevenue" IS NOT NULL AND city IS NOT NULL AND city <> '';

-- 2. Sitemap pagination: eliminates 44-50s Parallel Seq Scan + Sort
CREATE INDEX CONCURRENTLY IF NOT EXISTS "Company_fs2_ico_idx"
  ON "Company" (ico ASC)
  WHERE "fsCount" >= 2;

-- 3. Hub pages (/firmy, /kraj, /okres): matches WHERE "fsCount" >= 2 ORDER BY "latestRevenue" DESC
CREATE INDEX CONCURRENTLY IF NOT EXISTS "Company_kraj_fs2_rev_idx"
  ON "Company" (kraj, "latestRevenue" DESC NULLS LAST)
  WHERE "fsCount" >= 2 AND kraj IS NOT NULL;

CREATE INDEX CONCURRENTLY IF NOT EXISTS "Company_okres_fs2_rev_idx"
  ON "Company" (okres, "latestRevenue" DESC NULLS LAST)
  WHERE "fsCount" >= 2 AND okres IS NOT NULL;

-- 4. Candidate unused/redundant index drops (~340 MB reclaimed) — verify after 7d with pg_stat_statements:
-- DROP INDEX CONCURRENTLY IF EXISTS "Company_latestAssets_idx";
-- DROP INDEX CONCURRENTLY IF EXISTS "Company_status_idx";
-- DROP INDEX CONCURRENTLY IF EXISTS "Company_statusNormalized_idx";
-- DROP INDEX CONCURRENTLY IF EXISTS "Company_city_idx";
-- DROP INDEX CONCURRENTLY IF EXISTS "Company_legalForm_idx";
-- DROP INDEX CONCURRENTLY IF EXISTS "Company_name_idx";
-- DROP INDEX CONCURRENTLY IF EXISTS "CompanyEvent_companyIco_idx";
-- DROP INDEX CONCURRENTLY IF EXISTS "VestnikEvent_companyIco_idx";
```

---

## 5. Risks & Open Questions

1. **VPS RAM headroom (`7.8 GiB` total, `2.1 GiB` swap in use):** Increasing Postgres `shared_buffers` to `1GB` requires verifying total host memory across co-hosted services (`verifa_browserless`, `premarket-redis`, `verifa_frontend`). Measure `free -h` and swap pressure before raising `shared_buffers` above `768MB–1GB`.
2. **Prisma `CONCURRENTLY` migrations:** Prisma executes `migration.sql` inside a transaction by default, which rejects `CREATE INDEX CONCURRENTLY`. New indexes should be applied via an explicit non-transactional `psql` ops script (or `--create-only` + manual apply + `prisma migrate resolve`).
3. **Redis memory budget & key eviction:** `verifa_redis` is shared with the ARQ job queue (`db0`). Application cache keys should live in **`db1` or a dedicated key prefix with explicit TTLs** — OR use a separate Redis instance/policy so `allkeys-lru` eviction can **never** evict active ARQ job keys! (Currently `maxmemory-policy = allkeys-lru` on a queue broker is itself a latent reliability risk if cache ever fills 400 MB; switch to `volatile-lru` and ensure ARQ queue keys have no TTL, or isolate cache DB/instance.)
4. **Why `64,084` `/{lang}/firma/...` and `40,732` `/firma/[ico-slug]` requests logged `cache=-`:** Likely `_rsc=` query strings or nginx `location` / `proxy_cache` bypass rules (outside Stream 4's file ownership — coordinate with the Nginx/ISR stream).
5. **Why `pg_stat_user_tables.n_live_tup` showed `0`/`1`:** Stats counters appear to have been reset or autovacuum/analyze has not updated `n_live_tup` on `Company`/`FinancialStatement` recently; verify autovacuum logs before relying on `n_live_tup` (use `pg_class.reltuples` instead).

---

## 6. Reproducible Profiling Tooling

A zero-dependency, strictly read-only profiler and its unit test suite are included in `scripts/perf/`:

- **Profiler:** [profile_perf.py](file:///Users/dusanbaran/.gemini/antigravity/worktrees/2b999ff4-b70a-4525-bbf6-3a8298bf3258/subagent-Stream-4-Backend-Performance-Analyst-self-8c4d4af6/scripts/perf/profile_perf.py)
  ```bash
  # Analyze nginx logs (supports plain and .gz)
  python3 scripts/perf/profile_perf.py /var/log/nginx/verifa_perf.log /var/log/nginx/verifa_perf.log.1

  # JSON output for dashboards / CI comparisons
  python3 scripts/perf/profile_perf.py --json /var/log/nginx/verifa_perf.log*

  # Print read-only PostgreSQL + Redis diagnostic commands
  python3 scripts/perf/profile_perf.py --print-readonly-sql
  ```
- **Unit Tests:** [test_profile_perf.py](file:///Users/dusanbaran/.gemini/antigravity/worktrees/2b999ff4-b70a-4525-bbf6-3a8298bf3258/subagent-Stream-4-Backend-Performance-Analyst-self-8c4d4af6/scripts/perf/test_profile_perf.py)
  ```bash
  python3 -m unittest -v scripts/perf/test_profile_perf.py
  ```
