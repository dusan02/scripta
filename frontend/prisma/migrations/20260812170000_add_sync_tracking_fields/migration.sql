-- AlterTable: Add sync tracking fields to Company
ALTER TABLE "Company" ADD COLUMN "ruzEntityId" INTEGER;
ALTER TABLE "Company" ADD COLUMN "orsrSyncedAt" TIMESTAMP(3);
ALTER TABLE "Company" ADD COLUMN "ruzSyncedAt" TIMESTAMP(3);
ALTER TABLE "Company" ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable: Add tracking fields to FinancialStatement
ALTER TABLE "FinancialStatement" ADD COLUMN "ruzZavierkaId" INTEGER;
ALTER TABLE "FinancialStatement" ADD COLUMN "ruzVykazId" INTEGER;
ALTER TABLE "FinancialStatement" ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable: Add street, functionStart, updatedAt to CompanyPerson
ALTER TABLE "CompanyPerson" ADD COLUMN "street" TEXT;
ALTER TABLE "CompanyPerson" ADD COLUMN "functionStart" TIMESTAMP(3);
ALTER TABLE "CompanyPerson" ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- CreateIndex
CREATE INDEX "Company_orsrSyncedAt_idx" ON "Company"("orsrSyncedAt");
CREATE INDEX "Company_ruzSyncedAt_idx" ON "Company"("ruzSyncedAt");
