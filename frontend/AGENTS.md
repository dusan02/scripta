# Scripta/Verifa — Frontend Development Guide

## Build & Dev Commands

```bash
npm run dev          # Start dev server (port 3000)
npm run build        # Production build
npm run lint         # ESLint
npx tsc --noEmit     # Typecheck (no output files)
```

## SEO Scripts (run from project root)

```bash
node scripts/validate-hub-seo.mjs          # Hub SEO validator (246 URLs × 6 langs)
node scripts/seo-regression-tests.mjs      # Regression tests (171 checks: cs/cz, canonical, hreflang, noindex, HTTP, trailing slash, title/desc length, company links, JSON-LD)
node scripts/gsc-monitor.mjs               # GSC monitoring (requires GSC_SERVICE_ACCOUNT_FILE env var)
```

## Database

```bash
npx prisma generate  # Generate Prisma client
npx prisma migrate dev  # Run migrations
npx prisma db push   # Push schema without migration history
npm run prisma:seed  # Seed database
```

## E2E Tests (Playwright)

```bash
npm run test:e2e          # Run all E2E tests
npm run test:e2e:ui       # Run with interactive UI
npm run test:e2e:report   # Show HTML report
```

## Unit Tests (Node.js native test runner)

```bash
npm run test:unit         # Run all unit tests (src/lib/__tests__/*.test.ts)
```

### Test Structure

- `e2e/billing.spec.ts` — Billing webhook → credit grant flow, checkout validation, dead proxy routes
- `e2e/report-auth.spec.ts` — IDOR protection, worker secret verification, cron auth
- `e2e/credits.spec.ts` — Credit system cron health checks, report creation guards, recover-stuck edge cases
- `e2e/auth.spec.ts` — Registration, verify-email, forgot-password, admin access
- `e2e/security.spec.ts` — XSS prevention, header injection, timing-safe secret comparison
- `e2e/helpers.ts` — Test utilities (login, mock Stripe events)
- `src/lib/__tests__/sanitize.test.ts` — Unit tests for escapeHtml, sanitizeFilename
- `src/lib/__tests__/email.test.ts` — Unit tests for emailShell, emailButton
- `src/lib/__tests__/credits.test.ts` — Unit tests for credit system (consume, refund, revoke, addBatch)

### Running Tests

Tests require a running dev server (`npm run dev`) and a test database
seeded with `npm run prisma:seed` (creates 3 test users with credits).

The tests use `baseURL: http://localhost:3000` by default.

Env vars needed for tests:
- `STRIPE_WEBHOOK_SECRET` — for billing webhook tests
- `WORKER_SECRET` — for worker callback endpoint tests
- `CRON_SECRET` — for cron endpoint tests

### Test Users (created by `npm run prisma:seed`)

| User | Email | Password | Purpose |
|------|-------|----------|---------|
| Primary | test@verifa.sk | heslo123 | Manual testing |
| E2E A | e2e-test@verifa.sk | E2eTestPass123! | Authenticated tests (report owner) |
| E2E B | e2e-test-b@verifa.sk | E2eTestPass456! | IDOR tests (cross-user access denial) |

All test users have `emailVerified = now()` and a wallet with 5-10 credits.

## Architecture Notes

### Credit System
- `src/lib/credits.ts` — Core credit logic (addCreditBatch, consumeCredits, refundCredits, revokeCreditsOnRefund)
- Uses pessimistic locking (`SELECT ... FOR UPDATE`) on Wallet and CreditBatch rows
- `addCreditBatch` settles negative balance (debt from chargebacks) by reducing new batch's remaining
- `revokeCreditsOnRefund` cascades debt across non-expired batches, allows negative wallet balance
- `POST /api/reports` checks `SUM(remaining)` from non-expired batches (not wallet.balance)

### Billing
- `src/lib/billing/stripe.ts` — Stripe webhook handler
- `src/app/api/billing/webhook/route.ts` — Webhook route (handles payment.succeeded, charge.refunded, etc.)
- `charge.refunded` sends admin + user email notifications (via Resend)

### Report Generation
- `src/lib/worker.ts` — Worker communication (enqueueReportTask, checkWorkerHealth)
- Worker (Python) calls back via `/api/reports/[id]/refund` and `/api/reports/[id]/notify`
- Worker callback endpoints use `verifyWorkerSecret()` (timing-safe comparison)
- `POST /api/reports/recover-stuck` — Cron job for stuck PROCESSING reports + missed refunds

### File Storage
- S3-compatible storage (AWS S3, Cloudflare R2, MinIO, Supabase)
- Worker uploads to S3, stores object key in `resultFilePath`
- Download endpoint generates presigned URL (60s) and returns 302 redirect
- `local://` prefix in `resultFilePath` = local filesystem mode (dev fallback)
- Env vars: `S3_BUCKET`, `S3_REGION`, `S3_ENDPOINT`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`

## SEO Audit — Company Pages (2026-08-27)

### Audit Results (5000 sample pages on production)

| Metric | Result |
|--------|--------|
| HTTP 200 | 100% |
| Indexable | 70.6% (3532/5000) — 29.4% `noindex` due to quality gate (<2 financial statements) |
| Canonical OK | 100% |
| H1 OK | 100% |
| JSON-LD OK | 100% |
| Avg response time | 791ms |
| Name mismatches | 5.2% (262/5000) — DB name differed from page-displayed name |

### Critical Issue: On-Demand `seedFromRuz()` During Page Requests

**Root cause:** `getCompanyData()` in `lib/ruz.ts` was calling `seedFromRuz()` on-demand if a company had <5 financial statements and hadn't been synced in 7 days. This caused:
- 7-12 HTTP requests to RÚZ API per page visit
- 3+ DB writes per page visit (Company.name, FinancialStatement, CompanyPerson, etc.)
- Name mismatches: sitemap slug based on old DB name, page displayed new name from RÚZ
- **Unsafe for mass Google crawling** — would trigger thousands of DB writes during crawl

**Fix:** Removed on-demand re-seeding from `getCompanyData()`. It's now read-only for existing companies. Seeding happens only via:
- `/api/cron/reseed-all` (scheduled cron)
- `/api/seed-company/[ico]` (manual trigger)
- Worker pipeline

### Slug Validation + 308 Redirect

**Problem:** Company pages at `/firma/{ico}-{slug}` had stale slugs when company renamed in RÚZ. Sitemap had old slug, page displayed new name → Google saw inconsistency.

**Implementation:** Slug validation in `middleware.ts` (NOT `page.tsx`):
- `permanentRedirect()` in page.tsx is swallowed by Sentry's `wrapServerComponentWithSentry` — returns 200 instead of 308
- Middleware uses `NextResponse.redirect(308)` which bypasses Sentry entirely
- Middleware fetches company name from `/api/internal/company-slug/[ico]` (lightweight, no auth, protected by `x-middleware-internal` header)
- Uses `http://localhost:3000` for internal fetch (NOT `req.nextUrl.origin` which routes back through nginx and swallows the 308)

**Redirect behavior:**
- `/firma/{ico}` (no slug) → 308 → `/firma/{ico}-{correctSlug}`
- `/firma/{ico}-stale-slug` → 308 → `/firma/{ico}-{correctSlug}`
- `/firma/{ico}-correct-slug` → 200 (no redirect)
- `/firma/{nonexistent-ico}` → 200 (page.tsx handles 404)

**Slugify function** (`lib/slug.ts`): Must match between middleware and sitemap. Slovak diacritics stripped, non-alphanumeric → `-`, truncated to 60 chars, fallback `"firma"`.

### Known Issues (not blockers)

- `/sitemap.xml` index works correctly (returns `application/xml` with 39 child sitemaps: `/sitemap/0.xml` = hubs, `/sitemap/1.xml`–`/sitemap/38.xml` = companies)
- `META_DESC_TOO_LONG` (P2) — some company meta descriptions exceed 160 chars
- `TITLE_TOO_LONG` (P2) — some company titles exceed 60 chars
- `H1_NO_COMPANY_NAME` (P2) — H1 uses `IČO {ico}` fallback when name is null
