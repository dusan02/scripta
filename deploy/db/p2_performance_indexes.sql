-- P2 Performance Indexes (Stream 4 / Final Push)
-- Targets measured bottlenecks:
--   1. /sitemap/[id].xml: 43.9s - 50.0s Parallel Seq Scan + Sort -> Index-Only Scan (<0.4s)
--   2. RelatedFirms: 23.39B index tuples scanned on Company_kraj_idx / Company_latestRevenue_idx
--
-- SAFETY:
--   - Uses CREATE INDEX CONCURRENTLY IF NOT EXISTS (non-blocking for reads & writes).
--   - Run manually outside a transaction block ONLY after explicit approval and EXPLAIN check.
--   - Zero existing indexes are dropped in this script.
--
-- ROLLBACK:
--   DROP INDEX CONCURRENTLY IF EXISTS "Company_fscount2_ico_sitemap_idx";
--   DROP INDEX CONCURRENTLY IF EXISTS "Company_fscount1_nace_kraj_rev_idx";
--   DROP INDEX CONCURRENTLY IF EXISTS "Company_fscount1_nace_rev_idx";
--   DROP INDEX CONCURRENTLY IF EXISTS "Company_fscount1_city_rev_idx";
--   DROP INDEX CONCURRENTLY IF EXISTS "Company_fscount2_kraj_rev_idx";
--   DROP INDEX CONCURRENTLY IF EXISTS "Company_fscount2_okres_rev_idx";
--   DROP INDEX CONCURRENTLY IF EXISTS "Company_fscount2_city_rev_idx";

CREATE INDEX CONCURRENTLY IF NOT EXISTS "Company_fscount2_ico_sitemap_idx"
  ON "Company" ("ico" ASC)
  INCLUDE ("name", "ruzSyncedAt", "updatedAt")
  WHERE "fsCount" >= 2;

CREATE INDEX CONCURRENTLY IF NOT EXISTS "Company_fscount1_nace_kraj_rev_idx"
  ON "Company" ("naceCode", "kraj", "latestRevenue" DESC NULLS LAST)
  INCLUDE ("ico", "name", "city")
  WHERE "fsCount" >= 1 AND "latestRevenue" IS NOT NULL;

CREATE INDEX CONCURRENTLY IF NOT EXISTS "Company_fscount1_nace_rev_idx"
  ON "Company" ("naceCode", "latestRevenue" DESC NULLS LAST)
  INCLUDE ("ico", "name", "city")
  WHERE "fsCount" >= 1 AND "latestRevenue" IS NOT NULL;

CREATE INDEX CONCURRENTLY IF NOT EXISTS "Company_fscount1_city_rev_idx"
  ON "Company" ("city", "latestRevenue" DESC NULLS LAST)
  INCLUDE ("ico", "name")
  WHERE "fsCount" >= 1 AND "latestRevenue" IS NOT NULL;

CREATE INDEX CONCURRENTLY IF NOT EXISTS "Company_fscount2_kraj_rev_idx"
  ON "Company" ("kraj", "latestRevenue" DESC NULLS LAST)
  INCLUDE ("ico", "name", "city")
  WHERE "fsCount" >= 2;

CREATE INDEX CONCURRENTLY IF NOT EXISTS "Company_fscount2_okres_rev_idx"
  ON "Company" ("okres", "latestRevenue" DESC NULLS LAST)
  INCLUDE ("ico", "name", "city")
  WHERE "fsCount" >= 2;

CREATE INDEX CONCURRENTLY IF NOT EXISTS "Company_fscount2_city_rev_idx"
  ON "Company" ("city", "latestRevenue" DESC NULLS LAST)
  INCLUDE ("ico", "name")
  WHERE "fsCount" >= 2;

ANALYZE "Company";
