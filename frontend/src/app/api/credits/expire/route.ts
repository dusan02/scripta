import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { expireOldCredits, zeroOutExpiredSubscription } from "@/lib/credits";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const authHeader = req.headers.get("authorization");
  const expectedSecret = process.env.CRON_SECRET;

  if (!expectedSecret) {
    return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 500 });
  }

  if (authHeader !== `Bearer ${expectedSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    // 1. Expire credits older than 90 days
    const expiredCredits = await expireOldCredits();

    // 2. Zero out credits for canceled subscriptions that have ended
    const canceledUsers = await prisma.user.findMany({
      where: {
        subscriptionStatus: "canceled",
        subscriptionEndsAt: { lte: new Date() },
      },
      select: { id: true },
    });

    let zeroedCredits = 0;
    for (const user of canceledUsers) {
      zeroedCredits += await zeroOutExpiredSubscription(user.id);
    }

    return NextResponse.json({
      expiredCredits,
      zeroedCredits,
      canceledUsersProcessed: canceledUsers.length,
    });
  } catch (error) {
    console.error("Credit expiration cron error:", error);
    return NextResponse.json(
      { error: "Cron failed", details: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
