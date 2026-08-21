-- AlterTable: Add functionEnd and isActive to CompanyPerson
ALTER TABLE "CompanyPerson" ADD COLUMN "functionEnd" TIMESTAMP(3);
ALTER TABLE "CompanyPerson" ADD COLUMN "isActive" BOOLEAN NOT NULL DEFAULT true;

-- Backfill: all existing records are active by default
UPDATE "CompanyPerson" SET "isActive" = true WHERE "isActive" IS NULL;

-- Index for filtering active persons by company
CREATE INDEX "CompanyPerson_companyIco_isActive_idx" ON "CompanyPerson" ("companyIco", "isActive");
