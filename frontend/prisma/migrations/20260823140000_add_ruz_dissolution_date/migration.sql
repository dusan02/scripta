-- Add ruzDissolutionDate — evidence-only field for RÚZ datumZrusenia
-- RÚZ never sets legalStatus (per contract update)
ALTER TABLE "Company" ADD COLUMN "ruzDissolutionDate" TIMESTAMP(3);

-- Backfill from seed-ruz-verification-bulk.ts data (if any companies have datumZrusenia)
-- Currently no companies have legalStatusSource = RUZ, so no cleanup needed.
-- This field will be populated by future RÚZ sync runs.
