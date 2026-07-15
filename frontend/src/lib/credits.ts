import { prisma } from "@/lib/prisma";

const CREDIT_EXPIRY_DAYS = 90;

/**
 * Add a batch of credits to a user's wallet.
 * Creates a CreditBatch record and increments the wallet balance.
 */
export async function addCreditBatch(
  userId: string,
  amount: number,
  source: "trial" | "subscription" | "addon" | "rollover",
  planName?: string,
  paymentIntentId?: string
): Promise<void> {
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + CREDIT_EXPIRY_DAYS);

  await prisma.$transaction(async (tx) => {
    // Ensure wallet exists
    let wallet = await tx.wallet.findUnique({ where: { userId } });
    if (!wallet) {
      wallet = await tx.wallet.create({
        data: { userId, balance: 0, currency: "EUR" },
      });
    }

    // Idempotency: check if transaction already exists for this paymentIntent
    if (paymentIntentId) {
      const existing = await tx.walletTransaction.findUnique({
        where: { stripePaymentIntentId: paymentIntentId },
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
        stripePaymentIntentId: paymentIntentId || null,
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

        // Lock batches and check availability
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

        // Conditional update with optimistic locking; if version changed, throw conflict
        const updated = await tx.wallet.updateMany({
          where: { id: wallet.id, version: wallet.version },
          data: {
            balance: { decrement: amount },
            version: { increment: 1 },
          },
        });

        if (updated.count === 0) {
          throw new Error("Wallet version conflict");
        }

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
    } catch (err) {
      lastError = err;
      if (err instanceof Error && err.message === "Wallet version conflict") {
        await new Promise((resolve) => setTimeout(resolve, 10));
        continue;
      }
      throw err;
    }
  }

  throw lastError;
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

    // Find non-expired batches — include fully consumed ones (remaining=0)
    // so they can receive credits back (they have the most space)
    const batches = await tx.creditBatch.findMany({
      where: {
        userId,
        expiresAt: { gt: new Date() },
      },
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
 * Expire credits older than 90 days.
 * Returns the number of credits expired.
 */
export async function expireOldCredits(): Promise<number> {
  const now = new Date();
  const expiredBatches = await prisma.creditBatch.findMany({
    where: {
      remaining: { gt: 0 },
      expiresAt: { lte: now },
    },
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
        data: {
          balance: { decrement: expiredAmount },
          version: { increment: 1 },
        },
      });

      await tx.walletTransaction.create({
        data: {
          walletId: wallet.id,
          amount: expiredAmount,
          type: "CHARGE",
          status: "COMPLETED",
          description: `Expirácia kreditov — ${expiredAmount} kreditov starších ako ${CREDIT_EXPIRY_DAYS} dní`,
        },
      });
    }
  });

  return totalExpired;
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
 * Zero out all credits for a user whose canceled subscription has ended.
 */
export async function zeroOutExpiredSubscription(userId: string): Promise<number> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { subscriptionStatus: true, subscriptionEndsAt: true },
  });

  if (!user || user.subscriptionStatus !== "canceled" || !user.subscriptionEndsAt) {
    return 0;
  }

  if (user.subscriptionEndsAt > new Date()) return 0;

  const batches = await prisma.creditBatch.findMany({
    where: { userId, remaining: { gt: 0 } },
  });

  if (batches.length === 0) {
    // No credits to zero — just clear subscription state
    await prisma.user.update({
      where: { id: userId },
      data: {
        planName: null,
        planRenewalDate: null,
        subscriptionStatus: null,
        subscriptionEndsAt: null,
      },
    });
    return 0;
  }

  const batchIds = batches.map((b) => b.id);
  const totalZeroed = batches.reduce((sum, b) => sum + b.remaining, 0);

  await prisma.$transaction(async (tx) => {
    // 1. Zero out all remaining batches
    await tx.creditBatch.updateMany({
      where: { id: { in: batchIds } },
      data: { remaining: 0 },
    });

    // 2. Decrement wallet balance
    const wallet = await tx.wallet.update({
      where: { userId },
      data: {
        balance: { decrement: totalZeroed },
        version: { increment: 1 },
      },
    });

    // 3. Record audit transaction
    await tx.walletTransaction.create({
      data: {
        walletId: wallet.id,
        amount: totalZeroed,
        type: "CHARGE",
        status: "COMPLETED",
        description: "Vynulovanie kreditov — ukončenie predplatného",
      },
    });

    // 4. Clear subscription state
    await tx.user.update({
      where: { id: userId },
      data: {
        planName: null,
        planRenewalDate: null,
        subscriptionStatus: null,
        subscriptionEndsAt: null,
      },
    });
  });

  return totalZeroed;
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
