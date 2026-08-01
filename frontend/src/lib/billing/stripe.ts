import Stripe from "stripe";
import type { PaymentProviderAdapter, WebhookResult, CheckoutParams, CheckoutResult, PortalResult } from "./types";
import { NEXTAUTH_URL } from "@/lib/env";

let _stripe: Stripe | null = null;
function getStripe(): Stripe {
  if (!_stripe) {
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key && process.env.NODE_ENV === "production") {
      throw new Error("[STRIPE] STRIPE_SECRET_KEY must be set in production — refusing to start with empty key.");
    }
    _stripe = new Stripe(key || "");
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
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!webhookSecret && process.env.NODE_ENV === "production") {
      throw new Error("[STRIPE] STRIPE_WEBHOOK_SECRET must be set in production — refusing to verify webhook without secret.");
    }
    const event = stripe.webhooks.constructEvent(body, signature, webhookSecret || "");
    const results: WebhookResult[] = [];

    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        const userId = session.metadata?.userId;
        const credits = parseInt(session.metadata?.credits || "0", 10);
        const planName = session.metadata?.planName || "";

        // For subscriptions, credits are granted via the `invoice.paid` event,
        // which carries a stable providerReference (invoice.id) for idempotency.
        // The checkout session for subscriptions has payment_intent = null,
        // so emitting a payment.succeeded here would either skip idempotency
        // (null reference) or double-grant credits alongside invoice.paid.
        if (userId && credits > 0 && session.mode === "payment") {
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

      case "charge.refunded": {
        const charge = event.data.object as Stripe.Charge;
        const userId = (charge.metadata as Record<string, string>)?.userId;
        const planName = (charge.metadata as Record<string, string>)?.planName;
        const originalCreditsStr = (charge.metadata as Record<string, string>)?.credits;

        // The original payment reference used to store the TOPUP.
        // For subscription invoices, the TOPUP was stored with invoice.id
        // (from the invoice.paid event). The Charge object carries the
        // invoice ID as a string when the charge was created by an invoice.
        // We use a type cast because some Stripe SDK versions omit this
        // property from the TypeScript definitions even though the API
        // always returns it.
        const chargeWithInvoice = charge as Stripe.Charge & { invoice?: string | null };
        const invoiceId =
          typeof chargeWithInvoice.invoice === "string" ? chargeWithInvoice.invoice : null;
        const paymentIntentId =
          typeof charge.payment_intent === "string" ? charge.payment_intent : null;
        // Prefer invoice.id for subscriptions (matches how TOPUP was stored),
        // fall back to payment_intent for one-off payments, then charge.id.
        const originalProviderReference = invoiceId || paymentIntentId || charge.id;

        // The latest refund object — its id is used for idempotency.
        const latestRefund = charge.refunds?.data?.[charge.refunds.data.length - 1];
        const refundId = latestRefund?.id || `refund_${charge.id}`;
        const refundAmountCents = latestRefund?.amount ?? charge.amount_refunded ?? 0;
        const chargeAmountCents = charge.amount ?? 0;

        // Calculate credits to revoke proportionally.
        // Use Math.ceil so that partial refunds round UP (we revoke slightly
        // more credits rather than letting the user keep a fractional credit).
        // The result is always an integer, matching the Int type of
        // CreditBatch.remaining.
        let creditsToRevoke = 0;
        if (originalCreditsStr && chargeAmountCents > 0) {
          const originalCredits = parseInt(originalCreditsStr, 10);
          creditsToRevoke = Math.ceil((refundAmountCents / chargeAmountCents) * originalCredits);
        } else if (chargeAmountCents > 0 && refundAmountCents >= chargeAmountCents) {
          // Full refund but no metadata — signal with -1 so revoke function
          // looks up the original TOPUP amount from the database.
          creditsToRevoke = -1;
        }

        // For subscription plans, flag that the subscription should be canceled.
        // The webhook route will set subscriptionStatus = "canceled" in the DB.
        const isSubscription = planName &&
          planName !== "addon" &&
          !planName.startsWith("payg");

        // For subscription refunds, set endsAt to the current period end
        // (not now()) so credits from previous periods are preserved until
        // their natural expiry. Only a full chargeback should end immediately.
        let subscriptionEndsAt: Date | undefined;
        if (isSubscription && invoiceId) {
          try {
            const invoice = await stripe.invoices.retrieve(invoiceId);
            const subscriptionId = typeof (invoice as Stripe.Invoice & { subscription?: string | null }).subscription === "string"
              ? (invoice as Stripe.Invoice & { subscription?: string | null }).subscription
              : null;
            if (subscriptionId) {
              const subscription = await stripe.subscriptions.retrieve(subscriptionId);
              const periodEnd = subscription.items?.data?.[0]?.current_period_end;
              if (periodEnd) {
                subscriptionEndsAt = new Date(periodEnd * 1000);
              }
            }
          } catch (err) {
            console.error("[STRIPE] Failed to retrieve subscription period end for refund:", err);
          }
        }
        // Fallback: if we couldn't get period end, use now() only for full refunds
        // (chargebacks). For partial refunds, don't cancel the subscription.
        if (isSubscription && !subscriptionEndsAt) {
          const isFullRefund = refundAmountCents >= chargeAmountCents;
          subscriptionEndsAt = isFullRefund ? new Date() : undefined;
        }

        if (userId && creditsToRevoke !== 0) {
          results.push({
            type: "charge.refunded",
            userId,
            credits: creditsToRevoke,
            planName: planName || undefined,
            providerReference: refundId,
            originalProviderReference,
            // Set endsAt to period end (not now()) to preserve credits
            // from previous periods. Only full chargebacks end immediately.
            endsAt: subscriptionEndsAt,
          });
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
      success_url: `${NEXTAUTH_URL}/credits?success=1`,
      cancel_url: `${NEXTAUTH_URL}/credits?canceled=1`,
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

    const returnUrl = `${NEXTAUTH_URL}/credits`;
    const portalSession = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: returnUrl,
    });
    return { url: portalSession.url };
  }
}
