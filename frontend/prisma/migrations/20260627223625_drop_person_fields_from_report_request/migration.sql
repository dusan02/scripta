-- Person-related fields were removed from ReportRequest (COMPANY-only target)
-- Columns were already dropped from the database via db push; this migration
-- formalises the change so fresh deployments and migrate reset stay consistent.

ALTER TABLE "ReportRequest" DROP COLUMN IF EXISTS "name";
ALTER TABLE "ReportRequest" DROP COLUMN IF EXISTS "surname";
ALTER TABLE "ReportRequest" DROP COLUMN IF EXISTS "birthDate";
ALTER TABLE "ReportRequest" DROP COLUMN IF EXISTS "totalCost";

-- ReportSource: costCredits was removed in the same refactor
ALTER TABLE "ReportSource" DROP COLUMN IF EXISTS "costCredits";

-- TargetType enum: PERSON was removed
ALTER TYPE "TargetType" DROP VALUE IF EXISTS "PERSON";
