-- Add email bounce/complaint tracking fields to User
ALTER TABLE "User" ADD COLUMN "emailBounced" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "User" ADD COLUMN "emailBouncedAt" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN "emailBouncedReason" TEXT;
ALTER TABLE "User" ADD COLUMN "emailComplained" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "User" ADD COLUMN "emailComplainedAt" TIMESTAMP(3);
