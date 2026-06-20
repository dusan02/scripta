import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { stripe } from "@/lib/stripe";
import { getCurrentUser } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ─── Credit packages ─────────────────────────────────────────────────────────

const CREDIT_PACKAGES = {
  small:  { credits: 20,  amountEur: 990  },  // 9.90 EUR v centoch
  medium: { credits: 60,  amountEur: 2490 },  // 24.90 EUR
  large:  { credits: 150, amountEur: 4990 },  // 49.90 EUR
} as const;

type PackageId = keyof typeof CREDIT_PACKAGES;

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

    const { packageId } = parseResult.data as { packageId: PackageId };
    const pkg = CREDIT_PACKAGES[packageId];

    const paymentIntent = await stripe.paymentIntents.create({
      amount: pkg.amountEur,
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
