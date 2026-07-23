-- CreateEnum
CREATE TYPE "PaymentProvider" AS ENUM ('STRIPE', 'PADDLE', 'MANUAL');

-- AlterTable
-- Rename stripePaymentIntentId to providerReference and change type semantics
ALTER TABLE "WalletTransaction" RENAME COLUMN "stripePaymentIntentId" TO "providerReference";

-- Add provider column
ALTER TABLE "WalletTransaction" ADD COLUMN "provider" "PaymentProvider";

-- Backfill existing rows: all existing transactions with a providerReference are Stripe
UPDATE "WalletTransaction" SET "provider" = 'STRIPE' WHERE "providerReference" IS NOT NULL;
UPDATE "WalletTransaction" SET "provider" = 'MANUAL' WHERE "providerReference" IS NULL;

-- CreateIndex
CREATE INDEX "WalletTransaction_provider_providerReference_idx" ON "WalletTransaction"("provider", "providerReference");
