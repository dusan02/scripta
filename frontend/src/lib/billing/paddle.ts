import type { PaymentProviderAdapter, WebhookResult, CheckoutParams, CheckoutResult, PortalResult } from "./types";

export class PaddleAdapter implements PaymentProviderAdapter {
  readonly providerName = "PADDLE" as const;

  async handleWebhook(_body: string, _signature: string): Promise<WebhookResult[]> {
    throw new Error("Paddle integration coming soon");
  }

  async createCheckoutSession(_params: CheckoutParams): Promise<CheckoutResult> {
    throw new Error("Paddle integration coming soon");
  }

  async createPortalSession(_userEmail: string): Promise<PortalResult> {
    throw new Error("Paddle integration coming soon");
  }
}
