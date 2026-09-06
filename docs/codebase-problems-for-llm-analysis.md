# Verifa.sk / Scripta — Codebase Problem Analysis (for external LLM review)

**Date:** 2026-09-06
**Scope:** Static analysis findings from a quick full-codebase review, expanded with evidence for independent analysis.
**Stack:** Next.js 14.2.35 (App Router, standalone build) + Prisma/PostgreSQL + NextAuth v4 (JWT) | Python worker: FastAPI + ARQ + Playwright + Gemini LLM | Infra: Docker Compose on single VPS, nginx reverse proxy, Paddle billing, Resend email, S3 storage.

**Scale:** frontend ~58k LOC TS/TSX (51 API routes, 45 pages, 62+ components, 39 lib modules), worker ~42k lines Python (13 LLM agents, 33 scrapers, 50 test files). Test culture: 712 unit tests, 10 E2E suites, 50 worker test files.

**Recently fixed (context, do not re-analyze):** CVE-2025-29927 middleware bypass (upgraded to 14.2.35), Paddle webhook price_id authoritative validation, JSON-LD `</script>` XSS via safeJsonLd helper. All deployed and verified 2026-09-06.

---

## PROBLEM 1: Dead code and one-off scripts mixed into worker runtime package

**Location:** `worker/src/` (47 Python files total)

**Evidence:**
- `worker/src/celery_app.py` — Celery is NOT in `worker/requirements.txt` (only `arq>=0.26.0`), not referenced in Dockerfile or docker-compose. Zero imports anywhere. Dead file from early architecture.
- One-off operational scripts living in the importable `src/` package, zero references from production code:
  - `backfill_kraj_okres.py` (0 references)
  - `bulk_seed_orsr.py` (0 references)
  - `bulk_seed_orsr_v2.py` (0 references)
  - `bulk_scrape_orsr_ruz.py`
  - `benchmark_orsr_readonly.py`
  - `check_db.py` AND `check_db.js` (a JavaScript file inside Python source dir)
  - `orsr_continuous_sync_proposal.py`
- `worker/src/__pycache__/` exists on disk (not git-tracked, but shipped in image build context).

**Why it matters:**
1. `celery_app.py` misleads maintainers and any LLM-based tooling into thinking there are two queue systems. An agent asked to "add a background task" may target Celery, which is not installed at runtime → ImportError only discovered in production build.
2. One-off scripts in `src/` get bundled into the production Docker image (build context = whole `worker/`), increasing image size and attack surface (scripts contain direct DB credentials handling patterns).
3. `check_db.js` inside a Python package suggests copy-paste drift between tooling.

**Questions for analysis:** What is the safest refactor path (move to `worker/scripts/`, delete, or keep-with-guard)? Should there be a CI check preventing operational scripts in `src/`?

---

## PROBLEM 2: Repository root polluted with one-off AI-generated analysis reports and stray artifacts

**Location:** repo root

**Evidence (all git-tracked):**
```
ARCHITECTURE_DEBT_REPORT.md      (2026-07-21, one-off audit)
BUG_REPORT_WORKER_UNAVAILABLE.md
CODE_REVIEW_REPORT.md            (2026-07-15, one-off audit)
CREDIT_SYSTEM_REPORT.md
FOLLOWUP_ANALYSIS_REPORT.md
USER_ACCOUNT_CREDITS_REPORT.md
evidence_binder_final.pdf        (6.8 MB binary at repo root)
cta-preview/                     (screenshot PNGs: cta_desktop.png, ...)
backups/                         (schema_20260820_*.sql, verifa_*.dump, RUNBOOK)
```

**Why it matters:**
1. The `.md` reports are point-in-time audit snapshots. They already contradict current code (e.g. they describe pre-fix state of DB connection spam that was since resolved). Any LLM or human reading them as current documentation will draw wrong conclusions. They are stale by design and cannot be maintained.
2. `evidence_binder_final.pdf` (6.8 MB) at root is a generated artifact — it bloats every clone and every Docker build context that copies from root.
3. `backups/` contains a DB schema dump and a `.dump` file — potential data-protection concern if the dump contains any real personal data, and definitely not something that belongs in version control.

**Questions for analysis:** Which of these should be archived under `docs/archive/` vs deleted vs moved to artifact storage? Should `backups/` be audited for PII before removal from history (note: removing from git history requires history rewrite — is that justified)?

---

## PROBLEM 3: Silent exception swallowing at scale (74 empty catches frontend, ~105 bare `except: pass` worker)

**Location:** throughout; representative examples:

Frontend (`grep "catch {"`, non-test):
- `frontend/src/middleware.ts:120` — slug-lookup failure silently ignored (documented intent: "let the page render normally")
- `frontend/src/app/api/lookup/route.ts:34,68`
- `frontend/src/app/api/seed-company/[ico]/route.ts:140`
- `frontend/src/app/api/credits/route.ts:27`
- `frontend/src/app/sitemap/[id]/route.ts:84,163`

Worker (`except ...: pass` pattern):
- `worker/src/ruz_parser.py:679,692,704` — `except (ValueError, TypeError): pass` around financial value parsing
- `worker/src/verdict_builder.py:140,1265,1285,1321,1340,1368` — `except (json.JSONDecodeError, TypeError): pass` around LLM JSON parsing
- `worker/src/seed_ruz_bulk.py:179` — `except Exception: pass`

**Why it matters:**
1. In `ruz_parser.py` the swallowed exceptions are in the financial-data extraction path. A silently dropped value means a financial statement field becomes null instead of raising — downstream scoring (Altman/Beneish/Piotroski) then treats it as "missing data" and renormalizes. A systematic parsing regression would be invisible: reports would still generate, scores would just quietly degrade. There is no runtime metric counting parse failures.
2. In `verdict_builder.py`, JSON decode failures on LLM output are swallowed — the verdict silently loses sections instead of triggering the existing retry/fallback machinery.
3. A previous debt report (`ARCHITECTURE_DEBT_REPORT.md`, 2026-07-21) claims "9 exception handlers fixed" — the current count shows the pattern re-accumulated or was only partially addressed.

**Nuance:** Some empty catches are legitimately intentional (middleware slug fetch has a comment explaining fallback behavior). The problem is the *unclassified* majority: no log, no metric, no comment distinguishing "expected failure" from "bug".

**Questions for analysis:** Propose a classification scheme (expected/intentional vs bug-suspect) and a minimal-cost remediation (e.g. debug-level log + counter). Which of the two paths (financial parsing, verdict JSON) deserves hard fail + retry instead of swallow?

---

## PROBLEM 4: Two parallel i18n systems with duplicated translation payloads (frontend TS + worker Python)

**Location:**
- Frontend: `frontend/src/lib/i18n/{sk,en,de,cz,hu,pl}.ts` — 6 files × ~1,088–1,187 lines each (~6,600 lines total), typed via `types.ts`
- Worker: `worker/src/i18n.py` — 4,815 lines, 6 language blocks (`"sk":{...}` at line 32, `"en"` 888, `"de"` 1739, `"cz"` 2588, `"hu"` 3333, `"pl"` 4077), single accessor `get_i18n_strings(lang)` at line 4813

**Why it matters:**
1. ~11,400 lines of translation strings exist in two codebases with zero shared source of truth. The worker generates PDF report language; the frontend generates UI language. Terms that appear in both (report section names, verdict labels, legal disclaimer phrases) can drift — e.g. frontend says "Právny posudok" while the PDF says "Právna analýza" for the same concept.
2. Adding a 7th language requires editing 12+ files in two repos/containers with no completeness test (frontend has `i18n.test.ts` — need to verify it checks key parity across all 6 languages; worker has none).
3. The worker's `i18n.py` at 4,815 lines is the largest file in the codebase — a pure data file that dominates `wc -l` metrics and makes diffs noisy.

**Questions for analysis:** Is a shared JSON/YAML translation source (build-time generated into both TS and Python) worth the pipeline complexity at this team size? Or is the duplication acceptable with an added key-parity CI check? Verify whether `frontend/src/lib/i18n/types.ts` + `i18n.test.ts` actually enforce full key parity today.

---

## PROBLEM 5: God modules in the scoring/analytics core

**Location:**
- `worker/src/analytics.py` — 2,723 lines, single module containing: cash-flow sanitization, white-horse indicator, startup profile detection, Altman Z-score, financial ratios (~236 lines), Piotroski F-score, Beneish M-score, NACE weights, V2/V3 scorecard classes (`ScorecardPillar`, `ScorecardResult`, `ScorecardResultV3`)
- `worker/src/report_generator.py` — 1,599 lines: forensic findings builder, full report context preparation (line 318, ~1,000 lines), HTML rendering, Playwright PDF rendering, two different PDF generation entry points
- `frontend/src/lib/screener.ts` — 1,337 lines mixing: tier access levels, NACE section maps + genitive forms, kraj labels (nominative + locative), ownership type maps, size categories, filter building, query construction

**Why it matters:**
1. `analytics.py` is the financial brain of the product. Every scoring change (e.g. the V2→V3 scorecard migration, which left BOTH `ScorecardResult` and `ScorecardResultV3` classes in place) happens in one file → merge conflicts, hard-to-review diffs, and unclear which scorecard version is authoritative. Verify: is V2 still computed anywhere or is it dead code?
2. `report_generator.py` mixes pure context-building (testable) with I/O rendering (Playwright, filesystem). The 1,000-line `prepare_report_context` function is effectively untestable in isolation.
3. `screener.ts` mixes *display labels* (Slovak grammar: genitive/locative forms) with *access control* (tier limits) and *query building* — three change cadences in one file.

**Questions for analysis:** Propose a decomposition boundary for each module that minimizes import-graph churn. Specifically: should Altman/Beneish/Piotroski each become their own module with a common `Score` interface, and should the V2 scorecard be deleted after confirming no callers?

---

## PROBLEM 6: In-process asyncio locks as concurrency control — silent scaling ceiling

**Location:** `worker/src/main.py:53-71`

```python
_report_semaphore: Optional[asyncio.Semaphore] = None   # Semaphore(2) in FastAPI path
_scraper_lock: Optional[asyncio.Lock] = None            # global: 1 report scrapes at a time
_pdf_lock: Optional[asyncio.Lock] = None                # global: 1 PDF compile at a time
```
ARQ worker: `worker/src/worker_arq.py:130` — `max_jobs = 3`. Browserless: `MAX_CONCURRENT_SESSIONS=5` (docker-compose.yml:148).

**Why it matters:**
1. All three locks are **in-process** (`asyncio.Lock`). They protect Browserless/Chromium memory — a legitimate reason today. But they only work while there is exactly ONE worker process. The moment a second ARQ worker container (or even a second uvicorn instance) is added for throughput, the locks stop being locks: two reports scrape simultaneously, Browserless (cap 5 sessions, each Chromium ~300-500 MB) gets oversubscribed on a 7.8 GB VPS → OOM kills.
2. There is no Redis-based distributed lock anywhere in the worker (verified: no `redis lock` / `aioredis` usage in main.py). The infrastructure for safe horizontal scaling does not exist yet, but nothing prevents someone from scaling `docker compose up --scale arq_worker=2` — which silently breaks the memory-protection invariant.
3. The lock semantics are undocumented in code: `_scraper_lock` serializing ALL scraping across reports is a product-level throughput decision (10-15 min report time is partly caused by this) that lives as an implementation detail.

**Questions for analysis:** Design the migration path to distributed locking (Redis SET NX + TTL? Redlock?) — what TTL fits a scraper phase that can legitimately run minutes? Should the lock scope be per-source rather than global (two reports scraping different registers don't contend)?

---

## PROBLEM 7: Public company pages are `force-dynamic` — no caching layer for the SEO-critical 500k-page surface

**Location:** `frontend/src/app/(pub)/firma/[ico-slug]/page.tsx:3-4`

```ts
export const dynamic = "force-dynamic";
export const dynamicParams = true;
```

**Evidence of per-request cost:** `getCompanyData` (`frontend/src/lib/ruz.ts:524`) is React-`cache()`-wrapped (per-request dedup only, NOT cross-request) and runs one large Prisma query with 4 includes (5 financial statements, 10 vestnik events, up to 100 persons, 10 company events). On-demand `seedCompany` (ruz.ts:507) fires `seedFromRuz` + `seedFromOrsr` in parallel for missing companies — each doing multiple external API calls.

**Why it matters:**
1. Every Googlebot hit on any of ~500k company pages = full DB round trip. The AGENTS.md SEO audit measured avg 791 ms response — at crawl rates of 10 pages/sec that's sustained DB load purely for cacheable content.
2. Company data changes at most daily (cron re-seed). `force-dynamic` is strictly worse than ISR (`revalidate: 3600`) here. The comment in middleware (line 103-107) even says firma pages are "static + ISR-cacheable" — the code contradicts the documented intent.
3. The 6 language variants multiply this: same company, 6 URLs, all force-dynamic.
4. The middleware slug-validation fetch uses `cache: "force-cache", next: { revalidate: 3600 }` — so the slug lookup IS cached but the page render is not. Inconsistent caching strategy within one request path.

**Counter-consideration for analysis:** `force-dynamic` may be deliberate to keep `noindex` quality-gate decisions fresh (pages with <2 financial statements are noindex). Verify whether the quality gate could be evaluated inside an ISR window instead.

**Questions for analysis:** What is the correct Next.js 14 caching config for this page (ISR + `dynamicParams` + fallback blocking vs blocking=false)? Does anything in the page read cookies/headers that would force dynamic rendering anyway?

---

## PROBLEM 8: Error-boundary coverage gaps on the public (SEO) route group

**Location:** `frontend/src/app/`

**Evidence:**
- `(main)` group: has `error.tsx`, `global-error.tsx`, `loading.tsx` ✅
- `(pub)` group and all 5 language variants `(pub-cs|de|en|hu|pl)`: have `global-error.tsx` + `not-found.tsx` (firma only) but **NO `error.tsx` and NO `loading.tsx`**
- 45 pages total; only 2 loading/error boundaries exist per the find above (plus global-errors)

**Why it matters:**
1. `global-error.tsx` only catches errors thrown in the root layout/Nested boundaries of last resort — it replaces the ENTIRE document (no nav, no footer, no branding) and does not render in production for most component errors; without a group-level `error.tsx`, an exception inside any public server component (e.g. RÚZ fetch timeout in `getCompanyData`) propagates to a full-page failure with degraded recovery UX.
2. Public pages are the Google-indexed surface — a crawler hitting a transient DB error gets a hard 500 with no soft fallback, which over time can affect crawl rate.
3. No `loading.tsx` on `(pub)` means slow `getCompanyData` (791 ms avg, worse for cold seeds that hit RÚZ+ORSR APIs) blocks the entire response — no streaming shell.

**Questions for analysis:** Confirm the Next.js 14 App Router error-propagation semantics (does an error in a page under `(pub)` hit `global-error.tsx` or produce a framework default error page?). Propose the minimal set of boundaries: one `error.tsx` + `loading.tsx` per route group, or per-page for firma only?

---

## PROBLEM 9: `any`-typed boundary layer in the highest-risk data path (financial statement seeding)

**Location:** `frontend/src/app/api/seed-company/[ico]/route.ts`

**Evidence (lines 40-177):**
```ts
function toFloat(val: any): number | null { ... }
function getRow(tables: any[], tableIdx: number, cisloRiadku: number, offset: number, dataCols: number): any[] | null { ... }
function getActivValue(tables: any[], ...): number | null { ... }
function getPasivValue(tables: any[], ...): number | null { ... }
function getIncomeValue(tables: any[], ...): number | null { ... }
function identifyTables(tables: any[]): Record<string, number> { ... }
const zavierky: any[] = [];
const statements: any[] = [];
```

**Why it matters:**
1. This route parses RÚZ financial statement tables (positional row/column logic: `cisloRiadku`, `offset`, `dataCols`) and writes them into `FinancialStatement` — the same numbers that feed scoring. The parsing logic is positional and fragile; with `any` everywhere, a structural change in the RÚZ export (column shift) produces silently wrong numbers (e.g. reading "profit before tax" column as "net profit") with zero type-level or runtime guard.
2. This is the same class of risk the worker solves with its multi-layer validation (blind second-pass extraction, balance-sheet integrity checks) — the frontend seeding path has none of that.
3. 67 total `: any` occurrences in non-test frontend code; this file is the densest cluster (~10+).

**Questions for analysis:** Would typed row descriptors (e.g. `type RuzRow = { cisloRiadku: number; label: string; value: number | null }`) plus a balance-sheet identity check (assets == equity + liabilities, same as worker) be proportionate here? What's the cheapest invariant that catches column-shift corruption?

---

## PROBLEM 10: Remaining security debt (post top-3 fix) — prioritized list with evidence

Context: the top-3 findings (Next.js CVE-2025-29927 → fixed in 14.2.35; Paddle price_id trust → fixed; JSON-LD XSS → fixed) were deployed 2026-09-06. Remaining, in priority order:

**P1 — Next.js 14.x is EOL.** Production runs 14.2.35. Remaining open HIGH advisories (GHSA-9g9p-9gw9-jx7f image-optimizer DoS, GHSA-h25m-26qc-wcjf RSC deserialization DoS, GHSA-ggv3-7p47-pfv8 request smuggling in rewrites, GHSA-3x4c-7xq6-9pq8 image cache exhaustion, GHSA-q4gf-8mx6-v5v3 RSC DoS, GHSA-955p-x3mx-jcvp server-function endpoint disclosure) affect everything below 16.3.4 — including 15.x LTS. Migration to 16.x requires React 19 + converting ~86 synchronous `params` usages across 31 dynamic route files (some files already use the `params: Promise<...>` forward-compatible style, e.g. all firma pages; others like `app/(main)/okres/[okres]/page.tsx:14` still use sync shape).

**P2 — Worker secret comparison not constant-time.** `worker/src/main.py:~100`: `if x_worker_secret != settings.worker_secret`. Frontend uses `crypto.timingSafeEqual` correctly (auth.ts:355-360). Mitigation: worker is not port-mapped to host (internal Docker network only), so exploitation requires network compromise — but it's a 2-line fix (`hmac.compare_digest`).

**P3 — `cron/reseed-all` inconsistent secret check.** `frontend/src/app/api/cron/reseed-all/route.ts:12-13` uses raw `!==` instead of the shared `verifyCronSecret()` helper that all other cron routes use (constant-time + 16-char minimum enforcement).

**P4 — BROWSERLESS_TOKEN empty default.** `docker-compose.yml:139-157`: `TOKEN=${BROWSERLESS_TOKEN:-}` — if unset in prod env, any container on the default bridge network can drive the headless browser (SSRF pivot, resource abuse).

**P5 — starlette CVE-2024-47874** via `fastapi==0.111.0` with unpinned starlette (<0.40.0 multipart DoS). Worker accepts no multipart uploads today, so exploitability is low; pin `starlette>=0.40.0`.

**P6 — CSP permissive.** `frontend/next.config.mjs:40-49`: `script-src 'self' 'unsafe-inline' 'unsafe-eval'` + broad payment/analytics allowlist. Weakens XSS defense-in-depth (relevant given the JSON-LD fix history).

**P7 — Password policy.** `register/route.ts`: `z.string().min(8)` only — no complexity, no max length (bcrypt 72-byte truncation unaddressed), no breached-password check. bcrypt rounds=10.

**P8 — Paddle webhook defense-in-depth gaps.** IP allowlist fetch failure falls back to allow-all (`billing/webhook/route.ts:25-45`, `return []`); no explicit replay window beyond SDK signature verification; paid amount still not cross-checked against a price catalog (price_id mapping now authoritative, but a mapped price_id with a tampered/legacy price object would still pass — verify Paddle-side price immutability assumptions).

**Questions for analysis:** For P1, produce a migration plan (React 19 + async params codemod strategy, risk ranking of the 31 route files). For P8, assess whether Paddle's signature already guarantees price-object integrity (i.e. is the amount check redundant?).

---

## PROBLEM 11: Test-suite structure is strong but coverage is uneven at the seams

**Evidence:**
- Frontend: 712 unit tests (39 lib modules), 10 E2E spec files (auth, billing, credits, security, report-auth, api-routes, firma-page, gdpr, middleware-bypass, helpers) — 114 passed / 8 skipped in last full run
- Worker: 50 test files, including adversarial scoring audit, golden fixtures, eval harnesses
- Gaps observed:
  1. `frontend/src/scripts/*` (10 seed/analysis scripts, 278 console.logs) have no tests and are run manually against production DB
  2. The worker's 33 scrapers have retry/circuit-breaker code but no automated selector canary — breakage is detected by user reports (documented in prior audit; a known-good periodic company report job was recommended, not implemented)
  3. No test asserts i18n key parity across the 6 worker language blocks (frontend parity status unverified)
  4. E2E suite skips 8 tests depending on environment (rate limits / missing users) — skip conditions could mask regressions if run carelessly against prod

**Questions for analysis:** Which of these gaps has the highest defect-detection ROI per implementation hour?

---

## PROBLEM 12: Operational/deployment fragility (observed during this session)

**Evidence:**
1. Production builds run on the 7.8 GB VPS inside `screen` sessions; a build takes ~8-10 min and competes with the running stack for memory (swap usage 2.4/4 GB observed during build). A build that OOMs or gets killed mid-"Collecting page data" leaves the old image running with no error surfaced anywhere.
2. Two frontend containers existed simultaneously (`verifa_frontend` unhealthy + `verifa_frontend_new`) — leftover from a manual migration, ambiguous which serves traffic.
3. No external uptime monitoring (no UptimeRobot/Healthchecks.io integration found); Sentry catches app errors but not host-level death.
4. Frontend port mapping `3000:3000` binds `0.0.0.0` (docker-compose.yml:106-107) — direct-to-container access bypasses nginx/TLS if the firewall doesn't block 3000.
5. All services share the default Docker bridge network — no `internal: true` isolation for postgres/redis/browserless/worker.

**Questions for analysis:** Propose a minimal SRE hardening sequence for a single-VPS budget setup (build off-host vs build with memory guard, network segmentation, external monitoring, port binding).

---

## Summary table for the reviewing LLM

| # | Problem | Severity | Effort | Key risk |
|---|---|---|---|---|
| 1 | Dead code + one-off scripts in worker/src | Medium | Low | Misdirected changes, image bloat |
| 2 | Root repo pollution (stale reports, 6.8 MB PDF, backups/) | Medium | Low | Misleading docs, PII in backups |
| 3 | Silent exception swallowing (74 + ~105 sites) | High | Medium | Quiet financial-data corruption |
| 4 | Dual i18n systems, ~11.4k duplicated lines | Medium | Medium | Terminology drift, 7th-language cost |
| 5 | God modules in scoring core (analytics 2.7k, report_generator 1.6k, screener 1.3k) | Medium | High | Review friction, V2/V3 ambiguity |
| 6 | In-process locks = scaling ceiling | High (at scale) | Medium | OOM on horizontal scale |
| 7 | force-dynamic on 500k SEO pages | High | Low | DB load, crawl performance |
| 8 | Missing error/loading boundaries on (pub) | Medium | Low | Hard 500s for crawlers |
| 9 | any-typed RÚZ financial parsing | High | Medium | Silent wrong numbers |
| 10 | Security debt P1-P8 (Next 16 migration on top) | High | High | Known-CVE exposure |
| 11 | Test coverage gaps at seams | Medium | Medium | Late breakage detection |
| 12 | Deployment fragility (build-on-VPS, no external monitor) | Medium | Medium | Silent failed deploys, unnoticed downtime |
