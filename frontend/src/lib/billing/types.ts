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
    | "payment.failed";
  userId: string;
  credits: number;
  planName?: string;
  providerReference: string;
  endsAt?: Date;
}

export interface PaymentProviderAdapter {
  readonly providerName: PaymentProvider;

  handleWebhook(body: string, signature: string): Promise<WebhookResult[]>;
  createCheckoutSession(params: CheckoutParams): Promise<CheckoutResult>;
  createPortalSession(userEmail: string): Promise<PortalResult>;
}
