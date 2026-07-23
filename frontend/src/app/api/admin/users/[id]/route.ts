import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getServerSession } from "@/lib/auth";

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await getServerSession();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const adminUser = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { role: true },
    });

    if (adminUser?.role !== "ADMIN") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const user = await prisma.user.findUnique({
      where: { id: params.id },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        planName: true,
        planRenewalDate: true,
        subscriptionStatus: true,
        subscriptionEndsAt: true,
        createdAt: true,
        wallet: {
          select: {
            id: true,
            balance: true,
            currency: true,
          },
        },
      },
    });

    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    const [transactions, reports, creditBatches] = await Promise.all([
      prisma.walletTransaction.findMany({
        where: { walletId: user.wallet?.id },
        orderBy: { createdAt: "desc" },
        take: 50,
        select: {
          id: true,
          amount: true,
          type: true,
          status: true,
          description: true,
          provider: true,
          providerReference: true,
          reportRequestId: true,
          createdAt: true,
        },
      }),
      prisma.reportRequest.findMany({
        where: { userId: params.id },
        orderBy: { createdAt: "desc" },
        take: 20,
        select: {
          id: true,
          companyName: true,
          ico: true,
          status: true,
          createdAt: true,
          completedAt: true,
        },
      }),
      prisma.creditBatch.findMany({
        where: { userId: params.id },
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          amount: true,
          remaining: true,
          source: true,
          planName: true,
          expiresAt: true,
          createdAt: true,
        },
      }),
    ]);

    const totalSpent = transactions
      .filter((t) => t.type === "CHARGE")
      .reduce((sum, t) => sum + Math.abs(Number(t.amount)), 0);
    const totalPurchased = transactions
      .filter((t) => t.type === "TOPUP")
      .reduce((sum, t) => sum + Number(t.amount), 0);
    const totalRefunded = transactions
      .filter((t) => t.type === "REFUND")
      .reduce((sum, t) => sum + Number(t.amount), 0);

    return NextResponse.json({
      user,
      transactions: transactions.map((t) => ({
        ...t,
        amount: Number(t.amount),
      })),
      reports,
      creditBatches,
      summary: {
        totalSpent,
        totalPurchased,
        totalRefunded,
        walletBalance: user.wallet ? Number(user.wallet.balance) : 0,
        activeBatches: creditBatches.filter((b) => b.remaining > 0).length,
        totalReports: reports.length,
      },
    });
  } catch (error) {
    console.error("GET /api/admin/users/[id] error", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
