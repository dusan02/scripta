-- Add DB-level idempotency: prevent duplicate CHARGE or REFUND for the same report.
-- PostgreSQL treats NULLs as distinct in unique constraints, so transactions
-- without a reportRequestId won't conflict.

-- First, remove any existing duplicates (keep the oldest by createdAt)
DELETE FROM "WalletTransaction" w1
USING "WalletTransaction" w2
WHERE w1.id > w2.id
  AND w1."reportRequestId" IS NOT NULL
  AND w1."reportRequestId" = w2."reportRequestId"
  AND w1.type = w2.type;

-- Create unique constraint
CREATE UNIQUE INDEX "WalletTransaction_reportRequestId_type_key"
ON "WalletTransaction" ("reportRequestId", "type")
WHERE "reportRequestId" IS NOT NULL;
