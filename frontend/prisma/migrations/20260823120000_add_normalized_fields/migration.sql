-- Add normalized fields for canonical status and sizeCategory
-- These are derived from raw values at seed time and via this migration for existing rows

ALTER TABLE "Company" ADD COLUMN "statusNormalized" TEXT;
ALTER TABLE "Company" ADD COLUMN "sizeCategoryNormalized" TEXT;
ALTER TABLE "Company" ADD COLUMN "vestnikSyncedAt" TIMESTAMP(3);

-- Normalize status: map raw values to canonical enum
UPDATE "Company" SET "statusNormalized" = 'ACTIVE'
WHERE status IN ('ruz_active', 'ruz_checked', 'active', 'ACTIVE');

UPDATE "Company" SET "statusNormalized" = 'UNKNOWN'
WHERE status IS NULL OR status = '' OR "statusNormalized" IS NULL;

-- Normalize sizeCategory based on employeeCount (perfectly correlated per audit)
UPDATE "Company" SET "sizeCategoryNormalized" = 'micro'
WHERE "employeeCount" IS NOT NULL AND "employeeCount" <= 9;

UPDATE "Company" SET "sizeCategoryNormalized" = 'small'
WHERE "employeeCount" IS NOT NULL AND "employeeCount" >= 10 AND "employeeCount" <= 49;

UPDATE "Company" SET "sizeCategoryNormalized" = 'medium'
WHERE "employeeCount" IS NOT NULL AND "employeeCount" >= 50 AND "employeeCount" <= 249;

UPDATE "Company" SET "sizeCategoryNormalized" = 'large'
WHERE "employeeCount" IS NOT NULL AND "employeeCount" >= 250;

-- Firms with no employeeCount but with sizeCategory text — map from text
UPDATE "Company" SET "sizeCategoryNormalized" = 'micro'
WHERE "sizeCategoryNormalized" IS NULL
  AND "sizeCategory" IN ('0 zamestnancov', '1 zamestnanec', '2 zamestnanci', '3-4 zamestnanci', '5-9 zamestnancov', 'Mikro');

UPDATE "Company" SET "sizeCategoryNormalized" = 'small'
WHERE "sizeCategoryNormalized" IS NULL
  AND "sizeCategory" IN ('10-19 zamestnancov', '20-24 zamestnancov', '25-49 zamestnancov', 'Malá');

UPDATE "Company" SET "sizeCategoryNormalized" = 'medium'
WHERE "sizeCategoryNormalized" IS NULL
  AND "sizeCategory" IN ('50-99 zamestnancov', '100-149 zamestnancov', '150-199 zamestnancov', '200-249 zamestnancov', 'Stredná');

UPDATE "Company" SET "sizeCategoryNormalized" = 'large'
WHERE "sizeCategoryNormalized" IS NULL
  AND "sizeCategory" IN (
    '250-499 zamestnancov', '500-999 zamestnancov', '1000-1999 zamestnancov',
    '2000-2999 zamestnancov', '3000-3999 zamestnancov', '4000-4999 zamestnancov',
    '5000-9999 zamestnancov', '10000-19999 zamestnancov', 'Veľká'
  );

-- Everything else (nezistený, NULL, garbage) → unknown
UPDATE "Company" SET "sizeCategoryNormalized" = 'unknown'
WHERE "sizeCategoryNormalized" IS NULL;

-- Create indexes for normalized fields
CREATE INDEX "Company_statusNormalized_idx" ON "Company" ("statusNormalized");
CREATE INDEX "Company_sizeCategoryNormalized_idx" ON "Company" ("sizeCategoryNormalized");
CREATE INDEX "Company_vestnikSyncedAt_idx" ON "Company" ("vestnikSyncedAt");
