import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { expireOldCredits, zeroOutExpiredSubscription } from "@/lib/credits";
import { verifyCronSecret } from "@/lib/auth";
import { rateLimitByKey, rateLimitResponse } from "@/lib/rateLimit";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  if (!verifyCronSecret(req.headers.get("authorization"))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Rate limit: max 5 calls per 10 minutes (prevents abuse if secret leaks)
  const rl = await rateLimitByKey("cron:credits-expire", { windowMs: 10 * 60 * 1000, maxRequests: 5 });
  if (!rl.allowed) return rateLimitResponse(rl);

  return runExpire();
}

// Vercel Cron sends GET requests by default — delegate to POST handler.
// Authentication is still required via Authorization header.
export async function GET(req: NextRequest) {
  return POST(req);
}

async function runExpire() {
  try {
    // 1. Expire credits past their source-based expiry date (trial=30d, subscription=60d, rollover=60d, addon=permanent)
    const expiredCredits = await expireOldCredits();

    // 2. Zero out credits for canceled subscriptions that have ended
    const canceledUsers = await prisma.user.findMany({
      where: {
        subscriptionStatus: "canceled",
        subscriptionEndsAt: { lte: new Date() },
        deletedAt: null,
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
      { error: "Cron failed" },
      { status: 500 }
    );
  }
}
