import { Paddle, Environment, EventName } from "@paddle/paddle-node-sdk";
import type { PaymentProviderAdapter, WebhookResult, CheckoutParams, CheckoutResult, PortalResult } from "./types";

export const PLAN_CREDITS_MAP: Record<string, number> = {
  payg1: 1,
  payg10: 10,
  payg50: 50,
};

export const PADDLE_PRICE_MAP: Record<string, { priceId: string; credits: number; planName: string }> = {
  payg1:  { priceId: process.env.PADDLE_PRICE_1  || "", credits: 1,  planName: "payg1" },
  payg10: { priceId: process.env.PADDLE_PRICE_10 || "", credits: 10, planName: "payg10" },
  payg50: { priceId: process.env.PADDLE_PRICE_50 || "", credits: 50, planName: "payg50" },
};

function getPaddlePriceMap(): Record<string, { priceId: string; credits: number; planName: string }> {
  return {
    payg1:  { priceId: process.env.PADDLE_PRICE_1  || "", credits: 1,  planName: "payg1" },
    payg10: { priceId: process.env.PADDLE_PRICE_10 || "", credits: 10, planName: "payg10" },
    payg50: { priceId: process.env.PADDLE_PRICE_50 || "", credits: 50, planName: "payg50" },
  };
}

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

      default:
        break;
    }

    return results;
  }

  async createCheckoutSession(params: CheckoutParams): Promise<CheckoutResult> {
    const { planId, userId, userEmail } = params;
    const priceMap = getPaddlePriceMap();
    const plan = priceMap[planId];

    if (!plan || !plan.priceId) {
      throw new Error("Invalid plan");
    }

    const paddle = getPaddle();

    const transactionParams: any = {
      items: [{ priceId: plan.priceId, quantity: 1 }],
      customData: {
        userId,
        planId,
      },
      customer: { email: userEmail },
    };

    // Only set checkout.url if we have an approved Paddle domain configured.
    // If not set, Paddle uses its default hosted checkout domain.
    const checkoutUrl = process.env.PADDLE_CHECKOUT_URL;
    if (checkoutUrl) {
      transactionParams.checkout = { url: checkoutUrl };
    }

    const transaction = await paddle.transactions.create(transactionParams);

    const txnCheckoutUrl = (transaction as any)?.checkout?.url;
    if (!txnCheckoutUrl) {
      throw new Error("Paddle checkout URL missing from transaction response");
    }

    return { url: txnCheckoutUrl };
  }

  async createPortalSession(_userEmail: string): Promise<PortalResult> {
    throw new Error("Paddle customer portal not yet implemented — subscriptions coming later.");
  }
}
