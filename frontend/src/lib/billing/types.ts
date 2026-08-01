import type { PaymentProvider } from "@prisma/client";

export interface CheckoutParams {
  planId: string;
  userId: string;
  userEmail: string;
}

export interface CheckoutResult {
  url: string;
}

export interface PortalResult {
  url: string;
}

export interface WebhookResult {
  type:
    | "payment.succeeded"
    | "subscription.canceled"
    | "subscription.updated"
    | "subscription.reactivated"
    | "payment.failed"
    | "charge.refunded";
  userId: string;
  credits: number;
  planName?: string;
  providerReference: string;
  endsAt?: Date;
  /** The subscription's current period end — used to set planRenewalDate
   *  accurately instead of hardcoding +30 days. */
  currentPeriodEnd?: Date;
  /** For charge.refunded events: the original payment's providerReference
   *  (payment_intent or charge id) used to locate the original TOPUP. */
  originalProviderReference?: string;
}

export interface PaymentProviderAdapter {
  readonly providerName: PaymentProvider;

  handleWebhook(body: string, signature: string): Promise<WebhookResult[]>;
  createCheckoutSession(params: CheckoutParams): Promise<CheckoutResult>;
  createPortalSession(userEmail: string): Promise<PortalResult>;
}
