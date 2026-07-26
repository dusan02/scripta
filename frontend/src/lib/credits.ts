import { prisma } from "@/lib/prisma";
import type { PaymentProvider } from "@prisma/client";

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
    // Ensure wallet exists
    let wallet = await tx.wallet.findUnique({ where: { userId } });
    if (!wallet) {
      wallet = await tx.wallet.create({
        data: { userId, balance: 0, currency: "EUR" },
      });
    }

    // Idempotency: check if transaction already exists for this provider reference
    if (providerReference) {
      const existing = await tx.walletTransaction.findUnique({
        where: { providerReference },
      });
      if (existing) return;
    }

    // Create credit batch
    await tx.creditBatch.create({
      data: {
        userId,
        amount,
        remaining: amount,
        source,
        planName: planName || null,
        expiresAt,
      },
    });

    // Increment wallet balance
    await tx.wallet.update({
      where: { userId },
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
        description: `Kredity — ${source}${planName ? ` (${planName})` : ""} (${amount} kreditov)`,
      },
    });
  });
}

/**
 * Consume credits using FIFO (First-In, First-Out).
 * Deducts from the oldest non-expired batches first.
 * Returns true if enough credits were available, false otherwise.
 */
export async function consumeCredits(
  userId: string,
  amount: number,
  reportRequestId?: string
): Promise<boolean> {
  return await prisma.$transaction(async (tx) => {
    // Pessimistic lock on wallet row — prevents concurrent modifications
    const walletRows = await tx.$queryRaw<any[]>`
      SELECT * FROM "Wallet" WHERE "userId" = ${userId} FOR UPDATE
    `;
    const wallet = walletRows[0];
    if (!wallet) return false;

    const walletBalance = Number(wallet.balance);
    if (walletBalance < amount) return false;

    // Pessimistic lock on batches (FIFO — oldest first)
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
 * Returns total number of credits expired.
 */
export async function expireOldCredits(): Promise<number> {
  const expiredBatches = await prisma.creditBatch.findMany({
    where: {
      remaining: { gt: 0 },
      expiresAt: { lt: new Date() },
    },
  });

  if (expiredBatches.length === 0) return 0;

  const byUser = new Map<string, number>();
  for (const batch of expiredBatches) {
    byUser.set(batch.userId, (byUser.get(batch.userId) || 0) + batch.remaining);
  }

  for (const batch of expiredBatches) {
    await prisma.creditBatch.update({
      where: { id: batch.id },
      data: { remaining: 0 },
    });
  }

  const userEntries = Array.from(byUser.entries());
  for (let i = 0; i < userEntries.length; i++) {
    const [userId, totalExpired] = userEntries[i];
    await prisma.wallet.update({
      where: { userId },
      data: {
        balance: { decrement: totalExpired },
        version: { increment: 1 },
      },
    });
  }

  const totalExpiredAll = expiredBatches.reduce((sum, b) => sum + b.remaining, 0);
  console.log(`[expireOldCredits] Expired ${totalExpiredAll} credits across ${byUser.size} users, ${expiredBatches.length} batches.`);
  return totalExpiredAll;
}

/**
 * Zero out remaining subscription credits for a canceled subscription past its end date.
 * Returns total credits zeroed.
 */
export async function zeroOutExpiredSubscription(userId: string): Promise<number> {
  const batches = await prisma.creditBatch.findMany({
    where: {
      userId,
      source: "subscription",
      remaining: { gt: 0 },
    },
  });

  if (batches.length === 0) return 0;

  const totalToZero = batches.reduce((sum, b) => sum + b.remaining, 0);

  for (const batch of batches) {
    await prisma.creditBatch.update({
      where: { id: batch.id },
      data: { remaining: 0 },
    });
  }

  await prisma.wallet.update({
    where: { userId },
    data: {
      balance: { decrement: totalToZero },
      version: { increment: 1 },
    },
  });

  console.log(`[zeroOutExpiredSubscription] Zeroed ${totalToZero} subscription credits for user ${userId}.`);
  return totalToZero;
}
