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
  /** Present for authenticated purchases; guest checkouts carry
   *  guestCheckoutId instead and resolve userId in the webhook route. */
  userId?: string;
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
  /** Paddle webhook event_id for deduplication (evt_xxx). */
  eventId?: string;
  /** Guest checkout reference (custom_data.guestId) — present instead of
   *  userId for unauthenticated purchases. The webhook route resolves it
   *  to a real user via the GuestCheckout record. */
  guestCheckoutId?: string;
  /** Paddle-collected customer email on the transaction (guest checkouts). */
  customerEmail?: string;
  /** Paddle customer ID (ctm_...) — saved to User for Retain pwCustomer. */
  paddleCustomerId?: string;
}

export interface PaymentProviderAdapter {
  readonly providerName: PaymentProvider;

  handleWebhook(body: string, signature: string): Promise<WebhookResult[]>;
  createCheckoutSession(params: CheckoutParams): Promise<CheckoutResult>;
  createPortalSession(userEmail: string): Promise<PortalResult>;
}
