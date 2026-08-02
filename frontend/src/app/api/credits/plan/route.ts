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
    // totalCredits = current balance + all-time successful reports.
    // Only COMPLETED/PARTIAL reports consumed credits permanently — FAILED and
    // CANCELLED reports were refunded, so their credits are already in `remaining`.
    // NOTE: This assumes 1 report = 1 credit. If variable credit costs are
    // introduced (e.g. CRE reports costing 5 credits), this will undercount.
    const totalCredits = remaining + successfulReportsAllTime;

    let daysRemaining: number | null = null;
    if (userPlan?.planRenewalDate) {
      const diffTime = new Date(userPlan.planRenewalDate).getTime() - now.getTime();
      daysRemaining = Math.max(0, Math.ceil(diffTime / (1000 * 60 * 60 * 24)));
    }

    return NextResponse.json({
      totalReports,
      usedThisMonth,
      successfulReports,
      failedReports,
      remaining,
      totalCredits,
      rolloverCredits,
      planName: userPlan?.planName ?? null,
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
    });
  } catch (error) {
    console.error("GET /api/credits/plan error", error);
    return NextResponse.json(
      { error: "Failed to fetch credits data" },
      { status: 500 }
    );
  }
}
