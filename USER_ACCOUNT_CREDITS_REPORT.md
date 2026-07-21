# User Account, Authentication & Credits System — Complete Analysis

**Date:** 2026-07-21  
**Project:** Verifa.sk / Scripta — B2B Legal-Tech SaaS  
**Scope:** User registration, login, password recovery, account settings, credits system, billing, admin

---

## Table of Contents

1. [Registrácia](#1-registrácia)
2. [Email Verifikácia](#2-email-verifikácia)
3. [Login / Autentifikácia](#3-login--autentifikácia)
4. [Stratené Heslá](#4-stratené-heslá)
5. [User Settings / Profil](#5-user-settings--profil)
6. [Kredity — Kompletný Systém](#6-kredity--kompletný-systém)
7. [Billing / Stripe Integrácia](#7-billing--stripe-integrácia)
8. [Admin Systém](#8-admin-systém)
9. [Middleware / Route Protection](#9-middleware--route-protection)
10. [Rate Limiting](#10-rate-limiting)
11. [Token Hashing](#11-token-hashing)
12. [Prisma Schema — User Models](#12-prisma-schema--user-models)
13. [Top Riziká](#13-top-riziká)
14. [Celkové Hodnotenie](#14-celkové-hodnotenie)

---

## 1. Registrácia

**Súbor:** `frontend/src/app/api/auth/register/route.ts`

### Flow

1. Rate limit (5 req/hod per IP)
2. Zod schema validácia
3. Duplicate email check
4. bcrypt hash (10 rounds)
5. User create (`emailVerified = null`)
6. Verification token (32 bytes random, SHA-256 hashed, 24h expirácia)
7. Email cez nodemailer SMTP

### Kód — Zod validácia

```typescript
// frontend/src/app/api/auth/register/route.ts:11-15
const registerSchema = z.object({
  name: z.string().min(2, "Meno musí mať aspoň 2 znaky"),
  email: z.string().email("Neplatný formát e-mailu").toLowerCase(),
  password: z.string().min(8, "Heslo musí mať aspoň 8 znakov"),
});
```

### Kód — Registrácia + token generácia

```typescript
// frontend/src/app/api/auth/register/route.ts:46-69
const salt = await bcrypt.genSalt(10);
const passwordHash = await bcrypt.hash(password, salt);

const newUser = await prisma.user.create({
  data: { name, email, passwordHash },
});

const token = crypto.randomBytes(32).toString("hex");
const expires = new Date(Date.now() + 1000 * 60 * 60 * 24); // 24 hours

await prisma.verificationToken.create({
  data: { email, token: hashToken(token), expires },
});
```

### Kód — Email odoslanie

```typescript
// frontend/src/app/api/auth/register/route.ts:74-91
await sendEmail({
  to: email,
  subject: "Potvrdenie registrácie - Verifa.sk",
  text: `...${verifyLink}...`,
  html: `
    <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
      <h2>Vitajte na Verifa.sk</h2>
      <p>Dobrý deň ${name},</p>
      <p><a href="${verifyLink}" style="${emailButtonStyle()}">Aktivovať účet</a></p>
    </div>
  `,
});
```

### Hodnotenie

- ✅ Zod schema validácia
- ✅ bcrypt hashing (10 rounds)
- ✅ Token hashovaný SHA-256 pred DB uložením
- ✅ Rate limiting (5/hod)
- ✅ Email verification required pred login
- ⚠️ Žiadna kontrola sily hesla (len dĺžka 8) — chýba uppercase/number/symbol requirement
- ⚠️ `userId` sa vracia v 201 response — nepotrebné, potenciáln info leak

---

## 2. Email Verifikácia

**Súbor:** `frontend/src/app/api/auth/verify-email/route.ts`

### Flow

1. GET request s `?token=xxx`
2. Token hashuje sa SHA-256 a hľadá v DB
3. Expirácia check (24h)
4. Nastaví `emailVerified = now()`, `trialEndsAt = +30 dní`
5. **Vytvorí 1 free trial kredit** cez `addCreditBatch`
6. Zmaže token

### Kód — Verifikácia + trial kredit

```typescript
// frontend/src/app/api/auth/verify-email/route.ts:42-55
const trialEndsAt = new Date();
trialEndsAt.setDate(trialEndsAt.getDate() + 30);

await prisma.user.update({
  where: { email: verificationRecord.email },
  data: { emailVerified: new Date(), trialEndsAt },
});

// Create wallet with 1 free trial credit via CreditBatch
await addCreditBatch(user.id, 1, "trial");

await prisma.verificationToken.delete({ where: { id: verificationRecord.id } });
```

### Hodnotenie

- ✅ Token hashovaný (SHA-256)
- ✅ Expirácia 24h
- ✅ Idempotentné (druhý pokus vráti "už aktivovaný")
- ✅ Trial kredit (1 ks, 90-dňová expirácia)
- ⚠️ GET request mení stav (nie RESTful, ale pre email linky akceptovateľné)

---

## 3. Login / Autentifikácia

**Súbor:** `frontend/src/lib/auth.ts`

### Provideri

- **Credentials** (email + password) — hlavný
- **Google OAuth** — ak `GOOGLE_CLIENT_ID` + `GOOGLE_CLIENT_SECRET` nastavené
- **Azure AD** — ak `AZURE_AD_CLIENT_ID` + `AZURE_AD_CLIENT_SECRET` nastavené

### Kód — Secure cookies v produkcii

```typescript
// frontend/src/lib/auth.ts:50-96
const _isLocalhost = (process.env.NEXTAUTH_URL || '').includes('localhost');
const _useSecureCookies = process.env.NODE_ENV === 'production' && !_isLocalhost;

cookies: {
  sessionToken: {
    name: _useSecureCookies
      ? "__Secure-next-auth.session-token"
      : "next-auth.session-token",
    options: {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      secure: _useSecureCookies,
      maxAge: 30 * 24 * 60 * 60, // 30 days
    },
  },
  // ... callbackUrl, csrfToken similarly configured
},
```

### Kód — Credentials authorize

```typescript
// frontend/src/lib/auth.ts:99-133
CredentialsProvider({
  credentials: {
    email: { label: "Email", type: "email" },
    password: { label: "Password", type: "password" },
  },
  async authorize(credentials) {
    if (!credentials?.email || !credentials?.password) return null;

    const user = await prisma.user.findUnique({
      where: { email: credentials.email },
    });
    if (!user || !user.passwordHash) return null;

    if (!user.emailVerified) {
      throw new Error("EMAIL_NOT_VERIFIED");
    }

    const isValid = await bcrypt.compare(credentials.password, user.passwordHash);
    if (!isValid) return null;

    return { id: user.id, email: user.email, name: user.name };
  },
}),
```

### Kód — JWT callback s token versioning a 5-min verify

```typescript
// frontend/src/lib/auth.ts:150-216
async jwt({ token, user, trigger, account }) {
  // Pri sign-in: uloží user.id + tokenVersion z DB
  if (user) {
    token.id = user.id;
    const dbUser = await prisma.user.findUnique({
      where: { id: user.id },
      select: { tokenVersion: true },
    });
    token.tokenVersion = dbUser?.tokenVersion ?? 0;
  }

  // OAuth auto-create user s trial kreditom
  if (account && account.provider !== "credentials" && user) {
    const existingUser = await prisma.user.findUnique({
      where: { email: user.email! },
    });
    if (!existingUser) {
      const trialEndsAt = new Date();
      trialEndsAt.setDate(trialEndsAt.getDate() + 30);

      const newUser = await prisma.user.create({
        data: {
          email: user.email!,
          name: user.name || null,
          emailVerified: new Date(),
          trialEndsAt,
        },
      });
      await addCreditBatch(newUser.id, 1, "trial");
    } else if (!existingUser.emailVerified) {
      await prisma.user.update({
        where: { id: existingUser.id },
        data: { emailVerified: new Date() },
      });
    }
  }

  // Verify user exists every 5 minutes (not on every request)
  const now = Date.now();
  const shouldVerify = !token.lastVerified || (now - token.lastVerified) > JWT_VERIFY_INTERVAL_MS;
  if (token.id && shouldVerify) {
    token.lastVerified = now;
    try {
      const dbUser = await prisma.user.findUnique({
        where: { id: token.id },
        select: { id: true, tokenVersion: true },
      });
      if (!dbUser || dbUser.tokenVersion !== token.tokenVersion) {
        token.id = "";  // Invalidate session
      }
    } catch {
      // DB error — keep existing token, don't logout
    }
  }
  return token;
},
```

### Kód — Session callback

```typescript
// frontend/src/lib/auth.ts:218-228
async session({ session, token }) {
  if (session.user && token.id) {
    session.user.id = token.id;
  } else {
    // Invalidated token — return empty session
    session.user = undefined as unknown as typeof session.user;
  }
  return session;
},
```

### Hodnotenie

- ✅ Secure cookies v produkcii (httpOnly, sameSite, secure)
- ✅ bcrypt password compare
- ✅ Email verification required pre Credentials login
- ✅ Token versioning pre session invalidáciu
- ✅ JWT verify interval 5 min (zníženie DB zaťaženia)
- ✅ Graceful degradation pri DB výpadku
- ✅ OAuth auto-create user s trial kreditom
- ⚠️ `catch: pass` v JWT verify — DB error sa neloguje (tichý fail)
- ⚠️ Žiadny account lockout po X neúspešných pokusoch
- ⚠️ Žiadna 2FA/TOTP podpora

---

## 4. Stratené Heslá

### Forgot Password

**Súbor:** `frontend/src/app/api/auth/forgot-password/route.ts`

### Kód — Anti-enumeration + token generácia

```typescript
// frontend/src/app/api/auth/forgot-password/route.ts:9-42
export async function POST(req: NextRequest) {
  const rl = await rateLimit(req, { windowMs: 15 * 60 * 1000, maxRequests: 5 });
  if (!rl.allowed) return rateLimitResponse(rl);

  const { email } = await req.json();
  const normalizedEmail = email.trim().toLowerCase();

  const user = await prisma.user.findUnique({
    where: { email: normalizedEmail },
  });

  // Always return success to prevent email enumeration attacks
  if (!user) {
    return NextResponse.json({
      message: "Ak účet existuje, zaslali sme e-mail s odkazom na obnovu hesla."
    });
  }

  // Generate secure token
  const token = crypto.randomBytes(32).toString("hex");
  const expires = new Date(Date.now() + 1000 * 60 * 60); // 1 hour

  await prisma.passwordResetToken.create({
    data: { email: normalizedEmail, token: hashToken(token), expires },
  });
```

### Reset Password

**Súbor:** `frontend/src/app/api/auth/reset-password/route.ts`

### Kód — Transaction s tokenVersion increment

```typescript
// frontend/src/app/api/auth/reset-password/route.ts:54-71
const salt = await bcrypt.genSalt(10);
const passwordHash = await bcrypt.hash(password, salt);

// Update user (password + tokenVersion) and delete token in a transaction
await prisma.$transaction(async (tx) => {
  await tx.user.update({
    where: { email: resetTokenRecord.email },
    data: {
      passwordHash,
      tokenVersion: { increment: 1 },  // Invalidates all existing sessions
    },
  });

  await tx.passwordResetToken.delete({
    where: { id: resetTokenRecord.id },
  });
});
```

### Hodnotenie

- ✅ Anti-enumeration (rovnaká odpoveď bez ohľadu na to či email existuje)
- ✅ Token hashovaný SHA-256
- ✅ Expirácia 1 hodina
- ✅ `tokenVersion++` pri reset = všetky staré sessiony zneplatnené
- ✅ Transaction (atomické update + delete)
- ✅ Rate limiting na oboch endpointoch (5/15min, 10/15min)
- ⚠️ Nepoužíva `sendEmail()` helper — priamo vytvára transporter (duplikácia kódu)
- ⚠️ Žiadny email "heslo bolo zmenené" notification

---

## 5. User Settings / Profil

**Súbor:** `frontend/src/app/api/settings/route.ts`

### Kód — PATCH s field-level validáciou

```typescript
// frontend/src/app/api/settings/route.ts:104-146
if (defaultSources !== undefined) {
  if (!Array.isArray(defaultSources)) {
    return NextResponse.json({ error: "defaultSources must be an array" }, { status: 400 });
  }
  const allowedSources = new Set(SOURCE_IDS);
  const validSources = defaultSources.filter(
    (s: unknown) => typeof s === "string" && allowedSources.has(s as string)
  );
  if (validSources.length === 0 && defaultSources.length > 0) {
    return NextResponse.json({ error: "defaultSources contains no valid source IDs" }, { status: 400 });
  }
  data.defaultSources = validSources;
}

if (reportLanguage !== undefined) {
  const normalizedLang = typeof reportLanguage === "string" ? reportLanguage.toLowerCase() : null;
  if (!normalizedLang || !["sk", "en", "de"].includes(normalizedLang)) {
    return NextResponse.json({ error: "reportLanguage must be 'sk', 'en', or 'de'" }, { status: 400 });
  }
  data.reportLanguage = normalizedLang;
}
```

### Hodnotenie

- ✅ Authorization check (`getCurrentUser`)
- ✅ Field-level validácia
- ✅ Whitelist filter na sources
- ⚠️ Žiadny rate limit na PATCH
- ⚠️ Žiadny profil update (meno, email zmena) — len report settings

---

## 6. Kredity — Kompletný Systém

**Súbor:** `frontend/src/lib/credits.ts`

### Architektúra

```
User (1) ──── (1) Wallet
  │                  │
  │                  │ (N)
  │                  ▼
  │            WalletTransaction
  │            (CHARGE/TOPUP/REFUND)
  │
  │ (N)
  ▼
CreditBatch
(trial/subscription/addon/rollover)
expiresAt = 90 dní
```

### Dobíjanie (Top-up)

#### Kód — `addCreditBatch` s idempotency

```typescript
// frontend/src/lib/credits.ts:9-69
export async function addCreditBatch(
  userId: string,
  amount: number,
  source: "trial" | "subscription" | "addon" | "rollover",
  planName?: string,
  paymentIntentId?: string
): Promise<void> {
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + CREDIT_EXPIRY_DAYS); // 90 days

  await prisma.$transaction(async (tx) => {
    let wallet = await tx.wallet.findUnique({ where: { userId } });
    if (!wallet) {
      wallet = await tx.wallet.create({ data: { userId, balance: 0, currency: "EUR" } });
    }

    // Idempotency: check if transaction already exists for this paymentIntent
    if (paymentIntentId) {
      const existing = await tx.walletTransaction.findUnique({
        where: { stripePaymentIntentId: paymentIntentId },
      });
      if (existing) return;  // Already processed — skip
    }

    await tx.creditBatch.create({
      data: { userId, amount, remaining: amount, source, planName: planName || null, expiresAt },
    });

    await tx.wallet.update({
      where: { userId },
      data: { balance: { increment: amount }, version: { increment: 1 } },
    });

    await tx.walletTransaction.create({
      data: {
        walletId: wallet.id, amount, type: "TOPUP", status: "COMPLETED",
        stripePaymentIntentId: paymentIntentId || null,
        description: `Kredity — ${source}${planName ? ` (${planName})` : ""} (${amount} kreditov)`,
      },
    });
  });
}
```

### Odpočítavanie (Consumption)

#### Kód — `consumeCredits` s row locking + optimistic locking + retry

```typescript
// frontend/src/lib/credits.ts:76-159
export async function consumeCredits(
  userId: string,
  amount: number,
  reportRequestId?: string
): Promise<boolean> {
  const MAX_RETRIES = 3;
  let lastError: unknown;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      return await prisma.$transaction(async (tx) => {
        // Lock wallet row first to avoid race conditions and overdraft
        const walletRows = await tx.$queryRaw<any[]>`
          SELECT * FROM "Wallet" WHERE "userId" = ${userId} FOR UPDATE
        `;
        const wallet = walletRows[0];
        if (!wallet) return false;

        const walletBalance = Number(wallet.balance);
        if (walletBalance < amount) return false;

        // Lock batches and check availability (FIFO — oldest first)
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

        // Conditional update with optimistic locking
        const updated = await tx.wallet.updateMany({
          where: { id: wallet.id, version: wallet.version },
          data: { balance: { decrement: amount }, version: { increment: 1 } },
        });

        if (updated.count === 0) {
          throw new Error("Wallet version conflict");
        }

        await tx.walletTransaction.create({
          data: {
            walletId: wallet.id, amount, type: "CHARGE", status: "COMPLETED",
            reportRequestId: reportRequestId || null,
            description: `Spotreba kreditov — report${reportRequestId ? ` ${reportRequestId}` : ""}`,
          },
        });

        return true;
      });
    } catch (err) {
      lastError = err;
      if (err instanceof Error && err.message === "Wallet version conflict") {
        await new Promise((resolve) => setTimeout(resolve, 10));
        continue;  // Retry on version conflict
      }
      throw err;
    }
  }
  throw lastError;
}
```

### Kedy sa odpočítava

#### Kód — Frontend odpočítava PRED enqueue

```typescript
// frontend/src/app/api/reports/route.ts:176-188
// Deduct 1 credit via FIFO (oldest batches first) BEFORE enqueuing
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

#### Kód — Refund ak worker enqueue zlyhá

```typescript
// frontend/src/app/api/reports/route.ts:208-223
} catch (workerErr) {
  console.error("Worker enqueue failed", workerErr);
  
  // If enqueue fails, we must refund the credit
  await refundCredits(user.id, 1, reportRequest.id);

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

### Vrátenie (Refund)

#### Kód — `refundCredits` s idempotency a rollover

```typescript
// frontend/src/lib/credits.ts:164-252
export async function refundCredits(
  userId: string,
  amount: number,
  reportRequestId: string
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const walletRows = await tx.$queryRaw<any[]>`
      SELECT * FROM "Wallet" WHERE "userId" = ${userId} FOR UPDATE
    `;
    const wallet = walletRows[0];
    if (!wallet) return;

    // Idempotency: find original CHARGE
    const chargeTx = await tx.walletTransaction.findFirst({
      where: { walletId: wallet.id, type: "CHARGE", reportRequestId },
    });
    if (!chargeTx) return;

    // Idempotency: check if refund already exists
    const existingRefund = await tx.walletTransaction.findFirst({
      where: { type: "REFUND", reportRequestId },
    });
    if (existingRefund) return;

    // Find non-expired batches — LIFO (newest first)
    const batches = await tx.creditBatch.findMany({
      where: { userId, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: "desc" },
    });

    let toRefund = amount;
    for (const batch of batches) {
      if (toRefund <= 0) break;
      const space = batch.amount - batch.remaining;
      if (space === 0) continue;
      const refund = Math.min(space, toRefund);
      await tx.creditBatch.update({
        where: { id: batch.id },
        data: { remaining: { increment: refund } },
      });
      toRefund -= refund;
    }

    // If no batch had space, create a new rollover batch
    if (toRefund > 0) {
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + CREDIT_EXPIRY_DAYS);
      await tx.creditBatch.create({
        data: { userId, amount: toRefund, remaining: toRefund, source: "rollover", expiresAt },
      });
    }

    await tx.wallet.update({
      where: { userId },
      data: { balance: { increment: amount }, version: { increment: 1 } },
    });

    await tx.walletTransaction.create({
      data: {
        walletId: wallet.id, amount, type: "REFUND", status: "COMPLETED",
        reportRequestId,
        description: `Vrátenie kreditov — report ${reportRequestId}`,
      },
    });
  });
}
```

### Expirácia

#### Kód — `expireOldCredits` cron job

```typescript
// frontend/src/lib/credits.ts:258-307
export async function expireOldCredits(): Promise<number> {
  const now = new Date();
  const expiredBatches = await prisma.creditBatch.findMany({
    where: { remaining: { gt: 0 }, expiresAt: { lte: now } },
  });

  if (expiredBatches.length === 0) return 0;

  let totalExpired = 0;
  const expiredByUserId: Record<string, number> = {};

  for (const batch of expiredBatches) {
    totalExpired += batch.remaining;
    expiredByUserId[batch.userId] = (expiredByUserId[batch.userId] || 0) + batch.remaining;
  }

  await prisma.$transaction(async (tx) => {
    // 1. Zero out all expired batches
    await tx.creditBatch.updateMany({
      where: { id: { in: expiredBatches.map(b => b.id) } },
      data: { remaining: 0 },
    });

    // 2. Update wallets and create transactions
    for (const [userId, expiredAmount] of Object.entries(expiredByUserId)) {
      const wallet = await tx.wallet.update({
        where: { userId },
        data: { balance: { decrement: expiredAmount }, version: { increment: 1 } },
      });

      await tx.walletTransaction.create({
        data: {
          walletId: wallet.id, amount: expiredAmount, type: "CHARGE", status: "COMPLETED",
          description: `Expirácia kreditov — ${expiredAmount} kreditov starších ako ${CREDIT_EXPIRY_DAYS} dní`,
        },
      });
    }
  });

  return totalExpired;
}
```

### Worker — Mŕtvy `charge_credit` (starý systém)

#### Kód — Worker charge_credit používa starý `user.credits` stĺpec

```python
# worker/src/db_repository.py:762-799
async def charge_credit(report_request_id: str) -> None:
    db = get_db()
    try:
        req = await db.reportrequest.find_unique(where={"id": report_request_id})
        if not req or not req.userId:
            return

        user_id = req.userId
        user = await db.user.find_unique(where={"id": user_id})
        
        if not user or user.role in ("ADMIN", "ENTERPRISE"):
            return
            
        if user.credits <= 0:       # ← STARÝ stĺpec, Wallet systém ho nepoužíva
            logger.warning(f"Užívateľ {user_id} nemá kredity!")
            return
            
        async with db.tx() as transaction:
            await transaction.user.update(
                where={"id": user_id},
                data={"credits": {"decrement": 1}}   # ← STARÝ decrement
            )
            await transaction.credittransaction.create(  # ← STARÝ model
                data={
                    "userId": user_id,
                    "amount": -1,
                    "type": "CONSUME",
                    "description": f"Analýza firmy {req.companyName or req.ico}",
                    "reportId": report_request_id
                }
            )
```

### Credit Overview

#### Kód — Dashboard widget data

```typescript
// frontend/src/lib/credits.ts:403-438
export async function getCreditOverview(userId: string) {
  const now = new Date();
  const thirtyDaysFromNow = new Date();
  thirtyDaysFromNow.setDate(thirtyDaysFromNow.getDate() + 30);

  const batches = await prisma.creditBatch.findMany({
    where: { userId, remaining: { gt: 0 }, expiresAt: { gt: now } },
    orderBy: { createdAt: "asc" },
  });

  const totalAvailable = batches.reduce((sum, b) => sum + b.remaining, 0);
  const rolloverCredits = batches
    .filter((b) => b.source === "rollover")
    .reduce((sum, b) => sum + b.remaining, 0);
  const expiringSoon = batches
    .filter((b) => b.expiresAt <= thirtyDaysFromNow)
    .reduce((sum, b) => sum + b.remaining, 0);

  return {
    totalAvailable,
    rolloverCredits,
    expiringSoon,
    batches: batches.map((b) => ({
      id: b.id, remaining: b.remaining, source: b.source,
      planName: b.planName,
      expiresAt: b.expiresAt.toISOString(),
      createdAt: b.createdAt.toISOString(),
    })),
  };
}
```

### Zdroje kreditov — Prehľad

| Zdroj | Spúšťač | Množstvo | Expirácia |
|---|---|---|---|
| `trial` | Email verifikácia / OAuth auto-create | 1 kredit | 90 dní |
| `subscription` | Stripe `checkout.session.completed` / `invoice.paid` | 5/20/40 podľa plánu | 90 dní |
| `addon` | Stripe `checkout.session.completed` (addon5) | 5 kreditov | 90 dní |
| `rollover` | `refundCredits` keď batche nemajú miesto | Vrátená suma | 90 dní |

### Hodnotenie

- ✅ **Row locking** (`FOR UPDATE`) — chráni pred race conditions a overdraft
- ✅ **Optimistic locking** (`version` field) — ďalšia vrstva ochrany
- ✅ **FIFO consumption** — najstaršie kredity sa minú prvé
- ✅ **Idempotency** na top-up (paymentIntentId) aj refund (double-refund check)
- ✅ **Rollover batche** — ak refund nemá kam ísť, vytvorí nový batch
- ✅ **90-dňová expirácia** s cron job
- ✅ **Subscription cancellation** handling s grace period
- ⚠️ **Duplicitný credit systém** — worker `charge_credit()` je mŕtvy kód
- ⚠️ `consumeCredits` vždy odpočítava 1 kredit — žiadna podpora pre variabilné množstvo
- ⚠️ Žiadny admin endpoint pre manuálne pridávanie/odoberanie kreditov

---

## 7. Billing / Stripe Integrácia

### Checkout

**Súbor:** `frontend/src/app/api/stripe/checkout/route.ts`

#### Kód — Price map a checkout session

```typescript
// frontend/src/app/api/stripe/checkout/route.ts:15-23
const PRICE_MAP: Record<string, { priceId: string; mode: "payment" | "subscription"; credits: number; planName: string }> = {
  start:     { priceId: process.env.STRIPE_PRICE_START     || "", mode: "payment",      credits: 1,   planName: "start" },
  payg5:     { priceId: process.env.STRIPE_PRICE_PAYG5     || "", mode: "payment",      credits: 5,   planName: "payg5" },
  payg20:    { priceId: process.env.STRIPE_PRICE_PAYG20    || "", mode: "payment",      credits: 20,  planName: "payg20" },
  freelance: { priceId: process.env.STRIPE_PRICE_FREELANCE || "", mode: "subscription", credits: 5,   planName: "freelance" },
  firma:     { priceId: process.env.STRIPE_PRICE_FIRMA     || "", mode: "subscription", credits: 20,  planName: "firma" },
  korporat:  { priceId: process.env.STRIPE_PRICE_KORPORAT  || "", mode: "subscription", credits: 40,  planName: "korporat" },
  addon5:    { priceId: process.env.STRIPE_PRICE_ADDON5    || "", mode: "payment",      credits: 5,   planName: "addon" },
};
```

### Webhook Handler

**Súbor:** `frontend/src/app/api/stripe/webhook/route.ts`

#### Kód — Subscription lifecycle handling

```typescript
// frontend/src/app/api/stripe/webhook/route.ts:43-178
switch (event.type) {
  case "checkout.session.completed": {
    const session = event.data.object as Stripe.Checkout.Session;
    const userId = session.metadata?.userId;
    const credits = parseInt(session.metadata?.credits || "0", 10);
    const planName = session.metadata?.planName || "";

    if (userId && credits > 0) {
      const source = planName === "addon" ? "addon" : "subscription";
      await addCreditBatch(userId, credits, source, planName, session.payment_intent as string);

      if (planName !== "addon") {
        const renewalDate = new Date();
        renewalDate.setDate(renewalDate.getDate() + 30);
        await prisma.user.update({
          where: { id: userId },
          data: { planName, planRenewalDate: renewalDate, subscriptionStatus: "active" },
        });
      }
    }
    break;
  }

  case "customer.subscription.deleted": {
    const subscription = event.data.object as Stripe.Subscription;
    const userId = (subscription.metadata as Record<string, string>)?.userId;
    if (userId) {
      const periodEnd = subscription.items?.data?.[0]?.current_period_end;
      const endsAt = periodEnd ? new Date(periodEnd * 1000) : new Date();
      await cancelSubscription(userId, endsAt);
    }
    break;
  }

  case "customer.subscription.updated": {
    const subscription = event.data.object as Stripe.Subscription;
    const userId = (subscription.metadata as Record<string, string>)?.userId;
    if (userId) {
      if (subscription.cancel_at_period_end) {
        const endsAt = periodEnd ? new Date(periodEnd * 1000) : new Date();
        await cancelSubscription(userId, endsAt);
      } else if (subscription.status === "active") {
        // Reactivated subscription
        await prisma.user.update({
          where: { id: userId },
          data: { subscriptionStatus: "active", subscriptionEndsAt: null },
        });
      } else if (subscription.status === "past_due" || subscription.status === "unpaid") {
        await prisma.user.update({
          where: { id: userId },
          data: { subscriptionStatus: "past_due" },
        });
      }
    }
    break;
  }

  case "invoice.finalized": {
    // Ensure Slovak VAT (20%) is applied to the invoice
    const invoice = event.data.object as Stripe.Invoice;
    const hasTax = (invoice as unknown as Record<string, unknown>).tax !== undefined;
    if (!hasTax) {
      await stripe.invoices.update(invoice.id, {
        default_tax_rates: [process.env.STRIPE_TAX_RATE_SK || ""],
      });
    }
    break;
  }
}
```

### Customer Portal

**Súbor:** `frontend/src/app/api/stripe/portal/route.ts`

```typescript
// frontend/src/app/api/stripe/portal/route.ts:24-44
const customers = await stripe.customers.list({ email: session.user.email, limit: 1 });
let customerId: string | undefined = customers.data[0]?.id;

if (!customerId) {
  return NextResponse.json({ error: "No active subscription found." }, { status: 404 });
}

const portalSession = await stripe.billingPortal.sessions.create({
  customer: customerId,
  return_url: `${process.env.NEXTAUTH_URL || "http://localhost:3000"}/plan`,
});
```

### Hodnotenie

- ✅ Stripe signature verification
- ✅ Idempotency cez `paymentIntentId` v `addCreditBatch`
- ✅ Subscription lifecycle handling (create, renew, cancel, reactivate, past_due)
- ✅ Slovak VAT automaticky aplikovaný
- ✅ Customer portal pre self-service
- ⚠️ Žiadny email userovi pri zrušení subscription alebo failed payment

---

## 8. Admin Systém

**Súbor:** `frontend/src/app/api/admin/overview/route.ts`

### Kód — Admin dashboard stats

```typescript
// frontend/src/app/api/admin/overview/route.ts:12-19
const userRecord = await prisma.user.findUnique({
  where: { id: session.user.id },
  select: { role: true },
});

if (userRecord?.role !== "ADMIN") {
  return NextResponse.json({ error: "Forbidden" }, { status: 403 });
}
```

```typescript
// frontend/src/app/api/admin/overview/route.ts:21-45
const [
  totalUsers, totalReports, completedReports, failedReports,
  pendingReports, totalFeedback, openFeedback, totalMessages,
  userMessages, totalWalletTransactions, totalCreditsSpent,
] = await Promise.all([
  prisma.user.count(),
  prisma.reportRequest.count(),
  prisma.reportRequest.count({ where: { status: "COMPLETED" } }),
  prisma.reportRequest.count({ where: { status: "FAILED" } }),
  prisma.reportRequest.count({ where: { status: { in: ["PENDING", "PROCESSING"] } } }),
  prisma.feedback.count(),
  prisma.feedback.count({ where: { status: "OPEN" } }),
  prisma.userMessage.count(),
  prisma.userMessage.count({ where: { type: "USER" } }),
  prisma.walletTransaction.count({ where: { type: "CHARGE" } }),
  prisma.walletTransaction.aggregate({ _sum: { amount: true }, where: { type: "CHARGE" } }),
]);
```

### Hodnotenie

- ✅ Admin role check
- ⚠️ Žiadny admin endpoint na pridávanie/odoberanie kreditov
- ⚠️ Žiadny admin endpoint na správu userov (ban, role change, delete)

---

## 9. Middleware / Route Protection

**Súbor:** `frontend/src/middleware.ts`

```typescript
// frontend/src/middleware.ts:1-17
export { default } from "next-auth/middleware";

export const config = {
  matcher: [
    "/dashboard",
    "/reports/:path*",
    "/history/:path*",
    "/settings/:path*",
    "/messages/:path*",
    "/admin/:path*",
    "/plan"
  ],
};
```

### Hodnotenie

- ✅ NextAuth middleware na chránené routy
- ⚠️ `/api/*` routy nie sú chránené middleware — auth sa rieši individuálne v každom route handleri

---

## 10. Rate Limiting

**Súbor:** `frontend/src/lib/rateLimit.ts`

### Kód — Redis (production) + in-memory fallback

```typescript
// frontend/src/lib/rateLimit.ts:57-86
async function redisRateLimit(key: string, options: RateLimitOptions): Promise<RateLimitResult> {
  const now = Date.now();
  const resetTime = now + options.windowMs;
  const redisKey = `ratelimit:${key}`;

  const url = `${UPSTASH_URL}/incr/${encodeURIComponent(redisKey)}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${UPSTASH_TOKEN}` },
  });

  if (!res.ok) {
    return { allowed: true, remaining: options.maxRequests - 1, resetTime };
  }

  const data = await res.json();
  const count = parseInt(data.result ?? "0", 10);

  if (count === 1) {
    // Set expiry on first request
    const expireUrl = `${UPSTASH_URL}/expire/${encodeURIComponent(redisKey)}/${Math.ceil(options.windowMs / 1000)}`;
    await fetch(expireUrl, { headers: { Authorization: `Bearer ${UPSTASH_TOKEN}` } });
  }

  if (count > options.maxRequests) {
    return { allowed: false, remaining: 0, resetTime };
  }

  return { allowed: true, remaining: options.maxRequests - count, resetTime };
}
```

### Rate limit konfigurácia

| Endpoint | Window | Max |
|---|---|---|
| `/api/auth/register` | 1 hod | 5 |
| `/api/auth/forgot-password` | 15 min | 5 |
| `/api/auth/reset-password` | 15 min | 10 |
| `/api/reports` (POST) | 10 min | 20 |

### Hodnotenie

- ✅ IP-based (x-forwarded-for / x-real-ip)
- ✅ Redis fallback na memory
- ⚠️ In-memory fallback nefunguje v serverless (Vercel) — každá Lambda instance má vlastnú Map
- ⚠️ Login endpoint (`/api/auth/[...nextauth]`) nemá rate limit — NextAuth ho neimplementuje

---

## 11. Token Hashing

**Súbor:** `frontend/src/lib/token.ts`

```typescript
// frontend/src/lib/token.ts:8-10
export function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}
```

- ✅ SHA-256 hash pred uložením do DB
- ✅ Raw token len v email linke
- ✅ Aj keď DB leakne, tokeny nie sú recoverable

---

## 12. Prisma Schema — User Models

```prisma
// frontend/prisma/schema.prisma:18-46
model User {
  id               String          @id @default(cuid())
  email            String          @unique
  name             String?
  passwordHash     String?
  emailVerified    DateTime?
  role             UserRole        @default(LAWYER)
  orsrExtractType  String          @default("CURRENT")
  crzDateFrom      DateTime?
  rozhodnutiaDateFrom DateTime?
  vestnikDateFrom  DateTime?
  defaultSources   String[]        @default([])
  reportLanguage   String          @default("sk")
  attachmentsConfig Json?
  tokenVersion     Int             @default(0)
  planName           String?
  planRenewalDate    DateTime?
  trialEndsAt        DateTime?
  subscriptionStatus String?
  subscriptionEndsAt DateTime?
  createdAt          DateTime        @default(now())
  updatedAt          DateTime        @updatedAt
  reportRequests     ReportRequest[]
  feedback           Feedback[]
  wallet             Wallet?
  creditBatches      CreditBatch[]
  messages           UserMessage[]      @relation("UserMessages")
  sentMessages       UserMessage[]      @relation("SentMessages")
}

enum UserRole {
  LAWYER
  ADMIN
}
```

```prisma
// frontend/prisma/schema.prisma:367-425
model CreditBatch {
  id          String   @id @default(cuid())
  userId      String
  amount      Int
  remaining   Int
  source      String   // trial | subscription | addon | rollover
  planName    String?
  expiresAt   DateTime
  createdAt   DateTime @default(now())
  user        User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  @@index([userId, expiresAt])
  @@index([userId, createdAt])
}

model Wallet {
  id        String   @id @default(cuid())
  userId    String   @unique
  balance   Decimal  @default(0) @db.Decimal(10, 2)
  currency  String   @default("EUR")
  version   Int      @default(0)  // Optimistic locking
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  user            User               @relation(fields: [userId], references: [id], onDelete: Cascade)
  transactions    WalletTransaction[]
  @@index([userId])
}

model WalletTransaction {
  id                   String             @id @default(cuid())
  walletId             String
  amount               Decimal            @db.Decimal(10, 2)
  type                 TransactionType
  status               TransactionStatus  @default(COMPLETED)
  reportRequestId      String?
  stripePaymentIntentId String?            @unique
  description          String?
  createdAt            DateTime           @default(now())
  wallet               Wallet             @relation(fields: [walletId], references: [id], onDelete: Cascade)
  @@index([walletId])
  @@index([reportRequestId])
}
```

---

## 13. Top Riziká

### Riziko 1: Duplicitný Credit Systém (Critical)

**Problém:** Worker `charge_credit()` v `db_repository.py` používa starý `user.credits` stĺpec a `CreditTransaction` model. Frontend už používa nový `Wallet` + `CreditBatch` systém. Worker kód je mŕtvy (kredity sa odpočítavajú na fronte pred enqueue), ale ak by sa aktivoval, došlo by k **double-charge**.

**Worker (mŕtvy kód):**
```python
# worker/src/db_repository.py:775-792
if user.credits <= 0:       # ← STARÝ stĺpec
    logger.warning(f"Užívateľ {user_id} nemá kredity!")
    return
    
async with db.tx() as transaction:
    await transaction.user.update(
        where={"id": user_id},
        data={"credits": {"decrement": 1}}   # ← STARÝ decrement
    )
    await transaction.credittransaction.create(  # ← STARÝ model
        data={"userId": user_id, "amount": -1, "type": "CONSUME", ...}
    )
```

**Frontend (aktuálny systém):**
```typescript
// frontend/src/app/api/reports/route.ts:177
const creditConsumed = await consumeCredits(user.id, 1, reportRequest.id);
// → Používa Wallet.balance + CreditBatch.remaining + WalletTransaction
```

**Volanie z workera:**
```python
// worker/src/main.py:460-461
if final_status == "COMPLETED":
    await _charge_credit(task.report_request_id)  # ← Mŕtvy kód, nepoužíva sa
```

**Riešenie:** Odstrániť `charge_credit()` z `db_repository.py` a jej volanie z `main.py`. Kredity sa odpočítavajú výlučne na fronte cez `consumeCredits`.

---

### Riziko 2: Žiadny Account Lockout (High)

**Problém:** Login endpoint (`/api/auth/[...nextauth]`) nemá rate limiting. Útočník môže skúšať heslá bez obmedzenia.

```typescript
// frontend/src/lib/auth.ts:99-133
async authorize(credentials) {
  // Žiadny rate limit, žiadny counter na neúspešné pokusy
  const user = await prisma.user.findUnique({
    where: { email: credentials.email },
  });
  if (!user || !user.passwordHash) return null;

  const isValid = await bcrypt.compare(credentials.password, user.passwordHash);
  if (!isValid) return null;  // ← Žiadny counter increment
}
```

**Riešenie:** Pridať rate limit na login endpoint (napr. 10 pokusov / 15 min per IP) alebo implementovať account lockout po 5 neúspešných pokusoch s exponenciálnym backoff.

---

### Riziko 3: In-memory Rate Limit Fallback nefunguje na Serverless (High)

**Problém:** Ak Upstash Redis nie je nakonfigurovaný, fallback je in-memory `Map`. Na Vercel serverless má každá Lambda instance vlastnú Map, takže rate limiting efektívne neexistuje.

```typescript
// frontend/src/lib/rateLimit.ts:14-50
// In-memory fallback (dev only)
const memStore = new Map<string, RateLimitEntry>();

function memRateLimit(key: string, options: RateLimitOptions): RateLimitResult {
  // ← Na Vercel: každá Lambda má vlastnú Map → rate limit sa resetuje per instance
}
```

**Riešenie:** V produkcii vynútiť Upstash Redis — ak nie je nakonfigurovaný, odmietnuť request s 500 namiesto fallback na nefunkčný in-memory store.

---

### Riziko 4: Tichý DB Error v JWT Verify (Medium)

**Problém:** Ak DB zlyhá pri JWT verify ( každých 5 min), error sa ticho pohltnú a user zostane prihlásený aj keď možno už neexistuje.

```typescript
// frontend/src/lib/auth.ts:203-213
try {
  const dbUser = await prisma.user.findUnique({
    where: { id: token.id },
    select: { id: true, tokenVersion: true },
  });
  if (!dbUser || dbUser.tokenVersion !== token.tokenVersion) {
    token.id = "";
  }
} catch {
  // DB error — keep existing token, don't logout
  // ← Žiadny logger.error, žiadny monitoring
}
```

**Riešenie:** Pridať `console.error` alebo Sentry capture do catch bloku.

---

### Riziko 5: Žiadny Email pri Zrušení Subscription / Failed Payment (Medium)

**Problém:** Stripe webhook spracuje `customer.subscription.deleted` a `invoice.payment_failed`, ale user nedostane žiadny email. Dozvie sa až keď sa pokúsi vygenerovať report a dostane 402.

```typescript
// frontend/src/app/api/stripe/webhook/route.ts:109-117
case "customer.subscription.deleted": {
  const subscription = event.data.object as Stripe.Subscription;
  const userId = (subscription.metadata as Record<string, string>)?.userId;
  if (userId) {
    const endsAt = periodEnd ? new Date(periodEnd * 1000) : new Date();
    await cancelSubscription(userId, endsAt);
    // ← Žiadny email userovi
  }
  break;
}
```

**Riešenie:** Pridať `sendEmail()` volanie pri subscription cancellation a payment failure.

---

## 14. Celkové Hodnotenie

| Oblasť | Score | Poznámka |
|---|---|---|
| **Registrácia** | 8/10 | Solid, chýba sila hesla |
| **Email verifikácia** | 9/10 | Idempotentné, token hashované |
| **Login / Auth** | 8/10 | JWT + token versioning, chýba 2FA a account lockout |
| **Forgot/Reset password** | 9/10 | Anti-enumeration, token versioning, idempotentné |
| **User settings** | 7/10 | Dobrá validácia, chýba profil update a rate limit |
| **Kredity** | 8/10 | Výborné locking a idempotency, ale duplicitný starý systém v workeri |
| **Stripe billing** | 8/10 | Kompletný lifecycle, chýba email notifikácia |
| **Admin** | 6/10 | Stats OK, chýba user/credit management |
| **Rate limiting** | 7/10 | Redis + fallback, ale serverless fallback nefunguje |
| **Token hashing** | 10/10 | SHA-256, správne implementované |
| **Middleware** | 8/10 | Chránené routy OK, API routy individuálne |

**Priemerné skóre:** 7.8/10
