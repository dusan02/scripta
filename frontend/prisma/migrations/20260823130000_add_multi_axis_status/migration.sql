-- Multi-axis status model (per contract multi-axis-status-contract.md)
-- Separates legal status (ORSR/Vestník/RÚZ) from RÚZ reporting presence

ALTER TABLE "Company" ADD COLUMN "legalStatus" TEXT;
ALTER TABLE "Company" ADD COLUMN "legalStatusSource" TEXT;
ALTER TABLE "Company" ADD COLUMN "legalStatusObservedAt" TIMESTAMP(3);
ALTER TABLE "Company" ADD COLUMN "ruzReportingStatus" TEXT;

-- Backfill ruzReportingStatus from current status values
UPDATE "Company" SET "ruzReportingStatus" = 'VERIFIED'
WHERE status = 'ruz_active';

UPDATE "Company" SET "ruzReportingStatus" = 'NOT_FOUND'
WHERE status = 'ruz_checked';

UPDATE "Company" SET "ruzReportingStatus" = 'UNKNOWN'
WHERE "ruzReportingStatus" IS NULL;

-- Backfill legalStatus
-- ORSR-synced companies: ORSR is authoritative
UPDATE "Company" SET
  "legalStatus" = CASE
    WHEN status = 'LIQUIDATION' THEN 'LIQUIDATION'
    WHEN status = 'DISSOLVED' THEN 'DISSOLVED'
    WHEN status = 'ACTIVE' THEN 'ACTIVE'
    ELSE 'ACTIVE'
  END,
  "legalStatusSource" = 'ORSR',
  "legalStatusObservedAt" = "orsrSyncedAt"
WHERE "orsrSyncedAt" IS NOT NULL;

-- Non-ORSR companies: fallback to RÚZ datumZrusenia (we don't have this column yet,
-- but ruz_checked/ruz_active implies RÚZ was checked). For now, companies with
-- ruz_active/ruz_checked but no ORSR → legalStatus = UNKNOWN (per contract:
-- RÚZ doesn't certify legal activity, only reporting presence)
UPDATE "Company" SET
  "legalStatus" = 'UNKNOWN',
  "legalStatusSource" = 'NONE'
WHERE "legalStatus" IS NULL
  AND "ruzReportingStatus" IN ('VERIFIED', 'NOT_FOUND');

-- RPO-only companies (status = 'active' hardcoded, never checked RÚZ or ORSR)
UPDATE "Company" SET
  "legalStatus" = 'UNKNOWN',
  "legalStatusSource" = 'NONE'
WHERE "legalStatus" IS NULL;

-- Create indexes
CREATE INDEX "Company_legalStatus_idx" ON "Company" ("legalStatus");
CREATE INDEX "Company_ruzReportingStatus_idx" ON "Company" ("ruzReportingStatus");
