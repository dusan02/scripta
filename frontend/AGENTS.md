# Scripta/Verifa — Frontend Development Guide

## Build & Dev Commands

```bash
npm run dev          # Start dev server (port 3000)
npm run build        # Production build
npm run lint         # ESLint
npx tsc --noEmit     # Typecheck (no output files)
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

### Test Structure

- `e2e/billing.spec.ts` — Billing webhook → credit grant flow
- `e2e/report-auth.spec.ts` — IDOR protection, worker secret verification, cron auth
- `e2e/credits.spec.ts` — Credit system cron health checks, report creation guards
- `e2e/helpers.ts` — Test utilities (login, mock Stripe events)

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
