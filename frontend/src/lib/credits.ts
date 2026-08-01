import { prisma } from "@/lib/prisma";
import type { PaymentProvider } from "@prisma/client";
import { sendEmail, emailButtonStyle } from "@/lib/email";
import type { PrismaClient } from "@prisma/client";

type PrismaTransaction = Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0];

// Source-based expiry: trial=30d, subscription=60d (rollover window), addon=permanent, rollover=60d
const EXPIRY_DAYS: Record<string, number> = {
  trial: 30,
  subscription: 60,
  addon: 36500,
  rollover: 60,
};

/**
 * Add a batch of credits to a user's wallet.
 * Creates a CreditBatch record and increments the wallet balance.
 *
 * If the wallet has a negative balance (debt from a chargeback/refund where
 * the user had already spent the credits), the new batch's `remaining` is
 * reduced by the debt amount to settle it. This keeps `wallet.balance` and
 * `SUM(CreditBatch.remaining)` consistent so the user can't spend more
 * credits than they actually purchased.
 */
export async function addCreditBatch(
  userId: string,
  amount: number,
  source: "trial" | "subscription" | "addon" | "rollover",
  planName?: string,
  providerReference?: string,
  provider?: PaymentProvider
): Promise<void> {
  const expiryDays = EXPIRY_DAYS[source] ?? 36500;
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + expiryDays);

  await prisma.$transaction(async (tx) => {
    // Lock the wallet row to read the current balance atomically.
    const walletRows = await tx.$queryRaw<any[]>`
      SELECT * FROM "Wallet" WHERE "userId" = ${userId} FOR UPDATE
    `;
    let wallet = walletRows[0];
    if (!wallet) {
      // No wallet yet — create one with zero balance, then re-lock.
      await tx.wallet.create({ data: { userId, balance: 0, currency: "EUR" } });
      const relocked = await tx.$queryRaw<any[]>`
        SELECT * FROM "Wallet" WHERE "userId" = ${userId} FOR UPDATE
      `;
      wallet = relocked[0];
    }

    // Idempotency: check if transaction already exists for this provider reference
    if (providerReference) {
      const existing = await tx.walletTransaction.findUnique({
        where: { providerReference },
      });
      if (existing) return;
    }

    // Debt settlement: if wallet balance is negative (e.g. from a chargeback
    // where credits were already spent), reduce the new batch's remaining by
    // the debt so the user can't spend more than they purchased.
    const currentBalance = Number(wallet.balance);
    const debt = currentBalance < 0 ? Math.abs(currentBalance) : 0;
    const settledDebt = Math.min(debt, amount);
    const effectiveRemaining = amount - settledDebt;

    // Create credit batch with debt-adjusted remaining.
    await tx.creditBatch.create({
      data: {
        userId,
        amount,
        remaining: effectiveRemaining,
        source,
        planName: planName || null,
        expiresAt,
      },
    });

    // Increment wallet balance by the full purchase amount.
    // If there was a debt, this brings balance from -debt to (-debt + amount).
    // Combined with the reduced batch remaining, balance and SUM(remaining)
    // stay consistent: SUM(remaining) = effectiveRemaining = amount - debt,
    // and balance = -debt + amount = amount - debt. They match.
    await tx.wallet.update({
      where: { id: wallet.id },
      data: {
        balance: { increment: amount },
        version: { increment: 1 },
      },
    });

    // Record transaction
    await tx.walletTransaction.create({
      data: {
        walletId: wallet.id,
        amount,
        type: "TOPUP",
        status: "COMPLETED",
        provider: provider || null,
        providerReference: providerReference || null,
        description: `Kredity — ${source}${planName ? ` (${planName})` : ""} (${amount} kreditov)${settledDebt > 0 ? `, z toho ${settledDebt} na vyrovnanie dlhu` : ""}`,
      },
    });
  });
}

/**
 * Consume credits using FIFO (First-In, First-Out).
 * Deducts from the oldest non-expired batches first.
 * Returns true if enough credits were available, false otherwise.
 */
/**
 * Consume credits within an existing transaction (for atomic report creation).
 * Uses pessimistic locking on Wallet and CreditBatch rows.
 * Returns true on success, false if insufficient credits.
 */
export async function consumeCreditsTx(
  tx: PrismaTransaction,
  userId: string,
  amount: number,
  reportRequestId?: string
): Promise<boolean> {
  // Pessimistic lock on wallet row — prevents concurrent modifications
  const walletRows = await tx.$queryRaw<any[]>`
    SELECT * FROM "Wallet" WHERE "userId" = ${userId} FOR UPDATE
  `;
  const wallet = walletRows[0];
  if (!wallet) return false;

  const walletBalance = Number(wallet.balance);
  if (walletBalance < amount) return false;

  // Pessimistic lock on batches — consume by soonest expiry first so that
  // credits closest to expiration are spent before longer-lived ones.
  // Addon batches (expiresAt ~ +100y) naturally sort last.
  const batches = await tx.$queryRaw<any[]>`
    SELECT * FROM "CreditBatch"
    WHERE "userId" = ${userId} AND remaining > 0 AND "expiresAt" > NOW()
    ORDER BY "expiresAt" ASC
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

  // Simple update — FOR UPDATE guarantees exclusivity, no version check needed
  await tx.wallet.update({
    where: { id: wallet.id },
    data: {
      balance: { decrement: amount },
      version: { increment: 1 },
    },
  });

  await tx.walletTransaction.create({
    data: {
      walletId: wallet.id,
      amount,
      type: "CHARGE",
      status: "COMPLETED",
      reportRequestId: reportRequestId || null,
      description: `Spotreba kreditov — report${reportRequestId ? ` ${reportRequestId}` : ""}`,
    },
  });

  return true;
}

export async function consumeCredits(
  userId: string,
  amount: number,
  reportRequestId?: string
): Promise<boolean> {
  return await prisma.$transaction(async (tx) => {
    return consumeCreditsTx(tx, userId, amount, reportRequestId);
  });
}

/**
 * Refund credits back to batches if a report fails.
 */
export async function refundCredits(
  userId: string,
  amount: number,
  reportRequestId: string
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    // Lock wallet row
    const walletRows = await tx.$queryRaw<any[]>`
      SELECT * FROM "Wallet" WHERE "userId" = ${userId} FOR UPDATE
    `;
    const wallet = walletRows[0];
    if (!wallet) return;

    // Idempotency: find original CHARGE
    const chargeTx = await tx.walletTransaction.findFirst({
      where: {
        walletId: wallet.id,
        type: "CHARGE",
        reportRequestId,
      },
    });
    if (!chargeTx) return;

    // Idempotency: check if refund already exists
    const existingRefund = await tx.walletTransaction.findFirst({
      where: { type: "REFUND", reportRequestId },
    });
    if (existingRefund) return;

    // Lock batches (LIFO — newest first) with pessimistic lock for consistency
    const batches = await tx.$queryRaw<any[]>`
      SELECT * FROM "CreditBatch" 
      WHERE "userId" = ${userId} AND "expiresAt" > NOW() 
      ORDER BY "createdAt" DESC 
      FOR UPDATE
    `;

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
      expiresAt.setDate(expiresAt.getDate() + EXPIRY_DAYS.rollover);
      await tx.creditBatch.create({
        data: {
          userId,
          amount: toRefund,
          remaining: toRefund,
          source: "rollover",
          expiresAt,
        },
      });
    }

    await tx.wallet.update({
      where: { userId },
      data: {
        balance: { increment: amount },
        version: { increment: 1 },
      },
    });

    await tx.walletTransaction.create({
      data: {
        walletId: wallet.id,
        amount,
        type: "REFUND",
        status: "COMPLETED",
        reportRequestId,
        description: `Vrátenie kreditov — report ${reportRequestId}`,
      },
    });
  });
}

/**
 * Handle subscription cancellation.
 */
export async function cancelSubscription(userId: string, endsAt: Date): Promise<void> {
  await prisma.user.update({
    where: { id: userId },
    data: {
      subscriptionStatus: "canceled",
      subscriptionEndsAt: endsAt,
    },
  });
}

/**
 * Get credit overview for dashboard widget.
 */
export async function getCreditOverview(userId: string) {
  const now = new Date();
  const thirtyDaysFromNow = new Date();
  thirtyDaysFromNow.setDate(thirtyDaysFromNow.getDate() + 30);

  const batches = await prisma.creditBatch.findMany({
    where: {
      userId,
      remaining: { gt: 0 },
      expiresAt: { gt: now },
    },
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
      id: b.id,
      remaining: b.remaining,
      source: b.source,
      planName: b.planName,
      expiresAt: b.expiresAt.toISOString(),
      createdAt: b.createdAt.toISOString(),
    })),
  };
}

/**
 * Expire credit batches past their expiry date.
 * Sets remaining=0 and decrements wallet balance accordingly.
 * Runs atomically per-user with pessimistic locks to prevent inconsistency
 * if the process crashes mid-way or a concurrent consume/refund is in flight.
 * Returns total number of credits expired.
 */
export async function expireOldCredits(): Promise<number> {
  const now = new Date();

  // Discover affected users first (outside the per-user transactions).
  const expiredBatches = await prisma.creditBatch.findMany({
    where: {
      remaining: { gt: 0 },
      expiresAt: { lt: now },
    },
    select: { id: true, userId: true, remaining: true },
  });

  if (expiredBatches.length === 0) return 0;

  const byUser = new Map<string, number>();
  for (const batch of expiredBatches) {
    byUser.set(batch.userId, (byUser.get(batch.userId) || 0) + batch.remaining);
  }

  let totalExpiredAll = 0;

  // Process each user in its own transaction with row locks.
  for (const userEntry of Array.from(byUser.entries())) {
    const [userId] = userEntry;
    await prisma.$transaction(async (tx) => {
      // Lock the wallet row so concurrent consume/refund waits for us.
      const walletRows = await tx.$queryRaw<any[]>`
        SELECT * FROM "Wallet" WHERE "userId" = ${userId} FOR UPDATE
      `;
      const wallet = walletRows[0];
      if (!wallet) return;

      // Lock and zero out only the expired batches for this user.
      const rows = await tx.$queryRaw<any[]>`
        SELECT * FROM "CreditBatch"
        WHERE "userId" = ${userId} AND remaining > 0 AND "expiresAt" < ${now}
        FOR UPDATE
      `;

      let userExpired = 0;
      for (const batch of rows) {
        const rem = Number(batch.remaining);
        if (rem <= 0) continue;
        await tx.creditBatch.update({
          where: { id: batch.id },
          data: { remaining: 0 },
        });
        userExpired += rem;
      }

      if (userExpired > 0) {
        await tx.wallet.update({
          where: { id: wallet.id },
          data: {
            balance: { decrement: userExpired },
            version: { increment: 1 },
          },
        });
        totalExpiredAll += userExpired;
      }
    });
  }

  console.log(`[expireOldCredits] Expired ${totalExpiredAll} credits across ${byUser.size} users, ${expiredBatches.length} batches.`);
  return totalExpiredAll;
}

/**
 * Zero out remaining subscription credits for a canceled subscription past its end date.
 * Runs atomically with pessimistic locks to prevent inconsistency.
 * Re-checks subscription status inside the transaction to avoid a race where
 * the user reactivated their subscription between the cron's initial query and
 * this point — in that case we must NOT zero out their credits.
 * Returns total credits zeroed.
 */
export async function zeroOutExpiredSubscription(userId: string): Promise<number> {
  return await prisma.$transaction(async (tx) => {
    // Re-check the user's subscription status inside the transaction.
    // If they reactivated (status active, no end date in the past), skip zeroing.
    const userRows = await tx.$queryRaw<any[]>`
      SELECT "subscriptionStatus", "subscriptionEndsAt" FROM "User"
      WHERE "id" = ${userId} FOR UPDATE
    `;
    const user = userRows[0];
    if (!user) return 0;

    const status = user.subscriptionStatus;
    const endsAt = user.subscriptionEndsAt ? new Date(user.subscriptionEndsAt) : null;

    // Only zero out if the subscription is genuinely canceled AND past its end date.
    // A reactivated subscription has status "active" and/or subscriptionEndsAt = null.
    if (status !== "canceled" || !endsAt || endsAt > new Date()) {
      return 0;
    }

    // Lock the wallet row.
    const walletRows = await tx.$queryRaw<any[]>`
      SELECT * FROM "Wallet" WHERE "userId" = ${userId} FOR UPDATE
    `;
    const wallet = walletRows[0];
    if (!wallet) return 0;

    // Lock subscription batches with remaining credits.
    const batches = await tx.$queryRaw<any[]>`
      SELECT * FROM "CreditBatch"
      WHERE "userId" = ${userId} AND source = 'subscription' AND remaining > 0
      FOR UPDATE
    `;

    if (batches.length === 0) return 0;

    const totalToZero = batches.reduce((sum, b) => sum + Number(b.remaining), 0);

    for (const batch of batches) {
      await tx.creditBatch.update({
        where: { id: batch.id },
        data: { remaining: 0 },
      });
    }

    await tx.wallet.update({
      where: { id: wallet.id },
      data: {
        balance: { decrement: totalToZero },
        version: { increment: 1 },
      },
    });

    console.log(`[zeroOutExpiredSubscription] Zeroed ${totalToZero} subscription credits for user ${userId}.`);
    return totalToZero;
  });
}

/**
 * Revoke credits when a payment is refunded (chargeback or Stripe dashboard refund).
 *
 * Strategy:
 * 1. Find the original TOPUP transaction by originalProviderReference.
 * 2. Deduct from the original CreditBatch first; if it doesn't have enough
 *    remaining credits (user already spent them), cover the debt from other
 *    active batches ordered by expiresAt ASC (same as consumeCredits).
 * 3. If no batches can cover the debt, decrement wallet balance into negative
 *    territory — this reflects the user's debt and blocks new reports (the
 *    POST /api/reports check requires availableCredits > 0).
 * 4. Record a REFUND_DEDUCTION WalletTransaction with the refund id as
 *    providerReference for idempotency.
 *
 * @param userId            The user whose credits should be revoked.
 * @param creditsToRevoke   Number of credits to revoke. Pass -1 to auto-detect
 *                          from the original TOPUP transaction amount.
 * @param refundReference   Unique refund id (e.g. Stripe refund id) for idempotency.
 * @param originalProviderReference  The payment_intent or invoice id of the
 *                                   original payment, used to locate the TOPUP.
 * @param provider          The payment provider (STRIPE, PADDLE, MANUAL).
 * @returns Object with `revoked` (credits deducted, 0 if idempotent skip,
 *          -1 if TOPUP not found), `newBalance` (wallet balance after revoke),
 *          and `userEmail` (for notifications).
 */
export interface RevokeResult {
  revoked: number;
  newBalance: number;
  userEmail: string | null;
}

export async function revokeCreditsOnRefund(
  userId: string,
  creditsToRevoke: number,
  refundReference: string,
  originalProviderReference: string,
  provider?: PaymentProvider
): Promise<RevokeResult> {
  return await prisma.$transaction(async (tx) => {
    // Idempotency: if a REFUND_DEDUCTION with this refundReference already
    // exists, skip entirely.
    const existing = await tx.walletTransaction.findUnique({
      where: { providerReference: refundReference },
    });
    if (existing) return { revoked: 0, newBalance: 0, userEmail: null };

    // Lock the wallet row.
    const walletRows = await tx.$queryRaw<any[]>`
      SELECT * FROM "Wallet" WHERE "userId" = ${userId} FOR UPDATE
    `;
    const wallet = walletRows[0];
    if (!wallet) return { revoked: 0, newBalance: 0, userEmail: null };

    // Find the original TOPUP transaction by the original payment reference.
    const originalTopup = await tx.walletTransaction.findFirst({
      where: {
        walletId: wallet.id,
        type: "TOPUP",
        providerReference: originalProviderReference,
      },
    });
    // If the TOPUP hasn't been processed yet (out-of-order webhook delivery),
    // return -1 to signal the webhook route to return a non-200 status so
    // Stripe will retry the event later.
    if (!originalTopup) return { revoked: -1, newBalance: 0, userEmail: null };

    // Auto-detect credit amount if the webhook couldn't calculate it.
    if (creditsToRevoke === -1) {
      creditsToRevoke = Number(originalTopup.amount);
    }
    if (creditsToRevoke <= 0) return { revoked: 0, newBalance: Number(wallet.balance), userEmail: null };

    // Find the CreditBatch created closest to the original TOPUP that still
    // has remaining credits. We pick the batch nearest to the TOPUP's
    // createdAt — this is the "original batch" where credits were granted.
    // Filtering on remaining > 0 avoids locking a fully-spent batch.
    const topupDate = originalTopup.createdAt;
    const originalBatchRows = await tx.$queryRaw<any[]>`
      SELECT * FROM "CreditBatch"
      WHERE "userId" = ${userId} AND remaining > 0
      ORDER BY ABS(EXTRACT(EPOCH FROM ("createdAt" - ${topupDate}))) ASC
      LIMIT 1
      FOR UPDATE
    `;
    const originalBatch = originalBatchRows[0];

    let toRevoke = creditsToRevoke;

    // 1. Try to deduct from the original batch first.
    if (originalBatch && Number(originalBatch.remaining) > 0) {
      const deduct = Math.min(Number(originalBatch.remaining), toRevoke);
      await tx.creditBatch.update({
        where: { id: originalBatch.id },
        data: { remaining: { decrement: deduct } },
      });
      toRevoke -= deduct;
    }

    // 2. If the original batch didn't have enough, cover debt from other
    //    NON-EXPIRED batches ordered by expiresAt ASC (same priority as
    //    consumeCredits). We must not "repay" debt from expired batches —
    //    those credits have no value to the user and should be zeroed by
    //    the expiration cron, not consumed by a refund cascade.
    if (toRevoke > 0) {
      const allBatches = await tx.$queryRaw<any[]>`
        SELECT * FROM "CreditBatch"
        WHERE "userId" = ${userId} AND remaining > 0 AND "expiresAt" > NOW()
        ORDER BY "expiresAt" ASC
        FOR UPDATE
      `;
      // Exclude the original batch (already deducted above) in JS.
      const otherBatches = originalBatch
        ? allBatches.filter((b) => b.id !== originalBatch.id)
        : allBatches;

      for (const batch of otherBatches) {
        if (toRevoke <= 0) break;
        const deduct = Math.min(Number(batch.remaining), toRevoke);
        await tx.creditBatch.update({
          where: { id: batch.id },
          data: { remaining: { decrement: deduct } },
        });
        toRevoke -= deduct;
      }
    }

    // 3. Decrement the wallet balance by the full revoke amount.
    //    Batches were already decremented by (creditsToRevoke - toRevoke).
    //    The remaining debt (toRevoke) pushes the wallet balance negative,
    //    reflecting that the user spent credits they no longer have a right to.
    //    The POST /api/reports check (availableCredits from non-expired
    //    batches) will block new reports until the debt is settled.
    await tx.wallet.update({
      where: { id: wallet.id },
      data: {
        balance: { decrement: creditsToRevoke },
        version: { increment: 1 },
      },
    });

    // 4. Audit log.
    await tx.walletTransaction.create({
      data: {
        walletId: wallet.id,
        amount: creditsToRevoke,
        type: "REFUND_DEDUCTION",
        status: "COMPLETED",
        provider: provider || null,
        providerReference: refundReference,
        description: `Odčítanie kreditov — refund/chargeback (ref: ${refundReference})`,
      },
    });

    // Compute the new balance for notification purposes.
    const newBalance = Number(wallet.balance) - creditsToRevoke;

    // Fetch user email for notifications (inside the transaction for consistency).
    const userRow = await tx.user.findUnique({
      where: { id: userId },
      select: { email: true, name: true },
    });

    console.log(
      `[revokeCreditsOnRefund] Revoked ${creditsToRevoke} credits for user ${userId} ` +
      `(refund: ${refundReference}, original: ${originalProviderReference}). ` +
      `New wallet balance: ${newBalance}.`
    );

    return { revoked: creditsToRevoke, newBalance, userEmail: userRow?.email ?? null };
  });
}
