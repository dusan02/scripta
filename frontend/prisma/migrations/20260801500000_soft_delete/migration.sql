-- Add soft delete columns (deletedAt) to User and ReportRequest
ALTER TABLE "User" ADD COLUMN "deletedAt" TIMESTAMP(3);
ALTER TABLE "ReportRequest" ADD COLUMN "deletedAt" TIMESTAMP(3);

-- Index for filtering active (non-deleted) records
CREATE INDEX "User_deletedAt_idx" ON "User" ("deletedAt");
CREATE INDEX "ReportRequest_deletedAt_idx" ON "ReportRequest" ("deletedAt");
