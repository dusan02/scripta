import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { stripe } from "@/lib/stripe";
import { getCurrentUser } from "@/lib/auth";
import { CREDIT_PACKAGES, getPackageById } from "@/lib/creditPackages";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ─── Input validation ─────────────────────────────────────────────────────────

const checkoutSchema = z.object({
  packageId: z.enum(["small", "medium", "large"]),
});

// ─── Handler ──────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    const user = await getCurrentUser(req);
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const parseResult = checkoutSchema.safeParse(body);
    if (!parseResult.success) {
      return NextResponse.json(
        { error: "Invalid input", details: parseResult.error.flatten() },
        { status: 400 }
      );
    }

    const { packageId } = parseResult.data;
    const pkg = getPackageById(packageId);
    if (!pkg) {
      return NextResponse.json({ error: "Invalid package" }, { status: 400 });
    }

    const paymentIntent = await stripe.paymentIntents.create({
      amount: pkg.priceCents,
      currency: "eur",
      metadata: {
        userId: user.id,
        credits: String(pkg.credits),
        packageId,
      },
    });

    return NextResponse.json({ clientSecret: paymentIntent.client_secret });
  } catch (error) {
    console.error("POST /api/stripe/checkout error", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
