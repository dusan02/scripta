import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { stripe } from "@/lib/stripe";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const rawBody = await req.text();
  const sig = req.headers.get("stripe-signature");

  if (!sig) {
    return NextResponse.json({ error: "Missing stripe-signature header" }, { status: 400 });
  }

  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) {
    console.error("STRIPE_WEBHOOK_SECRET is not set");
    return NextResponse.json({ error: "Server misconfiguration" }, { status: 500 });
  }

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, sig, webhookSecret);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("Stripe webhook signature verification failed:", message);
    return NextResponse.json({ error: `Webhook Error: ${message}` }, { status: 400 });
  }

  if (event.type === "payment_intent.succeeded") {
    const paymentIntent = event.data.object as Stripe.PaymentIntent;
    const { userId, credits: creditsStr } = paymentIntent.metadata;
    const credits = parseInt(creditsStr, 10);

    if (!userId || isNaN(credits)) {
      console.error("Invalid metadata in payment_intent.succeeded", paymentIntent.metadata);
      // Return 200 so Stripe doesn't retry — this is a data issue, not a transient error.
      return NextResponse.json({ received: true });
    }

    try {
      await prisma.$transaction(async (tx) => {
        // Idempotencia — Stripe môže webhook doručiť viackrát.
        const existing = await tx.walletTransaction.findUnique({
          where: { stripePaymentIntentId: paymentIntent.id },
        });
        if (existing) {
          console.log(`PaymentIntent ${paymentIntent.id} already processed, skipping.`);
          return;
        }

        // Find the wallet for this user.
        const wallet = await tx.wallet.findUnique({ where: { userId } });
        if (!wallet) {
          throw new Error(`Wallet not found for user ${userId}`);
        }

        // Increment balance.
        await tx.wallet.update({
          where: { id: wallet.id },
          data: { balance: { increment: credits } },
        });

        // Record the transaction. The unique stripePaymentIntentId acts as a
        // second line of defence against concurrent duplicate deliveries.
        await tx.walletTransaction.create({
          data: {
            walletId: wallet.id,
            amount: credits,
            type: "TOPUP",
            status: "COMPLETED",
            stripePaymentIntentId: paymentIntent.id,
            description: `Stripe top-up: ${credits} credits (${paymentIntent.metadata.packageId ?? "unknown"} package)`,
          },
        });
      });

      console.log(`Credited ${credits} credits to user ${userId} via PaymentIntent ${paymentIntent.id}`);
    } catch (err) {
      console.error("Failed to process payment_intent.succeeded", err);
      return NextResponse.json({ error: "Database error" }, { status: 500 });
    }
  }

  return NextResponse.json({ received: true });
}
