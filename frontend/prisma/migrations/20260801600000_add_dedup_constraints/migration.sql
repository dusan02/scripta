-- Add unique constraints for deduplication and index for soft-delete queries
--
-- CompanyEvent: ON CONFLICT DO NOTHING requires a unique constraint to work.
-- Without it, duplicate events were silently inserted on every scraper run.
-- The unique constraint covers (companyIco, source, eventType, eventDate, amount).
-- NULL values for eventDate/amount are treated as distinct by PostgreSQL, so
-- events with NULL dates/amounts won't conflict (acceptable — they're rare).
--
-- VestnikEvent: sourceId from XML feed identifies unique vestnik records.
-- Unique constraint on (companyIco, sourceId) prevents duplicate imports.
-- sourceId can be NULL (old data) — NULLs are distinct, so no conflict.
--
-- ReportRequest: deletedAt index speeds up soft-delete filtering used in 20+ queries.

-- Deduplicate existing CompanyEvent rows before adding unique constraint.
-- Keep only the earliest occurrence of each duplicate.
DELETE FROM "CompanyEvent" a USING "CompanyEvent" b
WHERE a.id > b.id
  AND a."companyIco" = b."companyIco"
  AND a.source = b.source
  AND a."eventType" = b."eventType"
  AND a."eventDate" IS NOT DISTINCT FROM b."eventDate"
  AND a.amount IS NOT DISTINCT FROM b.amount;

-- Create unique index for CompanyEvent deduplication
CREATE UNIQUE INDEX "CompanyEvent_companyIco_source_eventType_eventDate_amount_key"
ON "CompanyEvent" ("companyIco", "source", "eventType", "eventDate", "amount");

-- Deduplicate existing VestnikEvent rows before adding unique constraint.
-- Keep only the earliest occurrence of each duplicate (by sourceId).
DELETE FROM "VestnikEvent" a USING "VestnikEvent" b
WHERE a.id > b.id
  AND a."companyIco" = b."companyIco"
  AND a."sourceId" IS NOT DISTINCT FROM b."sourceId"
  AND a."sourceId" IS NOT NULL;

-- Create unique index for VestnikEvent deduplication
CREATE UNIQUE INDEX "VestnikEvent_companyIco_sourceId_key"
ON "VestnikEvent" ("companyIco", "sourceId")
WHERE "sourceId" IS NOT NULL;

-- Index for soft-delete filtering on ReportRequest
CREATE INDEX "ReportRequest_deletedAt_idx"
ON "ReportRequest" ("deletedAt");
