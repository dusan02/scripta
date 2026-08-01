-- AlterEnum
-- This migration adds the REFUND_DEDUCTION value to the WalletTransactionType enum.
-- Used by revokeCreditsOnRefund() to record credit revocations from chargebacks/refunds.

ALTER TYPE "WalletTransactionType" ADD VALUE IF NOT EXISTS 'REFUND_DEDUCTION';
