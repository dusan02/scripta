-- AlterEnum
-- This migration adds the REFUND_DEDUCTION value to the TransactionType enum.
-- Used by revokeCreditsOnRefund() to record credit revocations from chargebacks/refunds.

ALTER TYPE "TransactionType" ADD VALUE IF NOT EXISTS 'REFUND_DEDUCTION';
