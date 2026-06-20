-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('LAWYER', 'ADMIN');

-- CreateEnum
CREATE TYPE "TransactionType" AS ENUM ('CHARGE', 'TOPUP', 'REFUND');

-- CreateEnum
CREATE TYPE "TransactionStatus" AS ENUM ('PENDING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "ReportStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'PARTIAL');

-- CreateEnum
CREATE TYPE "TargetType" AS ENUM ('COMPANY', 'PERSON');

-- CreateEnum
CREATE TYPE "SourceType" AS ENUM ('ORSR', 'ZRSR', 'INSOLVENCY', 'CRE');

-- CreateEnum
CREATE TYPE "SourceStatus" AS ENUM ('PENDING', 'SUCCESS', 'FAILED', 'UNAVAILABLE');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "passwordHash" TEXT,
    "role" "UserRole" NOT NULL DEFAULT 'LAWYER',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
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

-- CreateTable
CREATE TABLE "ReportRequest" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" "ReportStatus" NOT NULL DEFAULT 'PENDING',
    "targetType" "TargetType" NOT NULL,
    "ico" TEXT,
    "name" TEXT,
    "surname" TEXT,
    "birthDate" TIMESTAMP(3),
    "selectedSources" "SourceType"[],
    "totalCost" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "resultUrl" TEXT,
    "resultFilePath" TEXT,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReportRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReportSource" (
    "id" TEXT NOT NULL,
    "reportRequestId" TEXT NOT NULL,
    "sourceType" "SourceType" NOT NULL,
    "status" "SourceStatus" NOT NULL DEFAULT 'PENDING',
    "statusMessage" TEXT,
    "filePath" TEXT,
    "pageCount" INTEGER,
    "costCredits" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "findings" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReportSource_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Wallet_userId_key" ON "Wallet"("userId");

-- CreateIndex
CREATE INDEX "Wallet_userId_idx" ON "Wallet"("userId");

-- CreateIndex
CREATE INDEX "WalletTransaction_walletId_idx" ON "WalletTransaction"("walletId");

-- CreateIndex
CREATE INDEX "WalletTransaction_reportRequestId_idx" ON "WalletTransaction"("reportRequestId");

-- CreateIndex
CREATE INDEX "ReportRequest_userId_idx" ON "ReportRequest"("userId");

-- CreateIndex
CREATE INDEX "ReportRequest_status_idx" ON "ReportRequest"("status");

-- CreateIndex
CREATE INDEX "ReportSource_reportRequestId_idx" ON "ReportSource"("reportRequestId");

-- CreateIndex
CREATE INDEX "ReportSource_sourceType_idx" ON "ReportSource"("sourceType");

-- CreateIndex
CREATE UNIQUE INDEX "ReportSource_reportRequestId_sourceType_key" ON "ReportSource"("reportRequestId", "sourceType");

-- AddForeignKey
ALTER TABLE "Wallet" ADD CONSTRAINT "Wallet_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WalletTransaction" ADD CONSTRAINT "WalletTransaction_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "Wallet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WalletTransaction" ADD CONSTRAINT "WalletTransaction_reportRequestId_fkey" FOREIGN KEY ("reportRequestId") REFERENCES "ReportRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReportRequest" ADD CONSTRAINT "ReportRequest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReportSource" ADD CONSTRAINT "ReportSource_reportRequestId_fkey" FOREIGN KEY ("reportRequestId") REFERENCES "ReportRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;
