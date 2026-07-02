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

    const [userPlan, wallet, totalReports, successfulReports, failedReports, usedThisMonth, recentReports] = await Promise.all([
      prisma.user.findUnique({
        where: { id: user.id },
        select: { planName: true, planRenewalDate: true },
      }),
      prisma.wallet.findUnique({
        where: { userId: user.id },
      }),
      prisma.reportRequest.count({ where: { userId: user.id } }),
      prisma.reportRequest.count({ where: { userId: user.id, status: { in: ["COMPLETED", "PARTIAL"] } } }),
      prisma.reportRequest.count({ where: { userId: user.id, status: "FAILED" } }),
      prisma.reportRequest.count({ where: { userId: user.id, createdAt: { gte: startOfMonth, lte: endOfMonth } } }),
      prisma.reportRequest.findMany({
        where: { userId: user.id },
        orderBy: { createdAt: "desc" },
        take: 5,
        select: { id: true, ico: true, companyName: true, status: true, createdAt: true },
      }),
    ]);

    const remaining = wallet ? Number(wallet.balance) : 0;
    const totalCredits = remaining + successfulReports;

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
    console.error("GET /api/plan error", error);
    return NextResponse.json(
      { error: "Failed to fetch plan data", details: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
