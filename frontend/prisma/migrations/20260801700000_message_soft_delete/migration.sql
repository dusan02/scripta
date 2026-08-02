-- Add soft delete support to UserMessage
ALTER TABLE "UserMessage" ADD COLUMN "deletedAt" TIMESTAMP(3);

-- Index for efficient soft-delete filtering
CREATE INDEX "UserMessage_deletedAt_idx" ON "UserMessage"("deletedAt");
