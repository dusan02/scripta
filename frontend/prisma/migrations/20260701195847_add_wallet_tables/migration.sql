/*
  Warnings:

  - The values [PERSON] on the enum `TargetType` will be removed. If these variants are still used in the database, this will fail.

*/
-- CreateEnum
CREATE TYPE "FeedbackCategory" AS ENUM ('BUG', 'IMPROVEMENT', 'QUESTION', 'OTHER');

-- CreateEnum
CREATE TYPE "MessageType" AS ENUM ('ANNOUNCEMENT', 'REPLY', 'SYSTEM');

-- CreateEnum
CREATE TYPE "TransactionType" AS ENUM ('CHARGE', 'TOPUP', 'REFUND');

-- CreateEnum
CREATE TYPE "TransactionStatus" AS ENUM ('PENDING', 'COMPLETED', 'FAILED');

-- AlterEnum
BEGIN;
CREATE TYPE "TargetType_new" AS ENUM ('COMPANY');
ALTER TABLE "ReportRequest" ALTER COLUMN "targetType" TYPE "TargetType_new" USING ("targetType"::text::"TargetType_new");
ALTER TYPE "TargetType" RENAME TO "TargetType_old";
ALTER TYPE "TargetType_new" RENAME TO "TargetType";
DROP TYPE "TargetType_old";
COMMIT;

-- AlterTable
ALTER TABLE "ReportRequest" ADD COLUMN     "aiStatus" TEXT,
ADD COLUMN     "eta" INTEGER;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "defaultSources" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- CreateTable
CREATE TABLE "Feedback" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "category" "FeedbackCategory" NOT NULL,
    "requestId" TEXT,
    "message" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "reply" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Feedback_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserMessage" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "type" "MessageType" NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "read" BOOLEAN NOT NULL DEFAULT false,
    "feedbackId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Company" (
    "ico" TEXT NOT NULL,
    "name" TEXT,
    "naceCode" TEXT,
    "naceText" TEXT,

    CONSTRAINT "Company_pkey" PRIMARY KEY ("ico")
);

-- CreateTable
CREATE TABLE "VestnikEvent" (
    "id" TEXT NOT NULL,
    "companyIco" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "severityLevel" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "publishedAt" TIMESTAMP(3) NOT NULL,
    "sourceId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VestnikEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FinancialStatement" (
    "id" TEXT NOT NULL,
    "companyIco" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "totalAssets" DOUBLE PRECISION,
    "currentAssets" DOUBLE PRECISION,
    "equity" DOUBLE PRECISION,
    "shortTermLiabilities" DOUBLE PRECISION,
    "longTermLiabilities" DOUBLE PRECISION,
    "mainActivityRevenue" DOUBLE PRECISION,
    "grossProfit" DOUBLE PRECISION,
    "netProfitLoss" DOUBLE PRECISION,
    "cashAndEquivalents" DOUBLE PRECISION,
    "operatingCashFlow" DOUBLE PRECISION,
    "staffCosts" DOUBLE PRECISION,
    "tradeReceivables" DOUBLE PRECISION,
    "tradePayables" DOUBLE PRECISION,
    "currency" TEXT NOT NULL DEFAULT 'EUR',
    "statementType" TEXT NOT NULL DEFAULT 'SK_GAAP',
    "monthsInPeriod" INTEGER DEFAULT 12,
    "isConsolidated" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FinancialStatement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditorOpinion" (
    "id" TEXT NOT NULL,
    "financialStatementId" TEXT NOT NULL,
    "opinionType" TEXT NOT NULL,
    "goingConcernRisk" BOOLEAN NOT NULL,
    "reservationText" TEXT,

    CONSTRAINT "AuditorOpinion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NarrativeRiskAnalysis" (
    "id" TEXT NOT NULL,
    "financialStatementId" TEXT NOT NULL,
    "managementChanges" TEXT,
    "litigationRisks" TEXT,
    "goingConcernDoubts" BOOLEAN NOT NULL,
    "plannedInvestments" TEXT,
    "forensicRedFlags" TEXT[],
    "synthesis" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NarrativeRiskAnalysis_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotesRiskAnalysis" (
    "id" TEXT NOT NULL,
    "financialStatementId" TEXT NOT NULL,
    "relatedPartyTransactions" TEXT,
    "offBalanceSheetLiabilities" TEXT,
    "contingentRisks" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NotesRiskAnalysis_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditVerdict" (
    "id" TEXT NOT NULL,
    "companyIco" TEXT NOT NULL,
    "verifaScore" INTEGER NOT NULL,
    "riskCategory" TEXT NOT NULL,
    "debtExposureRating" INTEGER,
    "finalVerdict" TEXT NOT NULL,
    "executiveSummary" TEXT,
    "justification" TEXT NOT NULL,
    "keyRisk" TEXT NOT NULL,
    "scorecardBreakdown" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditVerdict_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Wallet" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "balance" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'EUR',
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Wallet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WalletTransaction" (
    "id" TEXT NOT NULL,
    "walletId" TEXT NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "type" "TransactionType" NOT NULL,
    "status" "TransactionStatus" NOT NULL DEFAULT 'COMPLETED',
    "reportRequestId" TEXT,
    "stripePaymentIntentId" TEXT,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WalletTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Feedback_userId_idx" ON "Feedback"("userId");

-- CreateIndex
CREATE INDEX "Feedback_status_idx" ON "Feedback"("status");

-- CreateIndex
CREATE INDEX "UserMessage_userId_idx" ON "UserMessage"("userId");

-- CreateIndex
CREATE INDEX "UserMessage_read_idx" ON "UserMessage"("read");

-- CreateIndex
CREATE INDEX "VestnikEvent_companyIco_idx" ON "VestnikEvent"("companyIco");

-- CreateIndex
CREATE INDEX "VestnikEvent_severityLevel_idx" ON "VestnikEvent"("severityLevel");

-- CreateIndex
CREATE UNIQUE INDEX "FinancialStatement_companyIco_year_key" ON "FinancialStatement"("companyIco", "year");

-- CreateIndex
CREATE UNIQUE INDEX "AuditorOpinion_financialStatementId_key" ON "AuditorOpinion"("financialStatementId");

-- CreateIndex
CREATE UNIQUE INDEX "NarrativeRiskAnalysis_financialStatementId_key" ON "NarrativeRiskAnalysis"("financialStatementId");

-- CreateIndex
CREATE UNIQUE INDEX "NotesRiskAnalysis_financialStatementId_key" ON "NotesRiskAnalysis"("financialStatementId");

-- CreateIndex
CREATE UNIQUE INDEX "AuditVerdict_companyIco_key" ON "AuditVerdict"("companyIco");

-- CreateIndex
CREATE UNIQUE INDEX "Wallet_userId_key" ON "Wallet"("userId");

-- CreateIndex
CREATE INDEX "Wallet_userId_idx" ON "Wallet"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "WalletTransaction_stripePaymentIntentId_key" ON "WalletTransaction"("stripePaymentIntentId");

-- CreateIndex
CREATE INDEX "WalletTransaction_walletId_idx" ON "WalletTransaction"("walletId");

-- CreateIndex
CREATE INDEX "WalletTransaction_reportRequestId_idx" ON "WalletTransaction"("reportRequestId");

-- AddForeignKey
ALTER TABLE "Feedback" ADD CONSTRAINT "Feedback_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VestnikEvent" ADD CONSTRAINT "VestnikEvent_companyIco_fkey" FOREIGN KEY ("companyIco") REFERENCES "Company"("ico") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinancialStatement" ADD CONSTRAINT "FinancialStatement_companyIco_fkey" FOREIGN KEY ("companyIco") REFERENCES "Company"("ico") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditorOpinion" ADD CONSTRAINT "AuditorOpinion_financialStatementId_fkey" FOREIGN KEY ("financialStatementId") REFERENCES "FinancialStatement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NarrativeRiskAnalysis" ADD CONSTRAINT "NarrativeRiskAnalysis_financialStatementId_fkey" FOREIGN KEY ("financialStatementId") REFERENCES "FinancialStatement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotesRiskAnalysis" ADD CONSTRAINT "NotesRiskAnalysis_financialStatementId_fkey" FOREIGN KEY ("financialStatementId") REFERENCES "FinancialStatement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditVerdict" ADD CONSTRAINT "AuditVerdict_companyIco_fkey" FOREIGN KEY ("companyIco") REFERENCES "Company"("ico") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Wallet" ADD CONSTRAINT "Wallet_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WalletTransaction" ADD CONSTRAINT "WalletTransaction_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "Wallet"("id") ON DELETE CASCADE ON UPDATE CASCADE;
