import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { addCreditBatch, cancelSubscription } from "@/lib/credits";
import { getBillingAdapter } from "@/lib/billing";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const adapter = getBillingAdapter();
  const body = await req.text();

  // Signature header name varies by provider
  const signature =
    req.headers.get("stripe-signature") ||
    req.headers.get("signature") ||
    req.headers.get("paddle-signature") ||
    "";

  if (!signature) {
    return NextResponse.json({ error: "Missing signature" }, { status: 400 });
  }

  let events;
  try {
    events = await adapter.handleWebhook(body, signature);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("Paddle")) {
      return NextResponse.json({ error: message }, { status: 501 });
    }
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  try {
    for (const event of events) {
      switch (event.type) {
        case "payment.succeeded": {
          if (event.credits > 0) {
            const source = event.planName === "addon" ? "addon" : "subscription";
            await addCreditBatch(
              event.userId,
              event.credits,
              source,
              event.planName,
              event.providerReference,
              adapter.providerName
            );

            if (event.planName && event.planName !== "addon") {
              const renewalDate = new Date();
              renewalDate.setDate(renewalDate.getDate() + 30);
              await prisma.user.update({
                where: { id: event.userId },
                data: {
                  planName: event.planName,
                  planRenewalDate: renewalDate,
                  subscriptionStatus: "active",
                },
              });
            }
          }
          break;
        }

        case "subscription.canceled": {
          if (event.endsAt) {
            await cancelSubscription(event.userId, event.endsAt);
          }
          break;
        }

        case "subscription.reactivated": {
          await prisma.user.update({
            where: { id: event.userId },
            data: {
              subscriptionStatus: "active",
              subscriptionEndsAt: null,
            },
          });
          break;
        }

        case "payment.failed": {
          await prisma.user.update({
            where: { id: event.userId },
            data: { subscriptionStatus: "past_due" },
          });
          break;
        }
      }
    }

    return NextResponse.json({ received: true });
  } catch (error) {
    console.error("Billing webhook error:", error);
    return NextResponse.json({ error: "Webhook handler failed" }, { status: 500 });
  }
}
