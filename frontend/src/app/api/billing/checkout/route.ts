import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/lib/auth";
import { getBillingAdapter } from "@/lib/billing";
import { PRICE_MAP as STRIPE_PRICE_MAP } from "@/lib/billing/stripe";
import { PADDLE_PRICE_MAP } from "@/lib/billing/paddle";
import { rateLimitByKey, rateLimitResponse } from "@/lib/rateLimit";
import { checkoutSchema } from "@/lib/api-schemas";

export const dynamic = "force-dynamic";

// Valid plan IDs — merged from all provider price maps to stay in sync
const VALID_PLAN_IDS = new Set([
  ...Object.keys(STRIPE_PRICE_MAP),
  ...Object.keys(PADDLE_PRICE_MAP),
]);

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Rate limit: max 10 checkout sessions per user per 10 minutes
    // (prevents Stripe API abuse — each session is a paid API call)
    const rl = await rateLimitByKey(`checkout:${session.user.id}`, {
      windowMs: 10 * 60 * 1000,
      maxRequests: 10,
    });
    if (!rl.allowed) return rateLimitResponse(rl);

    const body = await req.json().catch(() => null);
    const parsed = checkoutSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Plan ID required", details: parsed.error.flatten() }, { status: 400 });
    }
    const { planId } = parsed.data;

    if (!VALID_PLAN_IDS.has(planId)) {
      return NextResponse.json({ error: "Invalid plan ID" }, { status: 400 });
    }

    const adapter = getBillingAdapter();
    const result = await adapter.createCheckoutSession({
      planId,
      userId: session.user.id,
      userEmail: session.user.email,
    });

    // Store checkout context in a short-lived httpOnly cookie.
    // The checkout page reads this via /api/billing/checkout-context.
    // This avoids leaking userId/email in the URL.
    const response = NextResponse.json({ url: result.url });
    response.cookies.set("checkout_ctx", JSON.stringify({
      userId: session.user.id,
      email: session.user.email,
      planId,
    }), {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 300, // 5 minutes — checkout should complete quickly
      path: "/",
    });

    return response;
  } catch (error) {
    console.error("Checkout error:", error);
    const message = error instanceof Error ? error.message : "Checkout failed";
    const status = message === "Invalid plan" ? 400 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
