import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const user = await getCurrentUser(req);
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);

    const [userPlan, totalReports, successfulReports, failedReports, usedThisMonth, recentReports, successfulReportsAllTime, validBatches, rolloverBatches] = await Promise.all([
      prisma.user.findUnique({
        where: { id: user.id },
        select: { planName: true, planRenewalDate: true },
      }),
      prisma.reportRequest.count({ where: { userId: user.id, deletedAt: null } }),
      prisma.reportRequest.count({ where: { userId: user.id, deletedAt: null, status: { in: ["COMPLETED", "PARTIAL"] }, createdAt: { gte: startOfMonth, lte: endOfMonth } } }),
      prisma.reportRequest.count({ where: { userId: user.id, deletedAt: null, status: "FAILED", createdAt: { gte: startOfMonth, lte: endOfMonth } } }),
      prisma.reportRequest.count({ where: { userId: user.id, deletedAt: null, createdAt: { gte: startOfMonth, lte: endOfMonth } } }),
      prisma.reportRequest.findMany({
        where: { userId: user.id, deletedAt: null },
        orderBy: { createdAt: "desc" },
        take: 5,
        select: { id: true, ico: true, companyName: true, status: true, createdAt: true },
      }),
      prisma.reportRequest.count({ where: { userId: user.id, status: { in: ["COMPLETED", "PARTIAL"] } } }),
      // Sum of non-expired batch remaining — matches the report API's credit check.
      // Wallet.balance can be stale if the expiration cron hasn't run yet.
      prisma.creditBatch.aggregate({
        where: {
          userId: user.id,
          remaining: { gt: 0 },
          expiresAt: { gt: now },
        },
        _sum: { remaining: true },
      }),
      // Rollover credits — separate display in UI
      prisma.creditBatch.aggregate({
        where: {
          userId: user.id,
          remaining: { gt: 0 },
          expiresAt: { gt: now },
          source: "rollover",
        },
        _sum: { remaining: true },
      }),
    ]);

    // Use CreditBatch SUM (non-expired) instead of Wallet.balance for consistency
    // with the report API. Wallet.balance may be stale if the expiration cron
    // hasn't run yet, leading to a discrepancy where UI shows credits but
    // report creation is blocked.
    const remaining = validBatches._sum.remaining ?? 0;
    const rolloverCredits = rolloverBatches._sum.remaining ?? 0;

    // Determine if user is on a subscription plan
    const isSubscription = !!userPlan?.planName && userPlan.planName !== "start";

    // totalCredits: different meaning for subscription vs PAYG
    // - Subscription: monthly quota (remaining + usedThisMonth = what they started with this month)
    // - PAYG: just remaining credits (no fixed quota — they buy what they need)
    const totalCredits = isSubscription
      ? remaining + usedThisMonth
      : remaining;

    let daysRemaining: number | null = null;
    if (userPlan?.planRenewalDate) {
      const diffTime = new Date(userPlan.planRenewalDate).getTime() - now.getTime();
      daysRemaining = Math.max(0, Math.ceil(diffTime / (1000 * 60 * 60 * 24)));
    }

    // Format period start label: "01. 01. 2026" style
    const periodStartLabel = new Intl.DateTimeFormat("sk-SK", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    }).format(startOfMonth);

    const res = NextResponse.json({
      totalReports,
      usedThisMonth,
      successfulReports,
      failedReports,
      remaining,
      totalCredits,
      rolloverCredits,
      planName: userPlan?.planName ?? null,
      isSubscription,
      daysRemaining,
      recentReports: recentReports.map((r) => ({
        id: r.id,
        ico: r.ico,
        companyName: r.companyName,
        status: r.status,
        createdAt: r.createdAt.toISOString(),
      })),
      periodStart: startOfMonth.toISOString(),
      periodEnd: endOfMonth.toISOString(),
      periodStartLabel,
    });
    // Prevent browser/proxy caching — credits change frequently
    res.headers.set("Cache-Control", "no-store, no-cache, must-revalidate");
    return res;
  } catch (error) {
    console.error("GET /api/credits/plan error", error);
    return NextResponse.json(
      { error: "Failed to fetch credits data" },
      { status: 500 }
    );
  }
}
