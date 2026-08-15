-- Add ORSR structured extraction fields to Company
ALTER TABLE "Company" ADD COLUMN "shareCapital" DECIMAL(15,2);
ALTER TABLE "Company" ADD COLUMN "businessActivity" TEXT;
ALTER TABLE "Company" ADD COLUMN "signingAuthority" TEXT;
