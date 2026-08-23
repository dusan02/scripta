-- F2+F3: Narrative extraction quality + evidence grounding
-- Adds: 7 new NotesRiskAnalysis fields, 2 new NarrativeRiskAnalysis fields,
--        sourcePages on both, findings (Json) on AuditVerdict.
-- Verifa Score and scoring tables are NOT touched.

-- ── NotesRiskAnalysis: 7 new extraction fields + sourcePages ──
ALTER TABLE "NotesRiskAnalysis" ADD COLUMN IF NOT EXISTS "significantInvestments"   TEXT;
ALTER TABLE "NotesRiskAnalysis" ADD COLUMN IF NOT EXISTS "financingActivities"      TEXT;
ALTER TABLE "NotesRiskAnalysis" ADD COLUMN IF NOT EXISTS "acquisitionsAndDisposals" TEXT;
ALTER TABLE "NotesRiskAnalysis" ADD COLUMN IF NOT EXISTS "provisionsAndReserves"    TEXT;
ALTER TABLE "NotesRiskAnalysis" ADD COLUMN IF NOT EXISTS "restructuringActivities"  TEXT;
ALTER TABLE "NotesRiskAnalysis" ADD COLUMN IF NOT EXISTS "capitalChanges"           TEXT;
ALTER TABLE "NotesRiskAnalysis" ADD COLUMN IF NOT EXISTS "subsequentEvents"         TEXT;
ALTER TABLE "NotesRiskAnalysis" ADD COLUMN IF NOT EXISTS "sourcePages"              TEXT;

-- ── NarrativeRiskAnalysis: 2 new fields + sourcePages ──
ALTER TABLE "NarrativeRiskAnalysis" ADD COLUMN IF NOT EXISTS "businessDevelopments"      TEXT;
ALTER TABLE "NarrativeRiskAnalysis" ADD COLUMN IF NOT EXISTS "strengthsAndOpportunities" TEXT;
ALTER TABLE "NarrativeRiskAnalysis" ADD COLUMN IF NOT EXISTS "sourcePages"               TEXT;

-- ── AuditVerdict: findings (structured RISK/STRENGTH/ANOMALY/UNKNOWN) ──
ALTER TABLE "AuditVerdict" ADD COLUMN IF NOT EXISTS "findings" JSONB;
