import type { PaymentProviderAdapter } from "./types";
import { StripeAdapter } from "./stripe";
import { PaddleAdapter } from "./paddle";

let _adapter: PaymentProviderAdapter | null = null;

export function getBillingAdapter(): PaymentProviderAdapter {
  if (_adapter) return _adapter;

  const provider = process.env.BILLING_PROVIDER || "stripe";

  switch (provider.toLowerCase()) {
    case "stripe":
      _adapter = new StripeAdapter();
      break;
    case "paddle":
      _adapter = new PaddleAdapter();
      break;
    default:
      throw new Error(`Unknown billing provider: ${provider}`);
  }

  return _adapter;
}
