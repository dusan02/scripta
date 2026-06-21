-- Add RPVS source type (schema drift: enum previously had only ORSR, ZRSR, INSOLVENCY, CRE)
ALTER TYPE "SourceType" ADD VALUE IF NOT EXISTS 'RPVS';

-- Enforce idempotent Stripe top-ups: a PaymentIntent can be credited at most once
CREATE UNIQUE INDEX IF NOT EXISTS "WalletTransaction_stripePaymentIntentId_key"
    ON "WalletTransaction"("stripePaymentIntentId");
