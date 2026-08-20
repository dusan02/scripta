-- AlterTable: Add dataQualityStatus column to FinancialStatement
-- Values: AVAILABLE | SOURCE_GAP | API_ERROR | PARSER_ERROR
-- NULL = not yet classified (legacy data)

ALTER TABLE "FinancialStatement" ADD COLUMN "dataQualityStatus" TEXT;

-- Backfill: classify existing FS based on current data state
-- FS with totalAssets AND currentAssets → AVAILABLE
UPDATE "FinancialStatement"
SET "dataQualityStatus" = 'AVAILABLE'
WHERE "totalAssets" IS NOT NULL AND "currentAssets" IS NOT NULL;

-- FS with totalAssets but no currentAssets (Pattern B) → SOURCE_GAP
-- (forensic audit confirmed 100% are RÚZ empty tables)
UPDATE "FinancialStatement"
SET "dataQualityStatus" = 'SOURCE_GAP'
WHERE "totalAssets" IS NOT NULL AND "currentAssets" IS NULL;

-- FS with equity but no totalAssets (Pattern A) → SOURCE_GAP
-- (forensic audit confirmed 100% are RÚZ empty tables)
UPDATE "FinancialStatement"
SET "dataQualityStatus" = 'SOURCE_GAP'
WHERE "totalAssets" IS NULL AND "equity" IS NOT NULL;

-- FS with no balance sheet data at all → SOURCE_GAP
UPDATE "FinancialStatement"
SET "dataQualityStatus" = 'SOURCE_GAP'
WHERE "totalAssets" IS NULL AND "equity" IS NULL AND "currentAssets" IS NULL;

-- Classify any remaining NULL (edge cases with partial data)
UPDATE "FinancialStatement"
SET "dataQualityStatus" = 'SOURCE_GAP'
WHERE "dataQualityStatus" IS NULL;

-- Enforce NOT NULL — every FS must have explicit data quality classification
ALTER TABLE "FinancialStatement" ALTER COLUMN "dataQualityStatus" SET NOT NULL;
