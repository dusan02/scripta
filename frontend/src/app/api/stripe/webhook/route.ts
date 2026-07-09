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
        const userId = (subscription.metadata as Record<string, string>)?.userId;
        if (userId) {
          if (subscription.cancel_at_period_end) {
            const periodEnd = subscription.items?.data?.[0]?.current_period_end;
            const endsAt = periodEnd ? new Date(periodEnd * 1000) : new Date();
            await cancelSubscription(userId, endsAt);
          } else if (subscription.status === "active") {
            // Reactivated subscription
            await prisma.user.update({
              where: { id: userId },
              data: {
                subscriptionStatus: "active",
                subscriptionEndsAt: null,
              },
            });
          } else if (subscription.status === "past_due" || subscription.status === "unpaid") {
            await prisma.user.update({
              where: { id: userId },
              data: { subscriptionStatus: "past_due" },
            });
          }
        }
        break;
      }

      case "invoice.payment_failed": {
        const invoice = event.data.object as Stripe.Invoice;
        const subDetails = invoice.parent?.subscription_details;
        const subId = subDetails && typeof subDetails.subscription === "string" ? subDetails.subscription : null;
        if (subId) {
          const subscription = await stripe.subscriptions.retrieve(subId);
          const userId = (subscription.metadata as Record<string, string>)?.userId;
          if (userId) {
            await prisma.user.update({
              where: { id: userId },
              data: { subscriptionStatus: "past_due" },
            });
          }
        }
        break;
      }

      case "invoice.finalized": {
        // Ensure Slovak VAT (20%) is applied to the invoice
        const invoice = event.data.object as Stripe.Invoice;
        const hasTax = (invoice as unknown as Record<string, unknown>).tax !== undefined && (invoice as unknown as Record<string, unknown>).tax !== null;
        if (!hasTax) {
          try {
            await stripe.invoices.update(invoice.id, {
              default_tax_rates: [process.env.STRIPE_TAX_RATE_SK || ""],
            });
          } catch {
            // Tax rate might not be configured — skip silently
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
