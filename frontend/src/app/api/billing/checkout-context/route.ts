import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/lib/auth";
import { PADDLE_PRICE_MAP } from "@/lib/billing/paddle";

export const dynamic = "force-dynamic";

/**
 * Returns checkout context (priceId, planId, userId, email) stored in the
 * httpOnly cookie by /api/billing/checkout. The checkout page uses this
 * to initialize Paddle.js without exposing userId in the URL.
 */
export async function GET(req: NextRequest) {
  const session = await getServerSession();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
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

    return NextResponse.json({
      priceId: plan.priceId,
      planId: ctx.planId,
      userId: ctx.userId,
      email: ctx.email,
    });
  } catch {
    return NextResponse.json({ error: "Invalid checkout context" }, { status: 400 });
  }
}
