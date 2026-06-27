/*
  Warnings:

  - The values [CRE] on the enum `SourceType` will be removed. If these variants are still used in the database, this will fail.
  - You are about to drop the column `totalCost` on the `ReportRequest` table. All the data in the column will be lost.
  - You are about to drop the column `costCredits` on the `ReportSource` table. All the data in the column will be lost.
  - You are about to drop the `Wallet` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `WalletTransaction` table. If the table is not empty, all the data it contains will be lost.

*/
-- AlterEnum
BEGIN;
CREATE TYPE "SourceType_new" AS ENUM ('ORSR', 'ZRSR', 'RPO', 'RPVS', 'OBCHODNY_VESTNIK', 'INSOLVENCY', 'POVERENIA', 'FINANCNA_SPRAVA', 'SP_DLZNICI', 'VSZP_DLZNICI', 'DOVERA_DLZNICI', 'UNION_DLZNICI', 'CRRS', 'DISKVALIFIKACIE', 'NCRZP', 'NCRD', 'OCHRANNE_ZNAMKY', 'FS_DANOVE_SUBJEKTY', 'FS_DPH_REGISTROVANI', 'FS_DPH_RUSENIE', 'FS_DPH_VYMAZANI', 'FS_DPH_NADMERNY_ODPOCET', 'FS_DPH_BANKOVE_UCTY', 'FS_DAN_Z_PRIJMOV', 'FS_DAN_PRIJMOV_REG', 'REGISTER_UZ', 'CRZ', 'UVO');
ALTER TABLE "ReportRequest" ALTER COLUMN "selectedSources" TYPE "SourceType_new"[] USING ("selectedSources"::text::"SourceType_new"[]);
ALTER TABLE "ReportSource" ALTER COLUMN "sourceType" TYPE "SourceType_new" USING ("sourceType"::text::"SourceType_new");
ALTER TYPE "SourceType" RENAME TO "SourceType_old";
ALTER TYPE "SourceType_new" RENAME TO "SourceType";
DROP TYPE "SourceType_old";
COMMIT;

-- DropForeignKey
ALTER TABLE "Wallet" DROP CONSTRAINT "Wallet_userId_fkey";

-- DropForeignKey
ALTER TABLE "WalletTransaction" DROP CONSTRAINT "WalletTransaction_reportRequestId_fkey";

-- DropForeignKey
ALTER TABLE "WalletTransaction" DROP CONSTRAINT "WalletTransaction_walletId_fkey";

-- DropIndex
DROP INDEX "ReportRequest_userId_idx";

-- AlterTable
ALTER TABLE "ReportRequest" DROP COLUMN "totalCost",
ADD COLUMN     "companyName" TEXT;

-- AlterTable
ALTER TABLE "ReportSource" DROP COLUMN "costCredits";

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "crzDateFrom" TIMESTAMP(3),
ADD COLUMN     "orsrExtractType" TEXT NOT NULL DEFAULT 'CURRENT',
ADD COLUMN     "tokenVersion" INTEGER NOT NULL DEFAULT 0;

-- DropTable
DROP TABLE "Wallet";

-- DropTable
DROP TABLE "WalletTransaction";

-- DropEnum
DROP TYPE "TransactionStatus";

-- DropEnum
DROP TYPE "TransactionType";

-- CreateTable
CREATE TABLE "PasswordResetToken" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expires" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PasswordResetToken_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PasswordResetToken_token_key" ON "PasswordResetToken"("token");

-- CreateIndex
CREATE INDEX "PasswordResetToken_email_idx" ON "PasswordResetToken"("email");

-- CreateIndex
CREATE INDEX "PasswordResetToken_expires_idx" ON "PasswordResetToken"("expires");

-- CreateIndex
CREATE UNIQUE INDEX "PasswordResetToken_email_token_key" ON "PasswordResetToken"("email", "token");

-- CreateIndex
CREATE INDEX "ReportRequest_userId_createdAt_idx" ON "ReportRequest"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "ReportSource_status_idx" ON "ReportSource"("status");
