-- Add kraj (NUTS3) and okres (LAU) geographic codes from RÚZ API
-- Per ARCH-RUZ-001: raw API values, no transformation, no city→region mapping.
-- Additive only (DB-001). No data loss. UI filter deferred per frozen contract.
ALTER TABLE "Company" ADD COLUMN "kraj" TEXT;
ALTER TABLE "Company" ADD COLUMN "okres" TEXT;
CREATE INDEX "Company_kraj_idx" ON "Company" USING btree ("kraj");
CREATE INDEX "Company_okres_idx" ON "Company" USING btree ("okres");
