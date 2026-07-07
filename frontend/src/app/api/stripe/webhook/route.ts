import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { prisma } from "@/lib/prisma";
import { addCreditBatch, cancelSubscription } from "@/lib/credits";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

let _stripe: Stripe | null = null;
function getStripe(): Stripe {
  if (!_stripe) {
    _stripe = new Stripe(process.env.STRIPE_SECRET_KEY || "");
  }
  return _stripe;
}

export async function POST(req: NextRequest) {
  const stripe = getStripe();
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET || "";

  if (!webhookSecret) {
    return NextResponse.json({ error: "Webhook secret not configured" }, { status: 500 });
  }

  const body = await req.text();
  const signature = req.headers.get("stripe-signature");

  if (!signature) {
    return NextResponse.json({ error: "Missing signature" }, { status: 400 });
  }

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(body, signature, webhookSecret);
  } catch (err) {
    return NextResponse.json(
      { error: "Invalid signature", details: err instanceof Error ? err.message : String(err) },
      { status: 400 }
    );
  }

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        const userId = session.metadata?.userId;
        const credits = parseInt(session.metadata?.credits || "0", 10);
        const planName = session.metadata?.planName || "";

        if (userId && credits > 0) {
          const source = planName === "addon" ? "addon" : "subscription";
          await addCreditBatch(userId, credits, source, planName, session.payment_intent as string);

          // Set plan name and renewal date (30 days for subscriptions)
          if (planName !== "addon") {
            const renewalDate = new Date();
            renewalDate.setDate(renewalDate.getDate() + 30);
            await prisma.user.update({
              where: { id: userId },
              data: {
                planName,
                planRenewalDate: renewalDate,
                subscriptionStatus: "active",
              },
            });
          }
        }
        break;
      }

      case "invoice.paid": {
        const invoice = event.data.object as Stripe.Invoice;
        
        let userId = invoice.metadata?.userId;
        let planName = invoice.metadata?.planName;
        let creditsStr = invoice.metadata?.credits;

        // Ak nie sú v invoice, skúsime ich načítať zo subscription
        if (!userId || !creditsStr) {
          const subDetails = invoice.parent?.subscription_details;
          const subId = subDetails && typeof subDetails.subscription === "string" ? subDetails.subscription : null;
          if (subId) {
            const subscription = await stripe.subscriptions.retrieve(subId);
            userId = userId || subscription.metadata?.userId;
            planName = planName || subscription.metadata?.planName;
            creditsStr = creditsStr || subscription.metadata?.credits;
          }
        }

        const credits = parseInt(creditsStr || "0", 10);

        if (userId && credits > 0) {
          await addCreditBatch(userId, credits, "subscription", planName, invoice.id);

          const renewalDate = new Date();
          renewalDate.setDate(renewalDate.getDate() + 30);
          await prisma.user.update({
            where: { id: userId },
            data: {
              planName,
              planRenewalDate: renewalDate,
              subscriptionStatus: "active",
            },
          });
        }
        break;
      }

      case "customer.subscription.deleted": {
        const subscription = event.data.object as Stripe.Subscription;
        const userId = (subscription.metadata as Record<string, string>)?.userId;
        if (userId) {
          const periodEnd = subscription.items?.data?.[0]?.current_period_end;
          const endsAt = periodEnd ? new Date(periodEnd * 1000) : new Date();
          await cancelSubscription(userId, endsAt);
        }
        break;
      }

      case "customer.subscription.updated": {
        const subscription = event.data.object as Stripe.Subscription;
        if (subscription.cancel_at_period_end) {
          const userId = (subscription.metadata as Record<string, string>)?.userId;
          if (userId) {
            const periodEnd = subscription.items?.data?.[0]?.current_period_end;
            const endsAt = periodEnd ? new Date(periodEnd * 1000) : new Date();
            await cancelSubscription(userId, endsAt);
          }
        }
        break;
      }

      default:
        // Unhandled event type — ignore
        break;
    }

    return NextResponse.json({ received: true });
  } catch (error) {
    console.error("Stripe webhook error:", error);
    return NextResponse.json(
      { error: "Webhook handler failed", details: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
