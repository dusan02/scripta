import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getServerSession } from "@/lib/auth";

export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userRecord = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { role: true },
    });

    if (userRecord?.role !== "ADMIN") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const [
      totalUsers,
      totalReports,
      completedReports,
      failedReports,
      pendingReports,
      totalFeedback,
      openFeedback,
      totalMessages,
      userMessages,
      totalWalletTransactions,
      totalCreditsSpent,
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

    const recentReports = await prisma.reportRequest.findMany({
      orderBy: { createdAt: "desc" },
      take: 10,
      select: {
        id: true,
        companyName: true,
        ico: true,
        status: true,
        createdAt: true,
        user: { select: { id: true, email: true } },
      },
    });

    const recentUsers = await prisma.user.findMany({
      orderBy: { createdAt: "desc" },
      take: 10,
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        createdAt: true,
      },
    });

    return NextResponse.json({
      stats: {
        totalUsers,
        totalReports,
        completedReports,
        failedReports,
        pendingReports,
        totalFeedback,
        openFeedback,
        totalMessages,
        userMessages,
        totalWalletTransactions,
        totalCreditsSpent: Math.abs(Number(totalCreditsSpent._sum.amount || 0)),
      },
      recentReports,
      recentUsers,
    });
  } catch (error) {
    console.error("GET /api/admin/overview error", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
