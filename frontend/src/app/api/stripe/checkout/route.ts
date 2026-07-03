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

const PRICE_MAP: Record<string, string> = {
  onetime: process.env.STRIPE_PRICE_ONETIME || "",
  basic: process.env.STRIPE_PRICE_BASIC || "",
  biznis: process.env.STRIPE_PRICE_BIZNIS || "",
  pro: process.env.STRIPE_PRICE_PRO || "",
};

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { planId } = await req.json();
    const priceId = PRICE_MAP[planId];

    if (!priceId) {
      return NextResponse.json({ error: "Invalid plan" }, { status: 400 });
    }

    const checkout = await getStripe().checkout.sessions.create({
      mode: "payment",
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${process.env.NEXTAUTH_URL || "http://localhost:3000"}/plan?success=1`,
      cancel_url: `${process.env.NEXTAUTH_URL || "http://localhost:3000"}/plan?canceled=1`,
      customer_email: session.user.email,
      metadata: { userId: session.user.id, planId },
    });

    return NextResponse.json({ url: checkout.url });
  } catch {
    return NextResponse.json({ error: "Checkout failed" }, { status: 500 });
  }
}
