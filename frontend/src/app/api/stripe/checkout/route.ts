import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/lib/auth";
import Stripe from "stripe";

export const dynamic = "force-dynamic";

let _stripe: Stripe | null = null;
function getStripe(): Stripe {
  if (!_stripe) {
    _stripe = new Stripe(process.env.STRIPE_SECRET_KEY || "");
  }
  return _stripe;
}

const PRICE_MAP: Record<string, { priceId: string; mode: "payment" | "subscription"; credits: number; planName: string }> = {
  start:     { priceId: process.env.STRIPE_PRICE_START     || "", mode: "payment",      credits: 1,   planName: "start" },
  freelance: { priceId: process.env.STRIPE_PRICE_FREELANCE || "", mode: "subscription", credits: 10,  planName: "freelance" },
  firma:     { priceId: process.env.STRIPE_PRICE_FIRMA     || "", mode: "subscription", credits: 20,  planName: "firma" },
  korporat:  { priceId: process.env.STRIPE_PRICE_KORPORAT  || "", mode: "subscription", credits: 50,  planName: "korporat" },
  addon5:    { priceId: process.env.STRIPE_PRICE_ADDON5    || "", mode: "payment",      credits: 5,   planName: "addon" },
};

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { planId } = await req.json();
    const plan = PRICE_MAP[planId];

    if (!plan || !plan.priceId) {
      return NextResponse.json({ error: "Invalid plan" }, { status: 400 });
    }

    const checkoutParams: Stripe.Checkout.SessionCreateParams = {
      mode: plan.mode,
      line_items: [{ price: plan.priceId, quantity: 1 }],
      success_url: `${process.env.NEXTAUTH_URL || "http://localhost:3000"}/plan?success=1`,
      cancel_url: `${process.env.NEXTAUTH_URL || "http://localhost:3000"}/plan?canceled=1`,
      customer_email: session.user.email,
      metadata: { userId: session.user.id, planId, credits: String(plan.credits), planName: plan.planName },
    };

    if (plan.mode === "subscription") {
      checkoutParams.subscription_data = {
        metadata: { userId: session.user.id, planName: plan.planName, credits: String(plan.credits) },
      };
    }

    const checkout = await getStripe().checkout.sessions.create(checkoutParams);

    return NextResponse.json({ url: checkout.url });
  } catch {
    return NextResponse.json({ error: "Checkout failed" }, { status: 500 });
  }
}
