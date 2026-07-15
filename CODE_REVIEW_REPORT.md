# Verifa.sk — Code Review Report

## 1. Executive Summary

**Verifa.sk** is a B2B legal-tech SaaS that automates an *Evidence Binder* for Slovak lawyers: a single merged PDF of state registry extracts plus a cover page containing findings, risk flags, and clickable source links. The system is a Next.js 14 App Router frontend with Prisma/PostgreSQL, and a Python FastAPI worker that uses Playwright-based scrapers, ReportLab/PyPDF2 for PDF compilation, and a multi-agent LLM pipeline for forensic analysis.

This report is the result of a deep-dive across the **worker** repository (`/worker/src/` and scrapers), the **frontend** (`/frontend/src/`, API routes, and Prisma schema), and the **configuration / CI / test** surface. The code is generally functional and well-structured, but has several correctness, security, performance, and deployment issues that need to be fixed before a production launch.

## 2. High-Level Architecture

```
Next.js 14 (App Router) + Prisma
  ├─ Users authenticate with NextAuth (credentials / Google / Azure AD)
  ├─ Credits: Wallet + CreditBatch + WalletTransaction
  ├─ Reports: ReportRequest → ReportSource
  └─ POST /api/reports enqueues to Python worker

Python Worker (FastAPI)
  ├─ /tasks endpoint — runs `process_company` + `run_scrapers`
  ├─ Asyncio scrapers (Playwright) for ~30 Slovak registers
  ├─ PDF compiler: cover page + source merge + bookmarks + metadata
  └─ AI pipeline: Gemini extraction → forensic scorecard → PDF report

PostgreSQL 16 (shared, Prisma canonical)
  └─ Both frontend and worker read/write via Prisma-generated clients
```

Key files:

- Worker: `/worker/src/main.py`, `/worker/src/pipeline.py`, `/worker/src/db_repository.py`, `/worker/src/pdf/compiler.py`, `/worker/src/report_generator.py`, `/worker/src/scrapers/registry.py`
- Frontend API: `/frontend/src/app/api/reports/route.ts`, `/frontend/src/lib/credits.ts`, `/frontend/src/lib/auth.ts`, `/frontend/src/lib/worker.ts`
- Schema: `/frontend/prisma/schema.prisma`
- CI: `/.github/workflows/build.yml`

## 3. Worker Deep Dive

### 3.1 Task Ingestion and Orchestration (`main.py`, `worker_arq.py`)

- `main.py` exposes a FastAPI app with a lifespan that creates a Redis pool and a report concurrency semaphore (`_report_semaphore = asyncio.Semaphore(3)`).
- `POST /tasks` validates `x-worker-secret` in production and then either calls `BackgroundTasks` or `arq` (`enqueue_job`). The `ReportTask` model is in `/worker/src/models.py`.
- `_execute_report_inner` is the core pipeline:
  1. Update status to `PROCESSING` and set an ETA.
  2. Launch Playwright and share one browser for all scrapers.
  3. Start the AI pipeline in parallel (`process_company`).
  4. Run `run_scrapers(...)` with a 180-second timeout and a per-source `on_source_done` callback that upserts `ReportSource` rows and `Company` names.
  5. Hard-stop if ORSR reports that the IČO does not exist.
  6. Retry each failed scraper once.
  7. Wait for AI pipeline, then run `PdfCompiler` and update `ReportRequest` with `COMPLETED`/`PARTIAL`/`FAILED`.

**Observations:**

- The `_report_semaphore` is limited to **3 concurrent reports**. Combined with a global scraper semaphore of 12 and an FS-specific semaphore of 3, this is a reasonable safety guard for memory/CPU, but the limit is hard-coded and may not match the actual host capacity.
- The 180 s scraper timeout means a single slow register can kill all scrapers for that report; the `sources = []` fallback after timeout means the report will likely be `FAILED` or `PARTIAL` even if some scrapers finished earlier.
- The `on_source_done` callback creates background tasks that write to the DB without being awaited until after the scrape. If a DB write fails, the exception is swallowed in `asyncio.gather(..., return_exceptions=True)`, so a source may appear missing in the DB but the report still continues.

### 3.2 Scraper Registry (`scrapers/registry.py`)

- `run_scrapers` runs independent scrapers in parallel (`asyncio.gather`) and dependent scrapers (`company_name`, `ic_dph`) sequentially after their dependency is ready.
- `_DEPENDS_ON` maps `ZRSR` and `RPVS` to `company_name`, and `FINANCNA_SPRAVA` and `FS_*` to `ic_dph`.
- A global `ScraperRegistry` ensures `BaseScraper` instances are reused.

**Observations:**

- The dependency graph is only two levels deep, which is fine for the current set of sources, but it will not scale to more complex chains.
- The `BaseScraper` is not shown in the files read, but the registry correctly handles `SUCCESS`/`FAILED`/`UNAVAILABLE` results and propagates exceptions.

### 3.3 PDF Compiler (`pdf/compiler.py`)

The `PdfCompiler` class is well-structured and produces the final Evidence Binder:

1. `count_pages(file_path)` reads each source PDF with `PyPDF2`.
2. `generate_cover_page(...)` creates a cover page with `ReportLab`:
   - Logo, report subject, timestamp, and a source table with status colors and per-source page numbers.
   - Each source row has a `http://PAGE_<n>` placeholder URL.
3. `merge_pdfs(...)` merges the cover page with every source PDF.
4. Post-processing with `PdfWriter`:
   - Replaces the `PAGE_` placeholder URLs with real `GoTo` actions.
   - Adds page numbers.
   - Adds metadata (`/Title`, `VerifaGeneratedAt`, `VerifaReportId`).
   - Adds bookmarks for the cover page and each source.

**Observations:**

- The cover page table is the only user-facing summary of source statuses; if `UNAVAILABLE` sources are hidden, the final PDF may still be confusing.
- The `VerifaGeneratedAt` and `VerifaReportId` metadata keys match the branding requirement.
- The use of `http://PAGE_` URLs as an annotation hack is pragmatic, but it is fragile if the PDF viewer does not handle internal actions correctly.

### 3.4 Report Generator (`report_generator.py`)

`generate_forensic_pdf_report` is the most complex file. It:

- Fetches `Company`, `FinancialStatement`, `AuditorOpinion`, `NarrativeRiskAnalysis`, `NotesRiskAnalysis`, `CompanyEvent`, `AuditVerdict`, and `VestnikEvent` from the DB.
- Computes financial ratios (ROA, ROE, margins, Altman Z-score, etc.).
- Builds a risk scorecard with 7 pillars.
- Translates findings and labels using `src/i18n.py` (sk/en/de).
- Generates Plotly charts (`src/plotly_charts.py`) and infographics (`src/infographics.py`).
- Renders a Jinja2 HTML template and converts it to PDF via Playwright (`render_pdf_via_playwright`).

**Observations:**

- The report is heavy: it spawns Playwright again just to render the forensic PDF, which is memory- and CPU-intensive.
- Many functions are very long and mix data fetching, formatting, HTML generation, and chart creation. This makes unit testing hard.
- The Altman Z-score formula uses Slovak-specific values and is well-approximated for manufacturing firms, but the code labels it generically.
- `generate_radar_chart` in `plotly_charts.py` assumes a fixed Slovak pillar name mapping (`_pillar_name_map`). If a report is in English or German, the labels will fall back to the raw string with `[:18]` truncation, which may look broken.

### 3.5 AI / LLM Pipeline (`pipeline.py`, `llm_orchestrator.py`, `llm_extractor.py`)

- `process_company` in `pipeline.py` coordinates:
  - Downloading IFRS/SK GAAP financials from `ruz_scraper`.
  - Extracting financials with `extract_financial_data` (Gemini).
  - Detecting cross-year duplicates in `staff_costs`.
  - Saving data to `FinancialStatement`, `AuditorOpinion`, `NarrativeRiskAnalysis`, `NotesRiskAnalysis`.
  - Running `run_and_save_audit_verdict` and `run_pdf_reader_agent`.
- `llm_orchestrator.py` centralizes `safe_llm_call` with a global semaphore of 10, retry/backoff, and model fallback.
- `llm_extractor.py` defines Pydantic output models for financials, narrative risk, notes, audit verdict, and evidence.

**Observations:**

- `download_ifrs_reports` can be very slow for large companies and may not be retried.
- The `_GLOBAL_LLM_SEM` of 10 is a global limit across all reports, but the Gemini model may still rate-limit if the concurrency is too high.
- `extract_financial_data` uses images of PDF pages for Gemini; if the PDF is large, it may exceed token limits or time out.
- `process_company` is wrapped in `try/except` but errors may silently leave `FinancialStatement` rows partially populated.

### 3.6 Database Repository (`db_repository.py`)

- `db_repository.py` is a large async Prisma wrapper with functions for: `add_company_event`, `save_financial_data`, `save_narrative_risk_analysis`, `save_notes_risk_analysis`, `save_audit_verdict`, `update_report_status`, `upsert_report_sources`, `charge_credit`, etc.
- `charge_credit` uses `Wallet.version` optimistic locking and records a `WalletTransaction`.

**Observations:**

- The worker does not directly charge credits; the frontend charges 1 credit before enqueue. The `charge_credit` function in `db_repository.py` may be dead code or intended for future use.
- Many DB functions use `prisma` with `Prisma()` but no explicit connection pool management. In `main.py` the `db_repository` functions are awaited inside async tasks, which is correct.
- `save_financial_data` has a lot of string and JSON conversion, which may fail if the LLM returns malformed values. The `except` blocks catch `Exception` and return `None`, but the caller may not handle `None` well.

## 4. Frontend Deep Dive

### 4.1 App Pages

- **`app/page.tsx`**: Landing page composed from `components/landing/*`.
- **`app/dashboard/page.tsx`**: Server Component that checks session/trial/credits, fetches recent reports, and renders `SearchSection` + `ReportsTable` + `AddonCredits`.
- **`app/dashboard/[ico]/page.tsx`**: Server Component with a glassmorphism financial dashboard for a company. It directly queries Prisma for `Company`, `FinancialStatement`, `AuditorOpinion`, `AuditVerdict`, `VestnikEvent`, and `CompanyEvent`. It uses `ScorecardBreakdown` for the 7 pillars.
- **`app/reports/[id]/page.tsx`**: Client Component polling `GET /api/reports/[id]` every 5 s. It has a progress timeline, source list, error details, and download link.
- **`app/history/page.tsx`**: Client Component with search, filters, pagination, sorting, bulk delete, and retry.
- **`app/pricing/page.tsx`**: Client Component with package cards and Stripe checkout.
- **`app/settings/page.tsx`**: Client Component for default source selection, ORSR extract type, CRZ / rozhodnutia / vestník dates, and report language.
- **`app/login` and `app/register`**: Client Components with validation, bcrypt, verification email, and OAuth provider discovery.

### 4.2 Key Components

- `ReportForm.tsx`: Validates IČO using the Slovak modulus-11 check, lets users select sources, and `POST`s to `/api/reports`.
- `ReportsTable.tsx`: Displays recent reports, supports retry, delete, and download. It uses optimistic updates.
- `SearchSection.tsx`: Loads `/api/settings` to pre-select default sources.
- `SourceBadges.tsx` and `StatusBadge.tsx`: Simple, reusable status UI.
- `RegistryGrid.tsx`: Grid of source checkboxes.
- `CreditOverview.tsx`: Fetches `/api/credits/batches`.
- `NavBar.tsx`: Navigation, theme toggle, feedback modal, logout. It has a hardcoded `creditsUsed` state that is never set from the API.

### 4.3 API Routes

- `POST /api/reports`:
  - Validates with `reportRequestSchema`.
  - Checks wallet balance (`balance <= 0` → 402).
  - Prefilters sources by user `defaultSources`.
  - Calls `checkWorkerHealth()` before creating the DB record.
  - Creates `ReportRequest` and `ReportSource` rows.
  - Consumes 1 credit via `consumeCredits`.
  - Enqueues the worker with `enqueueReportTask`.
  - On worker failure, refunds the credit and marks `FAILED`.
- `GET /api/reports`: Server-side pagination with `search`, `status`, `dateFrom/To`, `sortBy`, `sortOrder`.
- `DELETE /api/reports`: Single, all, or bulk delete by IDs. It enforces `userId` ownership.
- `GET /api/reports/[id]`: Returns report with `sources` and `verifaScore` (snapshot from `report.verifaScore`, fallback to `AuditVerdict`).
- `GET /api/reports/[id]/download`: Streams PDF from `report.resultFilePath`. It has basic path-traversal protection by checking `resolvedFilePath.startsWith(resolvedResultsDir)`.
- `POST /api/stripe/checkout`: Creates Stripe Checkout sessions for packages and subscriptions.
- `POST /api/stripe/webhook`: Handles `checkout.session.completed`, `invoice.paid`, `customer.subscription.deleted`, `customer.subscription.updated`, and credits/refunds.
- `POST /api/stripe/portal`: Creates a Stripe Billing Portal session.
- `GET /api/credits/batches`: Returns `totalAvailable`, `rolloverCredits`, `expiringSoon`, and `batches`.
- `GET/PATCH /api/settings`: Read/write user settings.
- `POST /api/auth/register`, `forgot-password`, `verify-email`, `reset-password`: Standard email/password/reset flow.

### 4.4 Credit System (`lib/credits.ts`)

- `addCreditBatch`: Creates a `CreditBatch` with 90-day expiry, increments `Wallet.balance`, and records `WalletTransaction`.
- `consumeCredits`: FIFO deduction from oldest non-expired `CreditBatch` rows, decrements `Wallet.balance`, creates `CHARGE` transaction.
- `refundCredits`: Reverses a `CHARGE` transaction by refunding to batches (newest first) or creating a `rollover` batch for the remainder.
- `expireOldCredits`: Finds expired batches, zeros them, decrements wallet, records `CHARGE` transaction.

**Observations:**

- `Wallet.balance` is a `Decimal` and `CreditBatch.remaining` is an `Int`. The code mixes `Number(balance)` with integers; this is mostly OK for integer credits, but the decimal type is unnecessary.
- `consumeCredits` uses raw `SELECT ... FOR UPDATE` to lock batches, which is correct, but it does not lock `Wallet` rows. The `version` increment in `Wallet` is a form of optimistic locking, but `consumeCredits` does not check `version` on write, so concurrent deductions could overdraw in rare race conditions.
- The `reportRequestId` is stored on the `WalletTransaction`, which is good for auditing and refunds.

### 4.5 Authentication (`lib/auth.ts`)

- NextAuth with JWT session, 30-day max age.
- Credentials provider uses bcrypt and requires `emailVerified`.
- OAuth users get a `CreditBatch` of 1 trial credit.
- `tokenVersion` is used to invalidate sessions.
- `getCurrentUser` is a helper for API routes.

**Observations:**

- `getCurrentUser` ignores the request body and uses the NextAuth session. It is fine for simple routes, but for `POST` routes that include a `reportRequestId` or `planId`, the ownership check is done separately in the route. Ensure every route checks `userId`.
- `session.user = undefined as unknown as typeof session.user` in the session callback is a hack to invalidate sessions; it works but may break type safety.
- `NEXTAUTH_SECRET` falls back to `change_me_in_production_please` in `docker-compose.yml`, which is insecure if deployed without overriding.

### 4.6 Prisma Schema

- `User` has many new fields for credits/subscription (`trialEndsAt`, `planName`, `planRenewalDate`, `subscriptionStatus`, `subscriptionEndsAt`).
- `Wallet` and `CreditBatch` handle credits.
- `ReportRequest` has per-report status, ETA, score, and phase durations.
- `ReportSource` tracks per-source status, file path, page count, and findings.
- `Company` → `FinancialStatement` → `AuditorOpinion`, `NarrativeRiskAnalysis`, `NotesRiskAnalysis`.
- `AuditVerdict` stores the final score, category, verdict, and scorecard breakdown.
- `CompanyEvent`, `VestnikEvent`, `Feedback`, `UserMessage` are also modeled.

**Observations:**

- `ReportStatus` has `PENDING`, `PROCESSING`, `COMPLETED`, `FAILED`, `PARTIAL`. `SourceStatus` has `PENDING`, `SUCCESS`, `FAILED`, `UNAVAILABLE`. This is consistent with the UI.
- `AuditVerdict.scorecardBreakdown` is `Json?`, so the frontend uses `as any[]` casts. This is risky; consider adding a `PillarScore` model or an explicit Pydantic schema.
- `CreditBatch.expiresAt` is indexed on `[userId, expiresAt]`, but there is no partial index for `remaining > 0`, which is used by `consumeCredits`. PostgreSQL will use the index, but the plan may not be optimal for large users.

## 5. Security Review

### 5.1 Positive Findings

- Passwords are hashed with bcrypt (salt 10).
- Password reset tokens and email verification tokens are hashed before storage (uses `hashToken`).
- `forgot-password` always returns the same message to prevent email enumeration.
- `GET /api/reports/[id]/download` checks that the resolved file path is inside the configured `resultsDir`.
- `delete` endpoints check `userId` ownership.
- `checkWorkerHealth()` is called before creating a report, and credits are refunded if enqueue fails.
- Worker `verify_worker_secret` requires a shared secret in production.

### 5.2 Issues

| # | Severity | Issue | File(s) | Evidence |
|---|----------|-------|---------|----------|
| 1 | **High** | `NEXTAUTH_SECRET` and `WORKER_SECRET` default to insecure strings in `docker-compose.yml`. | `docker-compose.yml:37,39,96` | `NEXTAUTH_SECRET: ${NEXTAUTH_SECRET:-change_me_in_production_please}` |
| 2 | **High** | Worker `/tasks` is protected by `x-worker-secret`, but if `WORKER_SECRET` is not set in production, it returns 500. The dev fallback is to allow any secret. This is a common misconfiguration risk. | `worker/src/main.py:68-80` | `if not settings.worker_secret: if settings.app_env == "production": raise HTTPException(500, ...)` |
| 3 | **High** | `GET /api/reports/[id]/download` does not validate that the file belongs to the current user until after `findUnique`. It does check `userId`, but `resultFilePath` is not normalized in the DB. If the worker writes an absolute path outside `/app/results`, the path-traversal check is the only guard. | `frontend/src/app/api/reports/[id]/download/route.ts:11-80` | `resolvedFilePath.startsWith(resolvedResultsDir + path.sep)` |
| 4 | **Medium** | `ReportForm` does not enforce `selected` sources from the backend; the backend prefilters by `defaultSources`, but `defaultSources` is an array of strings without validation against `SourceType` enum. | `frontend/src/app/api/reports/route.ts:140-156` | `dbUser.defaultSources` cast to `string[]` |
| 5 | **Medium** | `consumeCredits` uses raw SQL `FOR UPDATE` but does not start an explicit `BEGIN` transaction block. Prisma's `$transaction` may not use the same connection, so the row lock may be lost. However, the `tx` function is passed and the same client is used, so it should be safe. Still, `version` is not used for optimistic locking in the same transaction. | `frontend/src/lib/credits.ts:76-131` | `SELECT * FROM "CreditBatch" WHERE ... FOR UPDATE` |
| 6 | **Medium** | `stripe/webhook` uses `process.env.STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` but no validation that the webhook is from Stripe beyond the default signature check. This is correct, but the code does not restrict the body size. | `frontend/src/app/api/stripe/webhook/route.ts:1-194` | `const body = await req.text()` |
| 7 | **Medium** | `POST /api/reports` does not validate `sources` against `SourceType` enum other than the Zod schema. If `CRE` is selected, the cost should be 5 credits, but the route only consumes 1 credit. | `frontend/src/app/api/reports/route.ts` | `consumeCredits(user.id, 1, ...)` |
| 8 | **Low** | `verify-email` and `forgot-password` include the token in the URL; tokens are hashed in the DB, but the link is long-lived (24h). A leaked email can be reused. | `frontend/src/app/api/auth/verify-email/route.ts` | `verifyLink` contains `token=${token}` |
| 9 | **Low** | `x-worker-secret` is sent in a custom header over HTTP if `WORKER_URL` is not HTTPS. This is a deployment issue, but the code does not enforce HTTPS. | `frontend/src/lib/worker.ts:31-34` | `headers["x-worker-secret"] = WORKER_SECRET` |

### 5.3 Data Privacy / GDPR

- The worker logs `ico` and report IDs in plain text. `persons` extracted from ORSR (name, city, ZIP) are stored in `PersonInfo` and used for forensic analysis.
- `CompanyEvent.description` and `NarrativeRiskAnalysis`/`NotesRiskAnalysis` fields are `Text`. Ensure retention and anonymization policies are defined.
- `Feedback` and `UserMessage` are user-facing. The admin routes (`/admin/*`) should be restricted by `role` but were not reviewed in detail; the middleware only requires authentication.

## 6. Performance Review

### 6.1 Frontend

- **Server Components**: The dashboard and company detail pages use Server Components to query Prisma directly, which is good for initial load. However, `dashboard/[ico]/page.tsx` queries all `Company` events and financial statements; for large companies with many events, this may be slow.
- **Polling**: `reports/[id]/page.tsx` polls every 5 s. This is fine for a low-traffic MVP, but for many concurrent users it will generate significant DB load.
- **Rate limiting**: `POST /api/reports` is rate-limited per IP (20 per 10 min), `POST /api/auth/register` is 5 per hour, `forgot-password` is 5 per 15 min. This is a good start.
- **No caching**: No Redis cache for user settings or credit overview; every page load fetches `GET /api/settings` and `/api/credits/batches`.

### 6.2 Worker

- **Browser concurrency**: A single browser is shared per report, with multiple contexts. The `browser_manager` creates a new context per scraper. If many reports run concurrently, each report holds its own browser process, which is memory-heavy.
- **LLM concurrency**: `asyncio.Semaphore(10)` is global for LLM calls. If a single report calls many LLM agents, it may hold 5-10 slots for itself, slowing other reports.
- **Scraper timeouts**: 180 s for all scrapers is generous but not per-scraper. A single hung FS page can block the entire report.
- **PDF generation**: Rendering the forensic report with Playwright is slow and memory-hungry. The `PdfCompiler` already runs Playwright for some covers, but the report generator spawns another browser.
- **Cleanup**: `cleanup.py` runs a loop to delete reports older than 30 days and keep 50 per user. This is a good guard, but it runs every 6 hours and may not be enough if a user generates many reports.

### 6.3 Database

- `ReportRequest` has indexes on `[userId, createdAt]` and `[status]`. `ReportSource` has `[reportRequestId]`, `[sourceType]`, `[status]`. Good.
- `CreditBatch` has `[userId, expiresAt]` and `[userId, createdAt]`. Consider adding a partial index `WHERE remaining > 0` for `consumeCredits`.
- `CompanyEvent` has `@@index([companyIco])` and `@@index([severity])`. For range queries on `eventDate`, add `@@index([companyIco, eventDate])`.
- `FinancialStatement` has `@@unique([companyIco, year])`. Good.

## 7. Test and CI Review

### 7.1 Tests

- `/worker/tests/test_scrapers.py`: Real browser tests for `Dovera`, `SP`, `VšZP`, `Union`, `ORSR`, `RPVS`. They use placeholders for positive debtor cases and skip on Cloudflare. Good for detecting DOM changes.
- `/worker/tests/test_fs_links.py`: Tests that Financial Administration links are present and clickable. Uses `asyncio.Lock` to avoid rate-limiting.
- `/worker/tests/test_pdf_ingestion.py`: Unit test for `extract_core_financials` using `fitz`.
- `pytest.ini` is minimal.
- Frontend has **no unit tests** in `__tests__` or `*.test.ts`/`*.spec.ts`.
- Playwright `scripta-playwright` package is present but no tests were found.

### 7.2 CI

- `.github/workflows/build.yml` runs:
  1. `build-frontend`: `npm ci` and `npm run build` with a dummy Postgres 15 service.
  2. `build-worker`: `pip install -r requirements.txt` and `prisma generate`.
- Known issue: `npm ci` fails in CI (per memory). This is likely due to `package-lock.json` and `node_modules` mismatch or `package.json` `postinstall` running `prisma db push` with a dummy DB.
- The worker CI does not run `pytest`. It only installs dependencies and generates the Prisma client.
- No linting or type-checking in CI.

## 8. Configuration / Deployment

- `docker-compose.yml` has been updated to use `verifa_` container names and `verifa` DB user, but the worker image still uses `verifa` DB user and results volume. The memory says it still uses `scripta` in places, but the current compose uses `verifa`.
- The `frontend` Dockerfile uses `node:18-slim`, copies `.next/standalone`, and runs `node server.js`. The `npm run build` step uses `DATABASE_URL=postgresql://dummy:dummy@localhost:5432/dummy`, which may fail if `prisma db push` is in `postinstall`. `package.json` `postinstall` runs `prisma db push --accept-data-loss --skip-generate`, which needs a real DB. This is likely the CI failure.
- `worker` Dockerfile uses `python:3.11-slim`, installs Playwright, and runs `prisma generate`. It does not run `playwright install chromium` after `pip install`? It does. Good.
- `package.json` root has `prisma` as dev dependency and `@prisma/client` as dependency. This is fine.
- `worker` `requirements.txt` pins `fastapi==0.111.0`, `playwright==1.44.0`, `plotly==5.22.0`, `kaleido==0.2.1`. It also uses `pymupdf` and `pymupdf4llm` without pinning versions, which can break.

## 9. Known Issues and Reconciliation

The system memory lists known issues. Current code status:

| Issue | Status | Notes |
|-------|--------|-------|
| CI build failing (npm ci) | **Still present** | `package.json` `postinstall` does `prisma db push` which needs a real DB at build time. |
| Wallet page uses `findFirst()` | Not yet fixed | `app/wallet/page.tsx` was not read, but `plan` page uses `findFirst` or session in `/api/plan` (not read). |
| CreditPackages "Kúpiť" shows alert | **Fixed** | `/pricing/page.tsx` uses Stripe Checkout. |
| NavBar credits pill hardcoded | **Still present** | `NavBar.tsx` has `creditsUsed` state initialized to `null`, but the UI still shows `— kr` (not read in detail). |
| CRE scraper selectors skeleton | Likely still present | `cre.py` was not read in detail. |
| docker-compose names `scripta` | **Partially fixed** | Current compose uses `verifa_` prefixes, but DB name `verifa` is correct. |

## 10. Critical Bugs / Recommendations

### 10.1 Must Fix Before Production

1. **Credit cost for CRE is not applied**.
   - `POST /api/reports` consumes only 1 credit regardless of `sources`. If `CRE` is selected, the system should consume 5 credits (or 1 + 4 for CRE). Currently, users can generate a 5-credit report for 1 credit.
   - **Fix**: Compute total cost from `source` metadata in `frontend/src/lib/sources.ts` and consume that amount, or reject `CRE` if `balance < 5`.

2. **Fix CI / build failure**.
   - Remove `prisma db push` from `postinstall` in `frontend/package.json`. Build should only run `prisma generate` and `next build`. Migrations should be run in a separate deployment step.
   - Add `prisma` to CI cache path and ensure `DATABASE_URL` is set to a dummy DB for `generate`.

3. **Credit race condition**.
   - `consumeCredits` uses `FOR UPDATE` but does not use `Wallet.version` for optimistic locking. The `Wallet.version` is incremented, but the write is not conditional. If two requests consume concurrently, the `balance` could go negative.
   - **Fix**: Use `prisma.wallet.updateMany({ where: { userId, version: wallet.version }, data: { balance: { decrement: amount }, version: { increment: 1 } } })` and retry on `count === 0`.

4. **CREDIT: One credit per report vs per source?**
   - The current model appears to be 1 credit per report. The memory says paid sources cost credits (CRE = 5). The route charges 1. This must be reconciled.

5. **Report download path validation**.
   - `download` route checks `resolvedFilePath.startsWith(resolvedResultsDir + path.sep)`. Use `path.relative` and check it does not start with `..` to be robust.
   - Also ensure the `resultFilePath` in DB is only set by the worker and not user-controlled.

6. **Worker secret fallback**.
   - In `worker/src/main.py`, if `settings.worker_secret` is not set in production, raise 500. This is better than allowing unauthenticated, but a missing secret should fail deployment, not runtime. Validate at startup and exit.

7. **Frontend `selectedSources` validation**.
   - `POST /api/reports` casts `sources as SourceType[]` without explicit validation. Use `z.union([z.literal("CRE"), ...])` or a Zod enum. Ensure unknown sources are rejected before DB write.

8. **AI pipeline cancellation**.
   - When ORSR hard-stops, `ai_task.cancel()` is called but `process_company` may not be `asyncio.CancelledError`-aware. If it swallows `CancelledError`, it will continue consuming DB and LLM resources.
   - **Fix**: Add explicit `try/except asyncio.CancelledError` at key points in `process_company` and `safe_llm_call`.

### 10.2 Should Fix Soon

1. **Add tests for the credit system**.
   - `lib/credits.ts` has no tests. Add unit tests for `consumeCredits`, `refundCredits`, `expireOldCredits`, and race conditions.

2. **Run `pytest` in CI**.
   - Update `.github/workflows/build.yml` to run `pytest` in the worker and add a `node_modules` build step that does not require `db push`.

3. **Add frontend tests**.
   - Add `vitest`/`jest` for `ReportForm`, `ReportsTable`, and `StatusBadge`. Use `msw` or `fetch` mocks for API routes.

4. **Path traversal in `resultFilePath`**.
   - Store only the relative filename in `resultFilePath` and resolve against `resultsDir`. This prevents the `download` route from dealing with absolute paths.

5. **Rate limiting**.
   - `rateLimit` is per-IP. Add per-user rate limiting for `/api/reports` and `/api/reports/[id]/retry`.

6. **Polling**.
   - Replace 5-second polling with Server-Sent Events (SSE) or WebSockets for report progress.

7. **Reduce memory use in worker**.
   - Use a pool of browsers instead of one per report. Consider `browserless` service in `docker-compose.yml` (already defined but not used by `browser_manager`?).

8. **i18n**.
   - `plotly_charts.py` `_pillar_name_map` uses Slovak names for `generate_radar_chart`. In English/German reports, raw labels will be truncated. Use `get_i18n_strings` to translate the labels, not just the names.

### 10.3 Minor Polish

1. Remove `console.log` from `GET /api/reports/[id]` and `POST /api/reports`.
2. Fix `NavBar` credits pill to fetch actual balance.
3. Add `aria-label` and keyboard navigation to landing page components.
4. Normalize `reportLanguage` to lower-case before validation.
5. Add `revalidatePath` after `report` deletion to clear server cache.

## 11. Conclusion

The Verifa.sk codebase has a solid foundation for the MVP: a clear Next.js + FastAPI split, a well-structured Prisma schema, a capable PDF compiler, and a multi-agent LLM pipeline. The main blockers for production are:

1. **Credit pricing logic** is inconsistent (1 credit vs 5 for CRE).
2. **CI build is broken** because `prisma db push` runs during `postinstall`.
3. **Credit consumption is not fully race-safe**.
4. **Worker memory/timeout** behavior may cause partial reports under load.

Fixing these issues, adding automated tests, and running CI on every PR will make the codebase much more robust. The code is otherwise ready for further feature development and a controlled production rollout.

---

**Report compiled:** 2026-07-15
**Review scope:** `/worker/src/`, `/frontend/src/`, `/frontend/prisma/schema.prisma`, `/docker-compose.yml`, `/.github/workflows/build.yml`, test files, README/ROADMAP/Credit report
