import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/lib/auth";
import { PADDLE_PRICE_MAP } from "@/lib/billing/paddle";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/**
 * Returns checkout context (priceId, planId, userId, email) stored in the
 * httpOnly cookie by /api/billing/checkout. The checkout page uses this
 * to initialize Paddle.js without exposing userId in the URL.
 * Also returns paddleCustomerId for Retain pwCustomer if available.
 */
export async function GET(req: NextRequest) {
  const session = await getServerSession();
  if (!session?.user) {
    // Guest checkout path — context lives in the guest_ctx cookie set by
    // /api/billing/guest-checkout, backed by a server-side GuestCheckout row.
    const guestCookie = req.cookies.get("guest_ctx");
    if (!guestCookie?.value) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    try {
      const { guestId } = JSON.parse(guestCookie.value);
      const gc = await prisma.guestCheckout.findUnique({ where: { id: guestId } });
      if (!gc || gc.status !== "PENDING" || gc.expiresAt < new Date()) {
        return NextResponse.json({ error: "Checkout expired" }, { status: 410 });
      }
      const plan = PADDLE_PRICE_MAP[gc.planId];
      if (!plan || !plan.priceId) {
        return NextResponse.json({ error: "Invalid plan" }, { status: 400 });
      }
      return NextResponse.json({
        priceId: plan.priceId,
        planId: gc.planId,
        guestId: gc.id,
        email: gc.email,
      });
    } catch {
      return NextResponse.json({ error: "Invalid checkout context" }, { status: 400 });
    }
  }

  const cookie = req.cookies.get("checkout_ctx");
  if (!cookie?.value) {
    return NextResponse.json({ error: "No checkout context" }, { status: 400 });
  }

  try {
    const ctx = JSON.parse(cookie.value);

    // Verify the cookie belongs to the authenticated user
    if (ctx.userId !== session.user.id) {
      return NextResponse.json({ error: "Context mismatch" }, { status: 403 });
    }

    const plan = PADDLE_PRICE_MAP[ctx.planId];
    if (!plan || !plan.priceId) {
      return NextResponse.json({ error: "Invalid plan" }, { status: 400 });
    }

    // Fetch paddleCustomerId for Retain pwCustomer (if user has purchased before)
    let paddleCustomerId: string | undefined;
    try {
      const user = await prisma.user.findUnique({
        where: { id: session.user.id },
        select: { paddleCustomerId: true },
      });
      paddleCustomerId = user?.paddleCustomerId || undefined;
    } catch {
      // Non-critical — checkout works without pwCustomer
    }

    return NextResponse.json({
      priceId: plan.priceId,
      planId: ctx.planId,
      userId: ctx.userId,
      email: ctx.email,
      paddleCustomerId,
    });
  } catch {
    return NextResponse.json({ error: "Invalid checkout context" }, { status: 400 });
  }
}
