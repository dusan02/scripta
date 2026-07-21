# Follow-up Analysis: User Account & Credit System — Edge Cases & Blind Spots

**Date:** 2026-07-21  
**Project:** Verifa.sk / Scripta  
**Scope:** Worker failure refund loophole, locking strategy, Stripe/Paddle decoupling, unprotected API routes, brute-force protection

---

## Table of Contents

1. [Worker Failure Refund Loophole (Critical)](#1-worker-failure-refund-loophole-critical)
2. [Redundant Locking Strategy Risk (Performance)](#2-redundant-locking-strategy-risk-performance)
3. [Stripe vs. Paddle Decoupling (Architecture)](#3-stripe-vs-paddle-decoupling-architecture)
4. [Unprotected API Routes Audit (Security)](#4-unprotected-api-routes-audit-security)
5. [NextAuth Brute-Force Protection (Security)](#5-nextauth-brute-force-protection-security)

---

## 1. Worker Failure Refund Loophole (Critical)

### Finding: Users ARE losing credits for failed reports

**Yes, this is a confirmed critical bug.** The worker does NOT communicate a refund request back to the frontend Wallet system when a report fails.

### Current Flow Analysis

**Step 1 — Frontend deducts credit BEFORE enqueue:**

```typescript
// frontend/src/app/api/reports/route.ts:176-188
const creditConsumed = await consumeCredits(user.id, 1, reportRequest.id);

if (!creditConsumed) {
  await prisma.reportRequest.update({
    where: { id: reportRequest.id },
    data: { status: "FAILED" }
  });
  return NextResponse.json(
    { error: "Nepodarilo sa stiahnuť kredity. Skúste to znova alebo kontaktujte podporu." },
    { status: 402 }
  );
}
```

**Step 2 — If enqueue fails, frontend refunds:**

```typescript
// frontend/src/app/api/reports/route.ts:208-223
} catch (workerErr) {
  console.error("Worker enqueue failed", workerErr);
  await refundCredits(user.id, 1, reportRequest.id);  // ✅ Refund happens
  await prisma.reportRequest.update({
    where: { id: reportRequest.id },
    data: { status: "FAILED" },
  });
  return NextResponse.json(
    { error: "Komunikácia s workerom zlyhala. Report nebol uložený, skúste znova." },
    { status: 503 }
  );
}
```

**Step 3 — Worker processes report. If it fails... NOTHING happens to credits:**

```python
# worker/src/main.py:446-463
final_status = _determine_final_status(sources)

# Automaticky vytvor bug report ak status je FAILED
if final_status == "FAILED":
    # ... create bug report ...
    pass

# ── Kreditná operácia: len ak COMPLETED ─────────────────────────
if final_status == "COMPLETED":
    await _charge_credit(task.report_request_id)  # ← Mŕtvy kód (starý systém)
else:
    _log.info(f"[{_rid}] Status {final_status} — kredit neodpočítaný")
    # ← ŽIADNY REFUND! Kredit bol už odpočítaný na fronte!
```

**Step 4 — Worker sends email notification (no refund):**

```python
# worker/src/main.py:473-483
frontend_url = os.environ.get("NEXTAUTH_URL", "http://localhost:3000")
worker_secret = os.environ.get("WORKER_SECRET", "")
async with httpx.AsyncClient(timeout=10) as client:
    await client.post(
        f"{frontend_url}/api/reports/{task.report_request_id}/notify",
        headers={"x-worker-secret": worker_secret},
    )
```

The notify endpoint only sends an email — it does NOT refund credits:

```typescript
// frontend/src/app/api/reports/[id]/notify/route.ts:13-16
const authHeader = req.headers.get("x-worker-secret");
if (authHeader !== process.env.WORKER_SECRET) {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}
// ... only sends email, no refund logic ...
```

**Step 5 — Worker crash scenario (even worse):**

```python
# worker/src/main.py:492-500
except Exception as exc:
    _log.error(f"[{_rid}] Report {task.report_request_id} failed", exc_info=True)
    await update_report_status(task.report_request_id, "FAILED")
    await create_bug_report(
        task.report_request_id,
        f"Výnimka: {type(exc).__name__}: {exc}",
    )
    raise  # ← No refund, credit is permanently lost
```

### Summary of Refund Coverage

| Failure Scenario | Refund Happens? | Where |
|---|---|---|
| `consumeCredits` fails (insufficient balance) | N/A — no credit deducted | `reports/route.ts:179` |
| Worker enqueue fails (network error) | ✅ Yes | `reports/route.ts:212` |
| User cancels within 8 seconds | ✅ Yes | `reports/[id]/cancel/route.ts:70` |
| Worker processes but scrapers fail → `FAILED` | ❌ **NO** | `main.py:460-463` |
| Worker processes but AI pipeline crashes → `FAILED` | ❌ **NO** | `main.py:492-500` |
| Worker processes, partial success → `PARTIAL` | ❌ **NO** | `main.py:460-463` |
| Worker crashes entirely (OOM, segfault) | ❌ **NO** | Report stuck in `PROCESSING` |
| `recover_stale_reports` marks as `FAILED` | ❌ **NO** | `cleanup.py:149-152` |

### Impact

Every report that reaches the worker but doesn't end as `COMPLETED` results in a **permanent credit loss** for the user. This includes:
- Scraper timeouts (180s limit)
- LLM API failures
- PDF compilation errors
- Playwright/browser crashes
- Any unhandled Python exception

### Recommended Fix

**Option A — Worker-side refund via frontend API (preferred):**

Add a new endpoint `/api/reports/[id]/refund` on the frontend that the worker calls when a report fails:

```typescript
// frontend/src/app/api/reports/[id]/refund/route.ts
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const authHeader = req.headers.get("x-worker-secret");
  if (authHeader !== process.env.WORKER_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const report = await prisma.reportRequest.findUnique({
    where: { id: params.id },
    select: { userId: true, status: true },
  });

  if (!report) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Only refund if status is FAILED or PARTIAL
  if (!["FAILED", "PARTIAL"].includes(report.status)) {
    return NextResponse.json({ error: "Not eligible for refund" }, { status: 422 });
  }

  // refundCredits is idempotent — safe to call even if already refunded
  await refundCredits(report.userId, 1, params.id);

  return NextResponse.json({ refunded: true });
}
```

Then in the worker, call this endpoint when `final_status != "COMPLETED"`:

```python
# worker/src/main.py — after update_report_status
if final_status != "COMPLETED":
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            await client.post(
                f"{frontend_url}/api/reports/{task.report_request_id}/refund",
                headers={"x-worker-secret": worker_secret},
            )
    except Exception as refund_err:
        _log.warning(f"[{_rid}] Refund request failed: {refund_err}")
```

**Option B — Cron-based reconciliation (safety net):**

Add a cron job that scans for `FAILED` reports without a corresponding `REFUND` transaction and refunds them:

```typescript
// In credits/expire cron or a new cron
const failedReports = await prisma.reportRequest.findMany({
  where: {
    status: { in: ["FAILED", "PARTIAL"] },
    createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) }, // last 24h
  },
  select: { id: true, userId: true },
});

for (const report of failedReports) {
  // Check if refund already exists (idempotency)
  const existingRefund = await prisma.walletTransaction.findFirst({
    where: { type: "REFUND", reportRequestId: report.id },
  });
  if (!existingRefund) {
    await refundCredits(report.userId, 1, report.id);
  }
}
```

**Recommendation:** Implement **both** — Option A for immediate refund, Option B as a safety net for edge cases (worker crash, network failure between worker and frontend).

**Decision needed:** Should `PARTIAL` reports also get a refund? Currently a partial report (some scrapers succeeded, some failed) still delivers value. Consider:
- `FAILED` → full refund (no value delivered)
- `PARTIAL` → no refund or 50% refund (partial value delivered)

---

## 2. Redundant Locking Strategy Risk (Performance)

### Finding: Yes, mixing pessimistic + optimistic locking is an anti-pattern

### Current Code Analysis

In `consumeCredits`, the same transaction uses BOTH:

```typescript
// frontend/src/lib/credits.ts:86-133
return await prisma.$transaction(async (tx) => {
  // 1. PESSIMISTIC LOCK — row-level lock on Wallet
  const walletRows = await tx.$queryRaw<any[]>`
    SELECT * FROM "Wallet" WHERE "userId" = ${userId} FOR UPDATE
  `;
  const wallet = walletRows[0];
  if (!wallet) return false;

  // 2. PESSIMISTIC LOCK — row-level lock on CreditBatches
  const batches = await tx.$queryRaw<any[]>`
    SELECT * FROM "CreditBatch" 
    WHERE "userId" = ${userId} AND remaining > 0 AND "expiresAt" > NOW() 
    ORDER BY "createdAt" ASC 
    FOR UPDATE
  `;

  // 3. Deduct from batches...

  // 4. OPTIMISTIC LOCK — conditional update with version check
  const updated = await tx.wallet.updateMany({
    where: { id: wallet.id, version: wallet.version },  // ← version check
    data: { balance: { decrement: amount }, version: { increment: 1 } },
  });

  if (updated.count === 0) {
    throw new Error("Wallet version conflict");  // ← triggers retry
  }
});
```

### Why This Is Problematic

1. **Redundant contention:** The `FOR UPDATE` lock already guarantees exclusive access to the row. No other transaction can modify the Wallet until this transaction commits. The `version` check can never fail because no one else can update the row while it's locked.

2. **The `version` conflict can only self-trigger:** Since `FOR UPDATE` prevents concurrent modifications, the only way `updated.count === 0` could happen is if the row was deleted between the SELECT and UPDATE — which is impossible in normal operation.

3. **Unnecessary retry loop:** The 3-retry loop with 10ms backoff exists for the optimistic locking pattern, but since pessimistic locking prevents conflicts, the retry loop is dead code that adds latency on every call.

4. **Potential deadlock under load:** If two concurrent transactions for different users somehow share a batch (impossible in current schema, but fragile), the `FOR UPDATE` locks could deadlock. The optimistic locking adds no protection here.

5. **Inconsistency with `refundCredits`:** The `refundCredits` function uses `FOR UPDATE` on Wallet but does NOT use optimistic locking for the final update:

```typescript
// frontend/src/lib/credits.ts:233-239
await tx.wallet.update({
  where: { userId },
  data: {
    balance: { increment: amount },
    version: { increment: 1 },  // ← No version check in WHERE
  },
});
```

This means `refundCredits` increments `version` but doesn't check it, while `consumeCredits` both checks and increments. This inconsistency could cause `consumeCredits` to fail if a refund happens between the SELECT and UPDATE within a consume transaction (impossible due to `FOR UPDATE`, but conceptually inconsistent).

### Recommended Fix

**Choose ONE strategy. Pessimistic locking is the right choice here** because:
- Credit operations are short-lived (milliseconds)
- The contention is per-user (low conflict probability)
- `FOR UPDATE` provides stronger guarantees than optimistic locking
- The retry loop adds unnecessary complexity

**Simplified `consumeCredits`:**

```typescript
export async function consumeCredits(
  userId: string,
  amount: number,
  reportRequestId?: string
): Promise<boolean> {
  return await prisma.$transaction(async (tx) => {
    // Pessimistic lock on wallet
    const walletRows = await tx.$queryRaw<any[]>`
      SELECT * FROM "Wallet" WHERE "userId" = ${userId} FOR UPDATE
    `;
    const wallet = walletRows[0];
    if (!wallet) return false;

    if (Number(wallet.balance) < amount) return false;

    // Pessimistic lock on batches (FIFO)
    const batches = await tx.$queryRaw<any[]>`
      SELECT * FROM "CreditBatch" 
      WHERE "userId" = ${userId} AND remaining > 0 AND "expiresAt" > NOW() 
      ORDER BY "createdAt" ASC 
      FOR UPDATE
    `;

    const totalAvailable = batches.reduce((sum, b) => sum + b.remaining, 0);
    if (totalAvailable < amount) return false;

    let toConsume = amount;
    for (const batch of batches) {
      if (toConsume <= 0) break;
      const deduct = Math.min(batch.remaining, toConsume);
      await tx.creditBatch.update({
        where: { id: batch.id },
        data: { remaining: { decrement: deduct } },
      });
      toConsume -= deduct;
    }

    // Simple update — no version check needed (FOR UPDATE guarantees exclusivity)
    await tx.wallet.update({
      where: { id: wallet.id },
      data: {
        balance: { decrement: amount },
        version: { increment: 1 },
      },
    });

    await tx.walletTransaction.create({
      data: {
        walletId: wallet.id, amount, type: "CHARGE", status: "COMPLETED",
        reportRequestId: reportRequestId || null,
        description: `Spotreba kreditov — report${reportRequestId ? ` ${reportRequestId}` : ""}`,
      },
    });

    return true;
  });
}
```

**Changes:**
- Removed `updateMany` with version check → simple `update`
- Removed 3-retry loop + backoff
- Removed `MAX_RETRIES`, `lastError` variables
- `version` field still incremented (for audit/observability) but not checked
- ~40 lines simpler, no dead code, no unnecessary retries

---

## 3. Stripe vs. Paddle Decoupling (Architecture)

### Current Coupling Analysis

### Hardcoded Stripe References

| Location | Coupling | Severity |
|---|---|---|
| `WalletTransaction.stripePaymentIntentId` | Schema field name | High |
| `stripe/checkout/route.ts` | Stripe SDK, `PRICE_MAP` with Stripe price IDs | High |
| `stripe/webhook/route.ts` | Stripe SDK, event types, `stripe.webhooks.constructEvent` | High |
| `stripe/portal/route.ts` | Stripe SDK, `billingPortal.sessions.create` | High |
| `credits.ts:addCreditBatch` | `stripePaymentIntentId` parameter for idempotency | Medium |
| `credits.ts:cancelSubscription` | No Stripe reference (operates on DB only) | None |
| `auth.ts` | No Stripe reference | None |

### Schema Migration Strategy

**Current schema:**

```prisma
model WalletTransaction {
  id                    String             @id @default(cuid())
  walletId              String
  amount                Decimal            @db.Decimal(10, 2)
  type                  TransactionType
  status                TransactionStatus  @default(COMPLETED)
  reportRequestId       String?
  stripePaymentIntentId String?            @unique  // ← Stripe-specific
  description           String?
  createdAt             DateTime           @default(now())
  // ...
}
```

**Proposed schema (provider-agnostic):**

```prisma
// New enum
enum PaymentProvider {
  STRIPE
  PADDLE
  MANUAL  // For admin-adjusted credits
}

model WalletTransaction {
  id                      String             @id @default(cuid())
  walletId                String
  amount                  Decimal            @db.Decimal(10, 2)
  type                    TransactionType
  status                  TransactionStatus  @default(COMPLETED)
  reportRequestId         String?
  
  // Renamed + generalized
  provider                PaymentProvider?   // null for non-payment transactions
  providerReference       String?            @unique  // Stripe payment_intent ID, Paddle transaction ID, etc.
  
  description             String?
  createdAt               DateTime           @default(now())
  // ...
  @@index([provider, providerReference])
}
```

**Migration steps:**

1. Add new fields `provider` and `providerReference` (nullable)
2. Backfill: `provider = "STRIPE"`, `providerReference = stripePaymentIntentId` for all existing rows
3. Drop `stripePaymentIntentId` column
4. Update `addCreditBatch` signature:

```typescript
export async function addCreditBatch(
  userId: string,
  amount: number,
  source: "trial" | "subscription" | "addon" | "rollover",
  planName?: string,
  providerReference?: string,  // ← was paymentIntentId
  provider?: PaymentProvider   // ← new
): Promise<void> {
  // ...
  if (providerReference) {
    const existing = await tx.walletTransaction.findUnique({
      where: { providerReference },  // ← was stripePaymentIntentId
    });
    if (existing) return;
  }
  // ...
  await tx.walletTransaction.create({
    data: {
      // ...
      provider: provider || null,
      providerReference: providerReference || null,
    },
  });
}
```

### Webhook Decoupling Strategy

**Current:** Stripe webhook directly calls `addCreditBatch` and `prisma.user.update`.

**Proposed:** Introduce a billing abstraction layer:

```
frontend/src/lib/billing/
  ├── types.ts          — Common interfaces (SubscriptionEvent, PaymentEvent)
  ├── stripe.ts         — Stripe-specific adapter
  ├── paddle.ts         — Paddle-specific adapter (future)
  └── index.ts          — Provider factory based on env var
```

**Example adapter interface:**

```typescript
// frontend/src/lib/billing/types.ts
export interface PaymentProviderAdapter {
  handleWebhook(body: string, signature: string): Promise<WebhookResult>;
  createCheckoutSession(params: CheckoutParams): Promise<{ url: string }>;
  createPortalSession(userId: string): Promise<{ url: string }>;
  cancelSubscription(userId: string): Promise<void>;
}

export type WebhookResult = {
  type: "payment.succeeded" | "subscription.canceled" | "subscription.updated" | "payment.failed";
  userId: string;
  credits: number;
  planName?: string;
  providerReference: string;
};
```

**Provider factory:**

```typescript
// frontend/src/lib/billing/index.ts
import { StripeAdapter } from "./stripe";
import { PaddleAdapter } from "./paddle";

export function getBillingProvider(): PaymentProviderAdapter {
  const provider = process.env.BILLING_PROVIDER || "stripe";
  switch (provider) {
    case "stripe": return new StripeAdapter();
    case "paddle": return new PaddleAdapter();
    default: throw new Error(`Unknown billing provider: ${provider}`);
  }
}
```

**Webhook route becomes provider-agnostic:**

```typescript
// frontend/src/app/api/billing/webhook/route.ts
export async function POST(req: NextRequest) {
  const provider = getBillingProvider();
  const body = await req.text();
  const signature = req.headers.get("signature") || "";

  try {
    const result = await provider.handleWebhook(body, signature);
    
    switch (result.type) {
      case "payment.succeeded":
        await addCreditBatch(result.userId, result.credits, "subscription",
          result.planName, result.providerReference);
        break;
      case "subscription.canceled":
        await cancelSubscription(result.userId, new Date());
        break;
      // ...
    }
    return NextResponse.json({ received: true });
  } catch (error) {
    console.error("Billing webhook error:", error);
    return NextResponse.json({ error: "Webhook failed" }, { status: 500 });
  }
}
```

### Migration Effort Estimate

| Step | Effort | Risk |
|---|---|---|
| Schema migration (add fields, backfill, drop old) | 2h | Low — additive first |
| Update `credits.ts` to use `providerReference` | 1h | Low |
| Create billing abstraction layer | 4h | Medium — new code |
| Rewrite Stripe adapter | 3h | Medium — refactor existing |
| Update webhook/checkout/portal routes | 2h | Low — thin wrappers |
| Testing | 3h | — |
| **Total** | **~15h** | |

---

## 4. Unprotected API Routes Audit (Security)

### Scan Results

All 28 API routes were scanned for authentication checks. Here are the findings:

### Routes Without Authentication (by design)

| Route | Auth | Intentional? | Risk |
|---|---|---|---|
| `auth/[...nextauth]/route.ts` | None | ✅ Yes — NextAuth handler | None |
| `auth/register/route.ts` | Rate limit only | ✅ Yes — public registration | Low |
| `auth/forgot-password/route.ts` | Rate limit only | ✅ Yes — public password reset | Low |
| `auth/reset-password/route.ts` | Rate limit only | ✅ Yes — token-based auth | Low |
| `auth/verify-email/route.ts` | Token-based | ✅ Yes — token in URL | Low |

### Routes Missing Authentication (SECURITY ISSUES)

| Route | Auth | Risk | Issue |
|---|---|---|---|
| `company/[ico]/route.ts` | **NONE** | **HIGH** | Anyone can query full company financial data from DB |
| `lookup/route.ts` | **NONE** | **MEDIUM** | Anyone can proxy ORSR lookups (scraping risk) |
| `pdf/[ico]/route.ts` | **NONE** | **CRITICAL** | Anyone can download any PDF report by IČO |

### Detailed Analysis

#### CRITICAL: `/api/pdf/[ico]/route.ts` — Unauthenticated PDF Download

```typescript
// frontend/src/app/api/pdf/[ico]/route.ts:5-35
export async function GET(
  request: Request,
  { params }: { params: { ico: string } }
) {
  const ico = params.ico;
  
  // No auth check — anyone with an IČO can download the report
  const projectRoot = path.join(process.cwd(), '..');
  const filePath = path.join(projectRoot, 'worker', 'assets', ico, `Verifa_Forensic_Report_${ico}.pdf`);
  
  if (!fs.existsSync(filePath)) {
    return NextResponse.json({ error: 'Report nenájdený' }, { status: 404 });
  }
  
  const fileBuffer = fs.readFileSync(filePath);
  return new NextResponse(fileBuffer, {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="Verifa_Forensic_Report_${ico}.pdf"`,
    },
  });
}
```

**Impact:** Any person who knows (or guesses) an IČO can download the full forensic report for that company. This includes:
- Financial statements
- Auditor opinions
- Vestník events (bankruptcies, executions)
- Risk assessments
- Verifa score

**Note:** This route appears to be a legacy/dev-only endpoint. The production download path is `/api/reports/[id]/download` which has proper auth + ownership checks. However, this route is still accessible in production.

**Fix:** Add authentication and ownership verification, or remove the route entirely.

#### HIGH: `/api/company/[ico]/route.ts` — Unauthenticated Company Data

```typescript
// frontend/src/app/api/company/[ico]/route.ts:4-43
export async function GET(
  request: NextRequest,
  { params }: { params: { ico: string } }
) {
  const ico = params.ico;

  // No auth check
  const company = await prisma.company.findUnique({
    where: { ico },
    include: {
      financialStatements: {
        orderBy: { year: "desc" },
        include: { auditorOpinion: true },
      },
    },
  });

  return NextResponse.json({ data: company });
}
```

**Impact:** Anyone can query the full financial history of any company in the database, including auditor opinions. This is the data that users pay credits to access via reports.

**Fix:** Add `getCurrentUser` check. Consider also requiring a valid report request for the given IČO.

#### MEDIUM: `/api/lookup/route.ts` — Unauthenticated ORSR Proxy

```typescript
// frontend/src/app/api/lookup/route.ts:3-37
export async function GET(req: NextRequest) {
  const ico = req.nextUrl.searchParams.get("ico");
  // No auth check — anyone can use this as an ORSR proxy
  const res = await fetch(`https://www.orsr.sk/hladaj_ico.asp?ICO=${ico}&SID=0`, {
    headers: { "User-Agent": "Mozilla/5.0" },
  });
  // ...
}
```

**Impact:** Can be abused as a free ORSR scraping proxy. Rate limiting would mitigate but not solve the auth gap.

**Fix:** Add `getCurrentUser` check. This endpoint is used during report creation, so only authenticated users should access it.

### Recommended Actions

| Priority | Route | Action |
|---|---|---|
| **P0** | `pdf/[ico]/route.ts` | Remove route entirely — use `reports/[id]/download` instead |
| **P1** | `company/[ico]/route.ts` | Add `getCurrentUser` + verify user has a report for this IČO |
| **P2** | `lookup/route.ts` | Add `getCurrentUser` check |

---

## 5. NextAuth Brute-Force Protection (Security)

### Current State

The `CredentialsProvider.authorize` function has no rate limiting:

```typescript
// frontend/src/lib/auth.ts:99-133
CredentialsProvider({
  async authorize(credentials) {
    if (!credentials?.email || !credentials?.password) return null;

    const user = await prisma.user.findUnique({
      where: { email: credentials.email },
    });
    if (!user || !user.passwordHash) return null;

    if (!user.emailVerified) throw new Error("EMAIL_NOT_VERIFIED");

    const isValid = await bcrypt.compare(credentials.password, user.passwordHash);
    if (!isValid) return null;  // ← No counter, no lockout, no rate limit

    return { id: user.id, email: user.email, name: user.name };
  },
}),
```

### Implementation Plan

**Strategy:** Inject rate limiting directly into the `authorize` function using the existing `rateLimit` infrastructure (Upstash Redis + in-memory fallback).

#### Step 1: Add rate limiting to `authorize`

```typescript
// frontend/src/lib/auth.ts — updated authorize
import { rateLimit } from "@/lib/rateLimit";

CredentialsProvider({
  credentials: {
    email: { label: "Email", type: "email" },
    password: { label: "Password", type: "password" },
  },
  async authorize(credentials, req) {
    if (!credentials?.email || !credentials?.password) return null;

    // ── Brute-force protection ──────────────────────────────────
    // Rate limit: 10 attempts per 15 minutes per email + IP
    const ipAddress =
      req?.headers?.get?.("x-forwarded-for")?.split(",")[0]?.trim() ||
      req?.headers?.get?.("x-real-ip") ||
      "unknown";
    const emailKey = `login:${credentials.email.toLowerCase()}`;
    const ipKey = `login:${ipAddress}`;

    // Check both per-email and per-IP limits
    const [emailLimit, ipLimit] = await Promise.all([
      rateLimitByKey(emailKey, { windowMs: 15 * 60 * 1000, maxRequests: 10 }),
      rateLimitByKey(ipKey, { windowMs: 15 * 60 * 1000, maxRequests: 20 }),
    ]);

    if (!emailLimit.allowed || !ipLimit.allowed) {
      throw new Error("RATE_LIMIT_EXCEEDED");
    }

    // ── Existing auth logic ─────────────────────────────────────
    const user = await prisma.user.findUnique({
      where: { email: credentials.email },
    });
    if (!user || !user.passwordHash) return null;

    if (!user.emailVerified) throw new Error("EMAIL_NOT_VERIFIED");

    const isValid = await bcrypt.compare(credentials.password, user.passwordHash);
    if (!isValid) return null;

    return { id: user.id, email: user.email, name: user.name };
  },
}),
```

#### Step 2: Create a key-based rate limit helper

The existing `rateLimit` function takes a `NextRequest` object, but `authorize` receives a raw request. We need a helper that works with a string key:

```typescript
// frontend/src/lib/rateLimit.ts — add this export

export async function rateLimitByKey(
  key: string,
  options: RateLimitOptions
): Promise<RateLimitResult> {
  const rateLimitKey = `${key}:${options.windowMs}:${options.maxRequests}`;

  if (UPSTASH_URL && UPSTASH_TOKEN) {
    try {
      return await redisRateLimit(rateLimitKey, options);
    } catch {
      return memRateLimit(rateLimitKey, options);
    }
  }

  return memRateLimit(rateLimitKey, options);
}
```

#### Step 3: Handle the rate limit error in the frontend

NextAuth's `authorize` can throw errors that surface as the `error` query parameter in the redirect URL. We need to handle this in the login page:

```typescript
// frontend/src/app/login/page.tsx — add error handling
const searchParams = useSearchParams();
const error = searchParams.get("error");

const errorMessage = useMemo(() => {
  switch (error) {
    case "RATE_LIMIT_EXCEEDED":
      return "Príliš veľa neúspešných pokusov. Skúste to znova o 15 minút.";
    case "EMAIL_NOT_VERIFIED":
      return "Váš e-mail ešte nebol overený. Skontrolujte svoju e-mailovú schránku.";
    case "CredentialsSignin":
      return "Nesprávny e-mail alebo heslo.";
    default:
      return error ? "Prihlásenie zlyhalo." : null;
  }
}, [error]);
```

#### Step 4: Add per-user lockout tracking (optional, stronger)

For even stronger protection, track failed attempts in the database:

```prisma
// Add to User model in schema.prisma
model User {
  // ... existing fields ...
  failedLoginAttempts  Int       @default(0)
  lockedUntil          DateTime?
}
```

```typescript
// In authorize function — after bcrypt.compare fails:
if (!isValid) {
  await prisma.user.update({
    where: { id: user.id },
    data: {
      failedLoginAttempts: { increment: 1 },
      lockedUntil: user.failedLoginAttempts >= 4
        ? new Date(Date.now() + 15 * 60 * 1000)  // Lock for 15 min after 5 attempts
        : undefined,
    },
  });
  return null;
}

// Check lockout before bcrypt.compare:
if (user.lockedUntil && user.lockedUntil > new Date()) {
  throw new Error("ACCOUNT_LOCKED");
}

// Reset on successful login:
await prisma.user.update({
  where: { id: user.id },
  data: { failedLoginAttempts: 0, lockedUntil: null },
});
```

### Rate Limit Configuration

| Scope | Window | Max Attempts | Rationale |
|---|---|---|---|
| Per email | 15 min | 10 | Prevents targeted brute-force on one account |
| Per IP | 15 min | 20 | Prevents distributed brute-force from one source |
| Per account (DB lockout) | 15 min | 5 | Hard lockout after 5 failed attempts |

### Implementation Effort

| Step | Effort | Files Modified |
|---|---|---|
| `rateLimitByKey` helper | 30 min | `rateLimit.ts` |
| Inject rate limit into `authorize` | 1h | `auth.ts` |
| Handle error in login page | 30 min | `login/page.tsx` |
| DB lockout (optional) | 2h | `schema.prisma`, `auth.ts`, migration |
| Testing | 1h | — |
| **Total (without DB lockout)** | **2h** | |
| **Total (with DB lockout)** | **4h** | |

---

## Summary of All Findings

| # | Issue | Severity | Impact | Fix Effort |
|---|---|---|---|---|
| 1 | Worker failure → no refund | **Critical** | Users lose credits on every failed report | 2-4h |
| 2 | Redundant locking strategy | **Medium** | Dead code, potential deadlocks under load | 1h |
| 3 | Stripe coupling in schema | **Medium** | Blocks Paddle migration | 15h |
| 4a | `/api/pdf/[ico]` no auth | **Critical** | Anyone can download any report | 30 min (remove route) |
| 4b | `/api/company/[ico]` no auth | **High** | Anyone can query company financials | 30 min |
| 4c | `/api/lookup` no auth | **Medium** | ORSR proxy abuse | 30 min |
| 5 | No brute-force protection on login | **High** | Password spraying attacks | 2-4h |

### Recommended Priority Order

1. **P0:** Fix `/api/pdf/[ico]` — remove route (30 min, critical security)
2. **P0:** Fix worker failure refund loophole (2-4h, critical business logic)
3. **P1:** Fix `/api/company/[ico]` auth (30 min, high security)
4. **P1:** Add brute-force protection to login (2-4h, high security)
5. **P2:** Fix `/api/lookup` auth (30 min, medium security)
6. **P2:** Simplify locking strategy (1h, medium performance)
7. **P3:** Stripe → Paddle decoupling (15h, architectural)
