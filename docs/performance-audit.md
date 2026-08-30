# Performance Audit — Verifa.sk (2026-08-30)

Komplexný audit celej aplikácie: DB, API routes, page rendering, bundle, middleware, worker, infra.

---

## P0 — Kritické (okamžite opraviť)

### 1. `headers()` v `(main)/layout.tsx` blokuje statické renderovanie
- **Súbor:** `frontend/src/app/(main)/layout.tsx:9,19`
- **Problém:** `await headers()` v `generateMetadata` aj v default exporte. Každá stránka v `(main)` route group (dashboard, firmy, screener, legal pages, slovník) je force-dynamic.
- **Dopad:** Žiadna stránka v `(main)` nie je edge-cachable. Legal pages (terms, privacy, dpa — 500-1100 riadkov statického textu) sa renderujú pri každom requeste.
- **Fix:** Odvodiť `lang` z URL path (ako už robia `(pub-*)` route groups). Zrušiť `headers()` v `(main)/layout.tsx`.

### 2. Middleware DB fetch na každý `/firma/` request
- **Súbor:** `frontend/src/middleware.ts:97-103`
- **Problém:** Pre každý `/firma/{ico}*` request middleware volá `fetch("http://localhost:3000/api/internal/company-slug/{ico}")` → ďalší HTTP request + Prisma `findUnique`. Žiaden cache.
- **Dopad:** TTFB firmy page = 2x HTTP + 2x DB query. Pri Google crawle 500K+ firiem = 1M+ zbytočných DB dotazov.
- **Fix:** Pridať `cache: "force-cache"` na middleware fetch + `Cache-Control` na API route. Alebo cacheovať slug lookup v Redis/`unstable_cache`.

### 3. Unbounded `company.findMany` v cron/reseed-all
- **Súbory:** `frontend/src/lib/vestnik.ts:329`, `vestnik-backfill.ts:172`, `api/cron/reseed-all/route.ts:14`
- **Problém:** `prisma.company.findMany({ select: { ico: true } })` bez `where`, `take`, `skip` — načíta všetkých 518K+ firiem do Node memory.
- **Dopad:** OOM / ~500MB+ heap, 10-30s freeze, pool saturation.
- **Fix:** Paginovať cez `take`/`skip` alebo cursor. Spracovávať v batchoch 50-100 firiem.

### 4. Stripe webhook čaká na email + DB pred 200 response
- **Súbor:** `frontend/src/app/api/billing/webhook/route.ts:126-194`
- **Problém:** `charge.refunded` handler `await`-uje `sendEmail` (admin + user) pred návratom `200`. Stripe vyžaduje rýchlu odpoveď.
- **Dopad:** Pomalé webhooky → Stripe retry → duplikátné eventy → potenciálne disable webhooku.
- **Fix:** Vrátiť `200` po signature validation + DB commit. Email poslať asynchrónne (`waitUntil`, queue, `setImmediate`).

### 5. Admin broadcast — synchrónne emaily bez limitu
- **Súbor:** `frontend/src/app/api/admin/messages/route.ts:128-147`
- **Problém:** `for (const u of users) { await sendEmail(...) }` cez všetkých verified userov. Žiaden queue, žiaden batch, žiaden rate limit.
- **Dopad:** Pri tisícoch userov → server hang, mail provider quota exhaustion, partial failure bez rollback.
- **Fix:** Resend batch endpoint `/emails/batch` (100 naraz). Alebo push do background worker queue.

---

## P1 — Vysoká priorita

### DB

| # | Súbor | Problém | Fix |
|---|---|---|---|
| 6 | `dashboard/[ico]/page.tsx:27-38` | `findUnique` s `include` bez `take` — načíta všetky FS + auditor opinions + vestnik events | Pridať `take: 5` na relations, `select` len potrebné stĺpce |
| 7 | `api/company/[ico]/route.ts:28-38` | API vracia všetky financial statements bez `take` | `take: 10`, `select` potrebné polia, `Cache-Control: private, max-age=300` |
| 8 | `api/cron/monitoring-check/route.ts:34-106` | N+1: loop cez watched companies → per-company queries → per-watcher creates | Batch `findMany` + `createMany` |
| 9 | `lib/credits.ts:39-209` | Long `$transaction` s `SELECT * FOR UPDATE` + per-row update loop | `SELECT` len potrebné stĺpce, batch updates, kratšie locky |
| 10 | `lib/orsr.ts:495-539` | `$transaction` drží Company row lock počas `deleteMany` + `createMany` CompanyPerson | Presunúť parsing/HTTP mimo tx, len DB writes v tx |

### Chýbajúce indexy

| # | Stĺpec | Model | Query |
|---|---|---|---|
| 11 | `latestYear` | Company | Screener filter (518K rows, seq scan) |
| 12 | `ownershipType` | Company | Screener filter |
| 13 | `companyIco, eventDate` | CompanyEvent | monitoring-check cron |
| 14 | `companyIco, publishedAt` | VestnikEvent | firma page orderBy |
| 15 | `companyIco, createdAt` | CompanyEvent | firma page orderBy |
| 16 | `alertId` | AlertDelivery | alert-events API |
| 17 | `subscriptionStatus` | User | credits/expire cron |

### Connection pool

| # | Problém | Fix |
|---|---|---|
| 18 | `connection_limit=15` v docker-compose, `max_connections=50` v Postgres | Zvýšiť na 30-40, alebo PgBouncer |

### Caching

| # | Súbor | Problém | Fix |
|---|---|---|---|
| 19 | `dashboard/[ico]/page.tsx` | Ťažký `findUnique` s relations, uncached | `unstable_cache` s tag `company-{ico}` |
| 20 | `lib/hub.ts:152-211` | `queryHubCompanies` — raw COUNT + SELECT na 518K tabuľke, len ISR 3600 | `unstable_cache` s dlhším TTL |
| 21 | `api/internal/company-slug/[ico]` | Volaný z middleware na každý firma request, uncached | `Cache-Control: private, max-age=86400` |

### API routes

| # | Súbor | Problém | Fix |
|---|---|---|---|
| 22 | `api/company/[ico]/route.ts` | Žiaden rate limit, žiaden Cache-Control, veľký payload | Rate limit + cache + `take` |
| 23 | `api/messages/route.ts` GET | Žiaden rate limit | `rateLimitByKey("messages:${user.id}")` |
| 24 | `api/admin/messages/route.ts` POST | Žiaden Zod validation, žiaden rate limit | Zod schema + rate limit |

### Worker

| # | Problém | Fix |
|---|---|---|
| 25 | `enqueueReportTask` — 8s timeout, žiaden retry | Env var timeout + 2-3 retries s backoff |
| 26 | `checkWorkerHealth` — 2s timeout na každý report request | Cache health status na 5-10s |
| 27 | Worker down = permanent FAIL, žiaden queue | PENDING state + retry cron alebo message broker |

### Email

| # | Problém | Fix |
|---|---|---|
| 28 | `sendEmail` — žiaden HTTP timeout na Resend API | `AbortSignal.timeout(5000)` |
| 29 | `sendEmail` — DB read pre bounce/complain check pri každom email | Cache bounced/complained user list |

### Infrastructure

| # | Problém | Fix |
|---|---|---|
| 30 | `frontend` mem_limit=512MB | Zvýšiť na 1g |
| 31 | Žiaden `NODE_OPTIONS=--max-old-space-size` | Pridať do Dockerfile (build) + docker-compose (runtime) |
| 32 | `REDIS_URL` chýba v `frontend` env | Pridať `redis://:${REDIS_PASSWORD}@redis:6379/0` |
| 33 | `FinancialChart` eager import na dashboarde → Recharts v initial JS | `dynamic()` import s loading skeleton |

---

## P2 — Stredná priorita

### Page rendering
- `(main)/slovnik/[slug]/page.tsx` — `generateStaticParams` existuje ale `headers()` v `generateMetadata` blokuje SSG
- Legal pages (terms, privacy, dpa, refund) — `headers()` robí 500-1100 riadkové statické stránky dynamic
- `dashboard/page.tsx`, `firmy/page.tsx`, `screener/page.tsx` — žiaden Suspense, user čaká na najpomalší query
- Admin pages — `"use client"` + server-side Prisma/getServerSession mix (možný build bug)

### Bundle
- 104 `"use client"` súborov — mnoho sú statické landing sekcie čo len volajú `useT()`
- `ToasterProvider` eager import v root-shell
- `import * as Sentry` v 9 súboroch — named imports + `bundleSizeOptimizations`
- `ioredis` cez `eval('require')` hack — `serverExternalPackages` namiesto

### DB
- `lib/ruz.ts:457-465` — per-statement `upsert` v loope (10-20 sequential round-trips)
- 8x `findUnique` bez `select` (auth, reports, download, cancel) — zbytočne načíta full row
- Screener `q` filter — `LIKE '%...%'` na 518K rows, B-tree index nepomáha → trigram GIN alebo tsvector

### Redis/Rate limiting
- `rateLimit.ts` — Upstash `fetch` bez `AbortSignal` timeout
- In-memory `Map` fallback — unbounded rast pod distributed scan
- Redis container — žiaden `maxmemory`, žiaden `mem_limit`

### Middleware
- Matcher neexcluduje `/sitemap/0.xml`, `/sitemap/1.xml`, ...
- `getToken` beží na každom requeste vrátane public `/firma/` pages

### Cron
- `reseed-all` — žiaden `maxDuration`, žiaden per-company timeout
- `vestnik-ingest` — žiaden persisted cursor (re-fetch pri timeout)
- `monitoring-check` — žiaden `maxDuration`, N+1 writes

---

## P3 — Nízka priorita

- `react-is` v dependencies, nepoužívaný
- `frontend` container — žiaden log rotation
- `browserless` — `latest` tag, žiaden healthcheck
- `next.config.mjs` — chýba `poweredByHeader: false`, `images.remotePatterns`
- Unused `Suspense` import v `credits/checkout/page.tsx`
- `api/health/route.ts` — `force-dynamic` je správne (DB ping)
- Presigned URL comment/code mismatch (60s vs 300s)

---

## Prioritizačná matica

```
VYSOKÝ DOPAD / NÍZKA NÁROČNOSŤ (urobiť hneď):
├── #2  Cache middleware company-slug fetch (1 riadok: cache: "force-cache")
├── #3  Pridať take na unbounded findMany (3 súbory, +take:100)
├── #4  Webhook: vrátiť 200 pred emailom (presunúť sendEmail za response)
├── #11-17 Pridať chýbajúce indexy (schema.prisma + migration)
├── #21 Cache-Control na api/internal/company-slug
├── #28 AbortSignal.timeout na sendEmail
├── #30-32 Docker: mem_limit, NODE_OPTIONS, REDIS_URL
└── #33 dynamic() import FinancialChart na dashboarde

VYSOKÝ DOPAD / VYSOKÁ NÁROČNOSŤ (naplánovať):
├── #1  Zrušiť headers() v (main)/layout.tsx → route group refactor
├── #5  Admin broadcast → batch/queue
├── #8  monitoring-check N+1 → batch queries
├── #9  credits.ts transaction optimization
├── #25-27 Worker retries + queue + health cache
└── #19-20 Cache dashboard + hub queries
```

---

*Audit vykonaný 4 paralelnými subagentmi nad celým codebase (242 prisma calls, 53 API routes, 47 pages, 20 layouts, middleware, docker-compose, next.config).*
