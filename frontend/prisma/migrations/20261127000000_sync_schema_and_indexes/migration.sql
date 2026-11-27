-- Idempotent schema sync for AnalyticsEvent, ExtractionCache, totalLiabilities, and operational indexes.
-- Safe on both fresh PostgreSQL instances and production where some objects were created via db push.

ALTER TABLE "FinancialStatement" ADD COLUMN IF NOT EXISTS "totalLiabilities" DECIMAL(18, 2);

CREATE TABLE IF NOT EXISTS "AnalyticsEvent" (
    "id" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "companyIco" TEXT,
    "props" JSONB,
    "ipHash" TEXT,
    "registered" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AnalyticsEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "AnalyticsEvent_event_createdAt_idx" ON "AnalyticsEvent"("event", "createdAt");
CREATE INDEX IF NOT EXISTS "AnalyticsEvent_companyIco_idx" ON "AnalyticsEvent"("companyIco");

CREATE TABLE IF NOT EXISTS "ExtractionCache" (
    "id" TEXT NOT NULL,
    "pdfHash" TEXT NOT NULL,
    "companyIco" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "extractor" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "promptVersion" TEXT NOT NULL,
    "schemaVersion" TEXT NOT NULL,
    "temperature" DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    "rawResponse" JSONB NOT NULL,
    "normalizedData" JSONB NOT NULL,
    "confidence" TEXT NOT NULL DEFAULT 'UNKNOWN',
    "warnings" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "missingFields" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "sourceSize" INTEGER NOT NULL,
    "sourceType" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),
    CONSTRAINT "ExtractionCache_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ExtractionCache_pdfHash_extractor_model_promptVersion_schem_key"
    ON "ExtractionCache"("pdfHash", "extractor", "model", "promptVersion", "schemaVersion");
CREATE INDEX IF NOT EXISTS "ExtractionCache_companyIco_idx" ON "ExtractionCache"("companyIco");
CREATE INDEX IF NOT EXISTS "ExtractionCache_createdAt_idx" ON "ExtractionCache"("createdAt");

-- High-value operational indexes
CREATE INDEX IF NOT EXISTS "ReportRequest_ico_idx" ON "ReportRequest"("ico");
CREATE INDEX IF NOT EXISTS "ReportRequest_status_updatedAt_idx" ON "ReportRequest"("status", "updatedAt");
CREATE INDEX IF NOT EXISTS "WatchedCompany_companyId_idx" ON "WatchedCompany"("companyId");
CREATE INDEX IF NOT EXISTS "CompanyEvent_companyIco_eventDate_idx" ON "CompanyEvent"("companyIco", "eventDate");
CREATE INDEX IF NOT EXISTS "Feedback_requestId_idx" ON "Feedback"("requestId");
CREATE INDEX IF NOT EXISTS "User_paddleCustomerId_idx" ON "User"("paddleCustomerId");
