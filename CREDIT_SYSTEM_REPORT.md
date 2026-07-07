# Technical Report: Credit & Subscription System Implementation

**Project:** Verifa.sk (legal-tech SaaS)
**Date:** July 7, 2026
**Author:** Cascade (AI pair programmer)
**Purpose:** Review by another LLM / developer

---

## 1. Executive Summary

This report documents all changes made to the Verifa.sk frontend codebase to implement a complete credit and subscription lifecycle system. The work spans three major feature areas:

1. **Trial Credits Flow** — 5 free credits on registration, 30-day trial, redirect to pricing on expiry
2. **Subscription Plans + Stripe Integration** — 4 pricing tiers, Stripe checkout, webhook-based credit top-ups
3. **Rollover Credits with 90-day Expiry** — FIFO credit consumption, batch tracking, automated expiration, add-on purchases

The implementation touches the Prisma schema, API routes, authentication flow, Stripe integration, middleware, i18n translations, and dashboard UI components.

---

## 2. Database Schema Changes

### 2.1 User Model — New Fields

**File:** `/frontend/prisma/schema.prisma:12-34`

```prisma
model User {
  // ... existing fields ...
  planName           String?         // Názov paušálu (start, freelance, firma, korporat)
  planRenewalDate    DateTime?       // Dátum obnovenia paušálu
  trialEndsAt        DateTime?       // Koniec skúšobného obdobia (5 zadarmo kreditov na mesiac)
  subscriptionStatus String?         // active | canceled | past_due | trialing
  subscriptionEndsAt DateTime?       // Dátum ukončenia predplatného (pre zrušené)
  // ...
  creditBatches      CreditBatch[]
}
```

**Purpose:**
- `trialEndsAt` — Set to `now + 30 days` on registration. Used by dashboard to redirect to `/pricing` when trial expires.
- `planName` — Stores the active subscription tier (`start`, `freelance`, `firma`, `korporat`). Null means no active plan.
- `planRenewalDate` — Set to `now + 30 days` on each successful subscription payment.
- `subscriptionStatus` — Tracks Stripe subscription lifecycle (`active`, `canceled`).
- `subscriptionEndsAt` — For canceled subscriptions, the date when credits should be zeroed out.

### 2.2 CreditBatch Model — NEW

**File:** `/frontend/prisma/schema.prisma:322-336`

```prisma
model CreditBatch {
  id          String   @id @default(cuid())
  userId      String
  amount      Int      // Pôvodný počet kreditov v batchi
  remaining   Int      // Koľko ostáva k dispozícii
  source      String   // trial | subscription | addon | rollover
  planName    String?
  expiresAt   DateTime // 90 dní od vytvorenia
  createdAt   DateTime @default(now())

  user        User     @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId, expiresAt])
  @@index([userId, createdAt])
}
```

**Purpose:** Each credit grant (trial, subscription, addon, rollover refund) creates a batch with:
- `amount` / `remaining` — tracks how many credits were originally granted and how many are left
- `source` — provenance for audit trail and dashboard display
- `expiresAt` — 90 days from creation; cron job zeroes expired batches
- Indexed on `[userId, expiresAt]` for efficient expiration queries
- Indexed on `[userId, createdAt]` for efficient FIFO ordering

### 2.3 Existing Models (unchanged but relevant)

- **Wallet** (`balance: Decimal @db.Decimal(10,2)`, `version: Int` for optimistic locking) — remains as the aggregate balance. All CreditBatch operations also update the Wallet for backward compatibility.
- **WalletTransaction** (`type: CHARGE | TOPUP | REFUND`, `stripePaymentIntentId @unique`) — used for idempotency and audit trail. The `stripePaymentIntentId` unique constraint prevents double-crediting from duplicate webhook deliveries.

---

## 3. Credit Lifecycle — Implementation Details

### 3.1 Credit Granting: `addCreditBatch()`

**File:** `/frontend/src/lib/credits.ts:9-67`

```typescript
export async function addCreditBatch(
  userId: string,
  amount: number,
  source: "trial" | "subscription" | "addon" | "rollover",
  planName?: string,
  paymentIntentId?: string
): Promise<void>
```

**Logic:**
1. Ensures a Wallet exists (creates if missing)
2. **Idempotency check:** If `paymentIntentId` is provided, checks `WalletTransaction.findUnique({ where: { stripePaymentIntentId } })`. Returns early if transaction already exists.
3. Creates a `CreditBatch` with `remaining = amount`, `expiresAt = now + 90 days`
4. Increments `Wallet.balance` by `amount`
5. Creates a `WalletTransaction` (type `TOPUP`)

**Used in:**
- Email verification (`/api/auth/verify-email/route.ts:51`) — 5 trial credits
- OAuth sign-in (`/lib/auth.ts:180`) — 5 trial credits
- Stripe webhook `checkout.session.completed` (`/api/stripe/webhook/route.ts:52`) — subscription/addon credits
- Stripe webhook `invoice.paid` (`/api/stripe/webhook/route.ts:81`) — recurring subscription credits

### 3.2 Credit Consumption: `consumeCredits()` — FIFO

**File:** `/frontend/src/lib/credits.ts:74-129`

```typescript
export async function consumeCredits(
  userId: string,
  amount: number,
  reportRequestId?: string
): Promise<boolean>
```

**Logic:**
1. Fetches all non-expired batches (`remaining > 0`, `expiresAt > now`) ordered by `createdAt ASC` (oldest first)
2. Checks if total available >= requested amount; returns `false` if insufficient
3. Iterates batches in order, decrementing `remaining` from each until the requested amount is consumed
4. Decrements `Wallet.balance` by the total amount
5. Creates a `WalletTransaction` (type `CHARGE`) with `reportRequestId` for traceability

**Called in:** `/api/reports/route.ts:216` — after report is enqueued to worker, 1 credit is consumed.

**⚠️ Known Issue — Race Condition:** The `consumeCredits` function is NOT wrapped in a transaction. Concurrent report requests could both read the same batch state and double-spend. The original Wallet system used `version`-based optimistic locking, but this was not carried over to the CreditBatch operations. **Recommendation: wrap in `$transaction` with `SELECT ... FOR UPDATE` or use Prisma's interactive transactions.**

### 3.3 Credit Refund: `refundCredits()`

**File:** `/frontend/src/lib/credits.ts:134-212`

**Logic:**
1. Finds the original `CHARGE` transaction for the given `reportRequestId`
2. **Idempotency:** Checks if a `REFUND` transaction already exists for this report
3. Returns credits to the most recent non-expired batches (fills up `remaining` back toward `amount`)
4. If no batches have space, creates a new `rollover` batch with 90-day expiry
5. Increments `Wallet.balance` and creates `REFUND` transaction

**Note:** This function is implemented but NOT currently called anywhere in the codebase. The reports API does not refund credits on report failure. **Recommendation: integrate `refundCredits` into the report failure/callback flow.**

### 3.4 Credit Expiration: `expireOldCredits()`

**File:** `/frontend/src/lib/credits.ts:218-261`

**Logic:**
1. Finds all batches where `remaining > 0` AND `expiresAt <= now`
2. For each: sets `remaining = 0`, decrements `Wallet.balance`, creates `CHARGE` transaction with description "Expirácia kreditov"
3. Returns total expired credits count

**Called by:** Cron endpoint `/api/credits/expire/route.ts:21`

### 3.5 Subscription Cancellation: `cancelSubscription()` + `zeroOutExpiredSubscription()`

**File:** `/frontend/src/lib/credits.ts:266-338`

**`cancelSubscription(userId, endsAt)`:**
- Sets `subscriptionStatus = "canceled"` and `subscriptionEndsAt = endsAt`
- Credits remain valid until `subscriptionEndsAt`

**`zeroOutExpiredSubscription(userId)`:**
- Only acts if `subscriptionStatus === "canceled"` AND `subscriptionEndsAt < now`
- Zeroes all remaining batches, decrements wallet, creates audit transaction
- Clears `planName`, `planRenewalDate`, `subscriptionStatus`, `subscriptionEndsAt`

**Called by:** Cron endpoint for zeroed subscriptions, Stripe webhook for cancellation events.

---

## 4. Registration & Trial Flow

### 4.1 Email Registration

**File:** `/frontend/src/app/api/auth/verify-email/route.ts:42-51`

On email verification:
1. Sets `emailVerified = now`
2. Sets `trialEndsAt = now + 30 days`
3. Calls `addCreditBatch(userId, 5, "trial")` — creates wallet, CreditBatch (5 credits, 90-day expiry), and TOPUP transaction

### 4.2 OAuth Registration

**File:** `/frontend/src/lib/auth.ts:166-180`

In the NextAuth `signIn` callback, when a new OAuth user is created:
1. Creates User with `emailVerified = now`, `trialEndsAt = now + 30 days`
2. Calls `addCreditBatch(newUser.id, 5, "trial")`

**⚠️ Note:** The OAuth flow does NOT check if a wallet already exists before calling `addCreditBatch`. The `addCreditBatch` function handles this internally (upsert-like behavior), so this is safe.

---

## 5. Dashboard Redirect Logic

**File:** `/frontend/src/app/dashboard/page.tsx:32-62`

```typescript
const user = await prisma.user.findUnique({
  where: { id: session.user.id },
  select: { trialEndsAt: true, planName: true },
});

let userBalance = 0;
let userPlanName: string | null = null;

if (user) {
  const now = new Date();
  const trialExpired = user.trialEndsAt ? user.trialEndsAt < now : false;
  const hasPlan = !!user.planName;
  userPlanName = user.planName;

  const wallet = await prisma.wallet.findUnique({
    where: { userId: session.user.id },
    select: { balance: true },
  });
  userBalance = wallet ? Number(wallet.balance) : 0;

  // Only redirect to pricing if user has NO plan AND trial expired or no credits
  if (!hasPlan && (trialExpired || userBalance <= 0)) {
    redirect("/pricing");
  }
}
```

**Logic:**
- Users WITHOUT a plan: redirected to `/pricing` if trial expired OR balance = 0
- Users WITH an active plan: NOT redirected — they see the `AddonCredits` component instead
- `userBalance` and `userPlanName` are passed to `AddonCredits` as props

**⚠️ Note:** The redirect check uses `Wallet.balance` (the aggregate), not the sum of `CreditBatch.remaining`. These should be in sync, but if they diverge (e.g., due to the race condition in `consumeCredits`), the redirect logic could behave incorrectly.

---

## 6. Reports API — Credit Check & Deduction

**File:** `/frontend/src/app/api/reports/route.ts:108-116, 215-216`

**Pre-check (line 108-116):**
```typescript
const wallet = await prisma.wallet.findUnique({ where: { userId: user.id } });
const balance = wallet ? Number(wallet.balance) : 0;
if (balance <= 0) {
  return NextResponse.json(
    { error: "Nemáte dostatok kreditov. Vyberte si balíček v cenníku." },
    { status: 402 }
  );
}
```

**Deduction (line 215-216):**
```typescript
await consumeCredits(user.id, 1, reportRequest.id);
```

**⚠️ Issue:** The pre-check reads `Wallet.balance`, but the actual deduction happens via `consumeCredits` which reads `CreditBatch.remaining`. If these are out of sync, the pre-check could pass but `consumeCredits` could return `false` (silently failing). The return value of `consumeCredits` is not checked. **Recommendation: check the return value and handle the failure case.**

---

## 7. Stripe Integration

### 7.1 Checkout

**File:** `/frontend/src/app/api/stripe/checkout/route.ts:15-21`

```typescript
const PRICE_MAP = {
  start:     { priceId: STRIPE_PRICE_START,     mode: "payment",      credits: 5,   planName: "start" },
  freelance: { priceId: STRIPE_PRICE_FREELANCE, mode: "subscription", credits: 15,  planName: "freelance" },
  firma:     { priceId: STRIPE_PRICE_FIRMA,     mode: "subscription", credits: 40,  planName: "firma" },
  korporat:  { priceId: STRIPE_PRICE_KORPORAT,  mode: "subscription", credits: 100, planName: "korporat" },
  addon5:    { priceId: STRIPE_PRICE_ADDON5,    mode: "payment",      credits: 5,   planName: "addon" },
};
```

**Checkout session creation (line 37-44):**
- `mode` is `payment` for one-time purchases (start, addon5) and `subscription` for recurring plans
- `metadata` includes `userId`, `planId`, `credits`, `planName` — used by webhook to credit the user
- `success_url` and `cancel_url` point to `/plan?success=1` and `/plan?canceled=1`

### 7.2 Webhook Handler

**File:** `/frontend/src/app/api/stripe/webhook/route.ts:42-124`

Handles 4 event types:

| Event | Action |
|-------|--------|
| `checkout.session.completed` | Credits via `addCreditBatch`, sets `planName` + `planRenewalDate` + `subscriptionStatus=active` (for non-addon) |
| `invoice.paid` | Recurring subscription credits via `addCreditBatch`, renews `planRenewalDate` |
| `customer.subscription.deleted` | Calls `cancelSubscription(userId, endsAt)` |
| `customer.subscription.updated` | If `cancel_at_period_end`, calls `cancelSubscription(userId, endsAt)` |

**⚠️ Issue — `invoice.paid` metadata extraction:** The code attempts to read metadata from `invoice.parent?.subscription_details?.metadata`. This is a nested optional chain that may not work correctly with all Stripe API versions. The Stripe API version in use removed `current_period_end` from `Subscription` (it's now on `SubscriptionItem`), suggesting a newer API version where invoice metadata structure may differ.

**⚠️ Issue — `subscription.metadata` for userId:** The webhook reads `userId` from `subscription.metadata`, but the checkout session metadata is set on the session, not the subscription. Stripe does not automatically copy session metadata to the subscription. **Recommendation: explicitly set `subscription_data.metadata` in the checkout session creation, or retrieve the subscription's customer and look up the user by email.**

---

## 8. Add-on Credits Component

**File:** `/frontend/src/components/AddonCredits.tsx`

**Display conditions (line 49):**
```typescript
if (dismissed || balance > 0 || !planName || planName === "start") {
  return null;
}
```

- Shows ONLY when: `balance === 0` AND user has an active subscription plan (`freelance`, `firma`, `korporat`)
- Hidden for: users with credits, no plan, or `start` (one-time purchase, not a subscription)
- User can dismiss the component (session-only, resets on page reload)

**Offer:** 5 reports for €59 (higher margin than subscription per-report price)

**Upsell:** For `freelance` users → suggests `firma`; for `firma` users → suggests `korporat`. Links to `/pricing`.

**Checkout:** Calls `POST /api/stripe/checkout` with `{ planId: "addon5" }`, redirects to Stripe URL.

---

## 9. Credit Overview Widget

**File:** `/frontend/src/components/CreditOverview.tsx`

Client component that fetches `GET /api/credits/batches` and displays:
- **Total available credits** — sum of all non-expired batch `remaining` values
- **Rollover credits** — sum of batches where `source === "rollover"`
- **Expiring soon** — sum of batches where `expiresAt <= now + 30 days`

Hidden when `totalAvailable === 0`.

**API:** `/frontend/src/app/api/credits/batches/route.ts` — calls `getCreditOverview(session.user.id)`

---

## 10. Cron Endpoint — Credit Expiration

**File:** `/frontend/src/app/api/credits/expire/route.ts`

```typescript
export async function POST(req: Request) {
  const authHeader = req.headers.get("authorization");
  const expectedSecret = process.env.CRON_SECRET;
  // ... auth check ...
  const expiredCredits = await expireOldCredits();
  const canceledUsers = await prisma.user.findMany({
    where: { subscriptionStatus: "canceled", subscriptionEndsAt: { lte: new Date() } },
  });
  for (const user of canceledUsers) {
    zeroedCredits += await zeroOutExpiredSubscription(user.id);
  }
}
```

**Security:** Protected by `CRON_SECRET` env var (Bearer token auth)
**Recommended schedule:** Daily (via Vercel Cron, GitHub Actions, or external scheduler)

---

## 11. Middleware

**File:** `/frontend/src/middleware.ts`

```typescript
export const config = {
  matcher: ["/dashboard", "/reports/:path*", "/history/:path*", "/settings/:path*", "/messages/:path*", "/admin/:path*", "/plan"],
};
```

Uses NextAuth middleware to require authentication on all listed routes. `/plan` was added to protected routes.

---

## 12. Pricing Page

**File:** `/frontend/src/app/pricing/page.tsx:66-115`

4 plans:

| Plan | Type | Credits | Price | Price/Report |
|------|------|---------|-------|-------------|
| Štart | One-time | 5 | €49 | €9.80 |
| Freelance | Monthly | 15 | €39/mo | €2.60 |
| Firma | Monthly | 40 | €99/mo | €2.48 |
| Korporát | Monthly | 100 | €249/mo | €2.49 |

Firma is highlighted as the recommended plan. All subscription plans include `pricing.featRollOver` (rollover credits feature).

---

## 13. i18n Translations

**File:** `/frontend/src/lib/i18n.ts`

Added translation keys in 3 languages (SK, EN, DE) for:
- `pricing.start`, `pricing.freelance`, `pricing.firma`, `pricing.korporat` + subtitles + feature keys
- `addon.*` — Add-on credits component (title, description, buy button, upsell, close)
- `creditOverview.*` — Dashboard widget (title, total, rollover, expiring, hint)

---

## 14. Environment Variables

**File:** `/frontend/.env.example`

```
STRIPE_SECRET_KEY="sk_test_..."
STRIPE_WEBHOOK_SECRET="whsec_..."
STRIPE_PRICE_START="price_..."
STRIPE_PRICE_FREELANCE="price_..."
STRIPE_PRICE_FIRMA="price_..."
STRIPE_PRICE_KORPORAT="price_..."
STRIPE_PRICE_ADDON5="price_..."
CRON_SECRET="your-cron-secret-here"
```

---

## 15. Complete File Inventory

### New Files Created
| File | Purpose |
|------|---------|
| `/frontend/src/lib/credits.ts` | Core credit logic: addCreditBatch, consumeCredits (FIFO), refundCredits, expireOldCredits, cancelSubscription, zeroOutExpiredSubscription, getCreditOverview |
| `/frontend/src/components/AddonCredits.tsx` | Dashboard widget: "Dokúpiť kredity" shown when balance=0 + active subscription |
| `/frontend/src/components/CreditOverview.tsx` | Dashboard widget: credit overview with total/rollover/expiring |
| `/frontend/src/app/api/credits/expire/route.ts` | Cron endpoint for credit expiration + subscription cleanup |
| `/frontend/src/app/api/credits/batches/route.ts` | API endpoint for credit overview data |

### Modified Files
| File | Changes |
|------|---------|
| `/frontend/prisma/schema.prisma` | Added `trialEndsAt`, `subscriptionStatus`, `subscriptionEndsAt` to User; added `CreditBatch` model; added `creditBatches` relation on User |
| `/frontend/src/app/api/auth/verify-email/route.ts` | Replaced manual wallet+transaction creation with `addCreditBatch(userId, 5, "trial")` |
| `/frontend/src/lib/auth.ts` | Replaced manual wallet+transaction creation with `addCreditBatch(newUser.id, 5, "trial")` in OAuth flow; added import |
| `/frontend/src/app/api/stripe/checkout/route.ts` | Added `addon5` to PRICE_MAP |
| `/frontend/src/app/api/stripe/webhook/route.ts` | Replaced `addCredits` with `addCreditBatch`; added subscription cancellation handling (`customer.subscription.deleted`, `customer.subscription.updated`); added `subscriptionStatus` tracking |
| `/frontend/src/app/api/reports/route.ts` | Added `consumeCredits` import; replaced inline wallet check with simpler balance check; added FIFO credit deduction after report creation |
| `/frontend/src/app/dashboard/page.tsx` | Added `AddonCredits` + `CreditOverview` components; changed redirect logic to not redirect users with active plans; passes `balance` and `planName` to `AddonCredits` |
| `/frontend/src/app/pricing/page.tsx` | Replaced old packages with 4 new plans (start, freelance, firma, korporat) |
| `/frontend/src/lib/i18n.ts` | Added SK/EN/DE translations for pricing plans, addon component, credit overview widget |
| `/frontend/src/middleware.ts` | Added `/plan` to protected routes |
| `/frontend/.env.example` | Added `STRIPE_PRICE_*` env vars and `CRON_SECRET` |

---

## 16. Known Issues & Recommendations

### 🔴 Critical

1. **Race condition in `consumeCredits`** — Not wrapped in a transaction. Concurrent report requests could both read the same batch state and double-spend credits. **Fix:** Wrap the read+decrement+wallet update in `prisma.$transaction()` with row-level locking.

2. **`consumeCredits` return value not checked** — In `/api/reports/route.ts:216`, the return value of `consumeCredits` is ignored. If it returns `false` (insufficient batch credits despite wallet balance > 0), the report proceeds without deducting. **Fix:** Check return value and return 402 if false.

3. **Stripe subscription metadata** — The webhook reads `userId` from `subscription.metadata`, but checkout session metadata is NOT automatically copied to the subscription by Stripe. **Fix:** Add `subscription_data: { metadata: { userId, planName, credits } }` to the checkout session creation.

### 🟡 Moderate

4. **Wallet balance vs CreditBatch sum divergence** — The pre-check in reports API reads `Wallet.balance`, but `consumeCredits` reads `CreditBatch.remaining`. If these diverge (e.g., due to race conditions or bugs), behavior is inconsistent. **Fix:** Use `getCreditOverview` or sum of batches for the pre-check, or ensure all operations are transactional.

5. **`refundCredits` not integrated** — The function exists but is never called. Failed reports do not refund credits. **Fix:** Call `refundCredits` in the report failure callback/worker callback.

6. **`expireOldCredits` not transactional** — Each batch expiration is a separate set of DB operations. A failure mid-loop could leave some batches expired and others not, with wallet balance partially decremented. **Fix:** Wrap each batch's expiration in a transaction, or use a single bulk operation.

7. **No Stripe webhook retry handling** — If the webhook handler throws after partially processing (e.g., credits added but subscription status update fails), Stripe will retry the event. The idempotency check on `stripePaymentIntentId` prevents double-crediting, but the subscription status update is not idempotent. **Fix:** Make all webhook operations idempotent or transactional.

### 🟢 Low Priority

8. **DB migration not applied** — `prisma db push` has not been run because Docker/PostgreSQL is not running. The `CreditBatch` table does not exist in the database yet. **Action:** Start Docker, run `npx prisma db push`.

9. **No Stripe webhook signature verification in dev** — The webhook requires `STRIPE_WEBHOOK_SECRET` to be set. In development, this needs to be configured via Stripe CLI.

10. **Add-on price hardcoded** — `ADDON_CREDITS = 5` and `ADDON_PRICE = "59"` are hardcoded in the component. **Recommendation:** Move to environment variables or a config file.

11. **No credit history UI** — The `WalletTransaction` table records all credit operations, but there's no UI to view transaction history. **Recommendation:** Add a credit history page or expand the `/plan` page.

12. **90-day expiry not in Terms of Service** — The business requirement states this should be mentioned in Obchodné podmienky. **Action:** Update legal documents.

---

## 17. Data Flow Diagram

```
Registration (Email/OAuth)
    │
    ├── addCreditBatch(userId, 5, "trial")
    │   ├── Create CreditBatch (amount=5, remaining=5, expiresAt=now+90d)
    │   ├── Create/Update Wallet (balance += 5)
    │   └── Create WalletTransaction (TOPUP)
    │
    └── Set trialEndsAt = now + 30d
         │
         ▼
    Dashboard loads
    │
    ├── User has plan? NO → trial expired OR balance=0? → redirect /pricing
    ├── User has plan? YES → balance=0? → show AddonCredits widget
    └── Always → show CreditOverview widget (if credits > 0)
         │
         ▼
    User creates report
    │
    ├── Pre-check: Wallet.balance > 0? NO → 402 error
    ├── Create ReportRequest → enqueue to worker
    └── consumeCredits(userId, 1, reportId)
        ├── Find oldest non-expired batches (FIFO)
        ├── Decrement batch.remaining
        ├── Decrement Wallet.balance
        └── Create WalletTransaction (CHARGE)
             │
             ▼
    Stripe payment (checkout.session.completed)
    │
    ├── addCreditBatch(userId, credits, source, planName, paymentIntentId)
    │   ├── Idempotency check (stripePaymentIntentId)
    │   ├── Create CreditBatch (expiresAt=now+90d)
    │   ├── Increment Wallet.balance
    │   └── Create WalletTransaction (TOPUP)
    │
    └── Set planName, planRenewalDate, subscriptionStatus=active
         │
         ▼
    Cron job (daily) → POST /api/credits/expire
    │
    ├── expireOldCredits()
    │   ├── Find batches where expiresAt <= now AND remaining > 0
    │   ├── Set remaining = 0
    │   ├── Decrement Wallet.balance
    │   └── Create WalletTransaction (CHARGE, "Expirácia")
    │
    └── zeroOutExpiredSubscription()
        ├── Find users where subscriptionStatus=canceled AND subscriptionEndsAt < now
        ├── Zero all batches, decrement wallet
        └── Clear planName, subscriptionStatus, etc.
```

---

## 18. Security Considerations

1. **Cron endpoint auth** — Protected by Bearer token (`CRON_SECRET`). Ensure this secret is strong and not committed to git.
2. **Stripe webhook signature** — Verified using `STRIPE_WEBHOOK_SECRET`. Never log the raw body or signature.
3. **Credit balance as Decimal** — `Wallet.balance` is `Decimal(10,2)` to prevent floating-point errors. However, `CreditBatch.remaining` is `Int` (credits are whole units). The `consumeCredits` function converts appropriately.
4. **No user-facing credit manipulation** — All credit operations are server-side only. No API endpoint allows users to directly modify their balance.
5. **Idempotency** — `stripePaymentIntentId` is `@unique` on `WalletTransaction`, preventing double-crediting from duplicate webhook deliveries.

---

## 19. Testing Checklist

- [ ] Register via email → verify email → check 5 trial credits appear in wallet + CreditBatch
- [ ] Register via Google OAuth → check 5 trial credits appear
- [ ] Create 1 report → check 1 credit deducted (FIFO from oldest batch)
- [ ] Exhaust all credits → dashboard shows AddonCredits widget (if has plan)
- [ ] Exhaust all credits without plan → dashboard redirects to /pricing
- [ ] Purchase "start" plan → check 5 credits added, planName set
- [ ] Purchase "freelance" subscription → check 15 credits added, planRenewalDate set
- [ ] Stripe webhook `invoice.paid` → check recurring credits added
- [ ] Cancel subscription → check subscriptionStatus=canceled, credits remain until subscriptionEndsAt
- [ ] Run cron after subscriptionEndsAt → check all credits zeroed, plan cleared
- [ ] Wait 90 days (or manipulate expiresAt) → run cron → check expired credits zeroed
- [ ] CreditOverview widget shows correct totals
- [ ] Addon checkout → redirects to Stripe → credits added on success
- [ ] Upsell link appears for freelance/firma users, not for korporat

---

*End of report.*
