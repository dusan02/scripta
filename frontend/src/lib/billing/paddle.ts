import { Paddle, Environment, EventName } from "@paddle/paddle-node-sdk";
import type { PaymentProviderAdapter, WebhookResult, CheckoutParams, CheckoutResult, PortalResult } from "./types";

export const PLAN_CREDITS_MAP: Record<string, number> = {
  payg1: 1,
  payg10: 10,
  payg50: 50,
  // Subscription plans (for future use — not yet active in Paddle)
  freelance: 5,
  firma: 20,
  korporat: 40,
  addon5: 5,
};

export const PADDLE_PRICE_MAP: Record<string, { priceId: string; credits: number; planName: string }> = {
  payg1:  { priceId: process.env.PADDLE_PRICE_1  || "", credits: 1,  planName: "payg1" },
  payg10: { priceId: process.env.PADDLE_PRICE_10 || "", credits: 10, planName: "payg10" },
  payg50: { priceId: process.env.PADDLE_PRICE_50 || "", credits: 50, planName: "payg50" },
  // Subscription plans (env vars must be set when activated)
  freelance: { priceId: process.env.PADDLE_PRICE_FREELANCE || "", credits: 5,  planName: "freelance" },
  firma:     { priceId: process.env.PADDLE_PRICE_FIRMA     || "", credits: 20, planName: "firma" },
  korporat:  { priceId: process.env.PADDLE_PRICE_KORPORAT  || "", credits: 40, planName: "korporat" },
  addon5:    { priceId: process.env.PADDLE_PRICE_ADDON5    || "", credits: 5,  planName: "addon" },
};

let _paddle: Paddle | null = null;
function getPaddle(): Paddle {
  if (!_paddle) {
    const apiKey = process.env.PADDLE_API_KEY;
    if (!apiKey && process.env.NODE_ENV === "production") {
      throw new Error("[PADDLE] PADDLE_API_KEY must be set in production.");
    }
    const env = process.env.PADDLE_ENVIRONMENT === "production" ? Environment.production : Environment.sandbox;
    _paddle = new Paddle(apiKey || "", { environment: env });
  }
  return _paddle;
}

export class PaddleAdapter implements PaymentProviderAdapter {
  readonly providerName = "PADDLE" as const;

  async handleWebhook(body: string, signature: string): Promise<WebhookResult[]> {
    const paddle = getPaddle();
    const secretKey = process.env.PADDLE_WEBHOOK_SECRET;
    if (!secretKey && process.env.NODE_ENV === "production") {
      throw new Error("[PADDLE] PADDLE_WEBHOOK_SECRET must be set in production.");
    }

    const eventData = await paddle.webhooks.unmarshal(
      body,
      secretKey || "",
      signature,
    );

    if (!eventData) {
      throw new Error("[PADDLE] Webhook unmarshal returned null — invalid signature or payload.");
    }

    const eventId = (eventData as any).eventId || (eventData as any).event_id || undefined;
    const results: WebhookResult[] = [];

    switch (eventData.eventType) {
      case EventName.TransactionCompleted: {
        const txn = eventData.data as any;
        const customData = txn.customData || txn.custom_data || {};
        const userId = customData.userId;
        const planId = customData.planId;

        if (!userId || !planId) {
          console.error("[PADDLE] transaction.completed: missing userId or planId in custom_data", customData);
          break;
        }

        const credits = PLAN_CREDITS_MAP[planId];
        if (!credits || credits <= 0) {
          console.error(`[PADDLE] transaction.completed: unknown planId "${planId}" — cannot determine credits`);
          break;
        }

        results.push({
          type: "payment.succeeded",
          userId,
          credits,
          planName: planId,
          providerReference: txn.id,
          eventId,
        });
        break;
      }

      case EventName.AdjustmentUpdated: {
        const adj = eventData.data as any;
        const action = adj.action;
        const status = adj.status;

        if (status !== "approved") {
          break;
        }

        if (action !== "refund" && action !== "chargeback") {
          break;
        }

        const transactionId = adj.transactionId || adj.transaction_id;
        if (!transactionId) {
          console.error("[PADDLE] adjustment.updated: missing transactionId");
          break;
        }

        const customData = adj.customData || adj.custom_data || {};
        const userId = customData.userId;

        if (!userId) {
          console.error("[PADDLE] adjustment.updated: missing userId in custom_data");
          break;
        }

        const totals = adj.totals || {};
        const refundAmount = parseFloat(totals.total || "0");
        const chargeAmount = parseFloat(adj.totals?.chargebackFee?.amount || totals.total || "0");

        let creditsToRevoke = -1;
        const planId = customData.planId;
        if (planId && PLAN_CREDITS_MAP[planId]) {
          const originalCredits = PLAN_CREDITS_MAP[planId];
          if (refundAmount > 0 && chargeAmount > 0 && refundAmount >= chargeAmount) {
            creditsToRevoke = originalCredits;
          } else if (refundAmount > 0 && chargeAmount > 0) {
            creditsToRevoke = Math.ceil((refundAmount / chargeAmount) * originalCredits);
          } else {
            creditsToRevoke = originalCredits;
          }
        }

        results.push({
          type: "charge.refunded",
          userId,
          credits: creditsToRevoke,
          planName: planId || undefined,
          providerReference: adj.id,
          originalProviderReference: transactionId,
          eventId,
        });
        break;
      }

      case EventName.SubscriptionCanceled: {
        const sub = eventData.data as any;
        const customData = sub.customData || sub.custom_data || {};
        const userId = customData.userId;

        if (!userId) {
          console.error("[PADDLE] subscription.canceled: missing userId in custom_data");
          break;
        }

        const endsAt = sub.canceledAt || sub.canceled_at
          ? new Date(sub.canceledAt || sub.canceled_at)
          : new Date();

        results.push({
          type: "subscription.canceled",
          userId,
          credits: 0,
          providerReference: sub.id,
          endsAt,
          eventId,
        });
        break;
      }

      case EventName.SubscriptionUpdated: {
        const sub = eventData.data as any;
        const customData = sub.customData || sub.custom_data || {};
        const userId = customData.userId;

        if (!userId) {
          break;
        }

        const status = sub.status;

        if (status === "active") {
          // Reactivation or plan change
          const currentPeriodEnd = sub.nextBilledAt || sub.next_billed_at
            ? new Date(sub.nextBilledAt || sub.next_billed_at)
            : undefined;

          results.push({
            type: "subscription.reactivated",
            userId,
            credits: 0,
            providerReference: sub.id,
            currentPeriodEnd,
            eventId,
          });
        } else if (status === "paused" || status === "past_due") {
          results.push({
            type: "payment.failed",
            userId,
            credits: 0,
            providerReference: sub.id,
            eventId,
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
    const plan = PADDLE_PRICE_MAP[planId];

    if (!plan || !plan.priceId) {
      throw new Error("Invalid plan");
    }

    // Client-side overlay checkout: return URL with only planId (public info).
    // userId and email are stored in a short-lived httpOnly cookie set by the
    // checkout API route, and retrieved by the checkout page via
    // /api/billing/checkout-context. This avoids leaking userId in the URL.
    const params_ = new URLSearchParams({ planId });
    return { url: `/credits/checkout?${params_.toString()}` };
  }

  async createPortalSession(_userEmail: string): Promise<PortalResult> {
    throw new Error("Paddle customer portal not yet implemented — subscriptions coming later.");
  }
}
