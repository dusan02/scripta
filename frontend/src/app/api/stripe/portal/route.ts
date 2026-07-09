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

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const stripe = getStripe();

    // Find or create Stripe customer by email
    const customers = await stripe.customers.list({
      email: session.user.email,
      limit: 1,
    });

    let customerId: string | undefined = customers.data[0]?.id;

    if (!customerId) {
      return NextResponse.json(
        { error: "No active subscription found. Please subscribe first." },
        { status: 404 }
      );
    }

    const returnUrl = `${process.env.NEXTAUTH_URL || "http://localhost:3000"}/plan`;

    const portalSession = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: returnUrl,
    });

    return NextResponse.json({ url: portalSession.url });
  } catch (error) {
    console.error("Stripe portal error:", error);
    return NextResponse.json(
      { error: "Failed to create portal session" },
      { status: 500 }
    );
  }
}
