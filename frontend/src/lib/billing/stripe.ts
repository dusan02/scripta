import Stripe from "stripe";
import type { PaymentProviderAdapter, WebhookResult, CheckoutParams, CheckoutResult, PortalResult } from "./types";

let _stripe: Stripe | null = null;
function getStripe(): Stripe {
  if (!_stripe) {
    _stripe = new Stripe(process.env.STRIPE_SECRET_KEY || "");
  }
  return _stripe;
}

const PRICE_MAP: Record<string, { priceId: string; mode: "payment" | "subscription"; credits: number; planName: string }> = {
  payg1:     { priceId: process.env.STRIPE_PRICE_PAYG1     || "", mode: "payment",      credits: 1,   planName: "payg1" },
  payg10:    { priceId: process.env.STRIPE_PRICE_PAYG10    || "", mode: "payment",      credits: 10,  planName: "payg10" },
  payg50:    { priceId: process.env.STRIPE_PRICE_PAYG50    || "", mode: "payment",      credits: 50,  planName: "payg50" },
  freelance: { priceId: process.env.STRIPE_PRICE_FREELANCE || "", mode: "subscription", credits: 5,   planName: "freelance" },
  firma:     { priceId: process.env.STRIPE_PRICE_FIRMA     || "", mode: "subscription", credits: 20,  planName: "firma" },
  korporat:  { priceId: process.env.STRIPE_PRICE_KORPORAT  || "", mode: "subscription", credits: 40,  planName: "korporat" },
  addon5:    { priceId: process.env.STRIPE_PRICE_ADDON5    || "", mode: "payment",      credits: 5,   planName: "addon" },
};

export class StripeAdapter implements PaymentProviderAdapter {
  readonly providerName = "STRIPE" as const;

  async handleWebhook(body: string, signature: string): Promise<WebhookResult[]> {
    const stripe = getStripe();
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET || "";
    const event = stripe.webhooks.constructEvent(body, signature, webhookSecret);
    const results: WebhookResult[] = [];

    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        const userId = session.metadata?.userId;
        const credits = parseInt(session.metadata?.credits || "0", 10);
        const planName = session.metadata?.planName || "";

        if (userId && credits > 0) {
          results.push({
            type: "payment.succeeded",
            userId,
            credits,
            planName,
            providerReference: session.payment_intent as string,
          });
        }
        break;
      }

      case "invoice.paid": {
        const invoice = event.data.object as Stripe.Invoice;

        let userId = invoice.metadata?.userId;
        let planName = invoice.metadata?.planName;
        let creditsStr = invoice.metadata?.credits;

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
          results.push({
            type: "payment.succeeded",
            userId,
            credits,
            planName: planName || undefined,
            providerReference: invoice.id,
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
          results.push({
            type: "subscription.canceled",
            userId,
            credits: 0,
            providerReference: subscription.id,
            endsAt,
          });
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
            results.push({
              type: "subscription.canceled",
              userId,
              credits: 0,
              providerReference: subscription.id,
              endsAt,
            });
          } else if (subscription.status === "active") {
            results.push({
              type: "subscription.reactivated",
              userId,
              credits: 0,
              providerReference: subscription.id,
            });
          } else if (subscription.status === "past_due" || subscription.status === "unpaid") {
            results.push({
              type: "payment.failed",
              userId,
              credits: 0,
              providerReference: subscription.id,
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
            results.push({
              type: "payment.failed",
              userId,
              credits: 0,
              providerReference: invoice.id,
            });
          }
        }
        break;
      }

      case "invoice.finalized": {
        // Stripe-specific: ensure Slovak VAT (20%) is applied.
        // Paddle handles taxes automatically as MoR — this logic stays here.
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
        break;
    }

    return results;
  }

  async createCheckoutSession(params: CheckoutParams): Promise<CheckoutResult> {
    const { planId, userId, userEmail } = params;
    const plan = PRICE_MAP[planId];

    if (!plan || !plan.priceId) {
      throw new Error("Invalid plan");
    }

    const stripe = getStripe();
    const checkoutParams: Stripe.Checkout.SessionCreateParams = {
      mode: plan.mode,
      line_items: [{ price: plan.priceId, quantity: 1 }],
      success_url: `${process.env.NEXTAUTH_URL || "http://localhost:3000"}/plan?success=1`,
      cancel_url: `${process.env.NEXTAUTH_URL || "http://localhost:3000"}/plan?canceled=1`,
      customer_email: userEmail,
      metadata: { userId, planId, credits: String(plan.credits), planName: plan.planName },
    };

    if (plan.mode === "subscription") {
      checkoutParams.subscription_data = {
        metadata: { userId, planName: plan.planName, credits: String(plan.credits) },
      };
    }

    const checkout = await stripe.checkout.sessions.create(checkoutParams);
    if (!checkout.url) throw new Error("Stripe checkout URL missing");
    return { url: checkout.url };
  }

  async createPortalSession(userEmail: string): Promise<PortalResult> {
    const stripe = getStripe();
    const customers = await stripe.customers.list({ email: userEmail, limit: 1 });
    const customerId = customers.data[0]?.id;

    if (!customerId) {
      throw new Error("No active subscription found");
    }

    const returnUrl = `${process.env.NEXTAUTH_URL || "http://localhost:3000"}/plan`;
    const portalSession = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: returnUrl,
    });
    return { url: portalSession.url };
  }
}
