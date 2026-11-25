-- P0.3: Partial covering indexes for Verifa hub pages (/kraj/*, /okres/*, /mesto/*, /odvetvie/*, /firmy/*)
-- Eliminates 65,000+ buffer heap scans (up to 24.2s under concurrency) on "fsCount" >= 2 queries
-- without locking writes on production tables (CONCURRENTLY).
--
-- IMPORTANT: Run manually on production PostgreSQL outside a transaction block ONLY after review/approval.
-- Rollback: DROP INDEX CONCURRENTLY IF EXISTS <index_name>;

CREATE INDEX CONCURRENTLY IF NOT EXISTS "Company_fscount2_kraj_stats_idx"
  ON "Company" ("kraj", "okres", "city")
  INCLUDE ("latestRevenue", "latestProfit")
  WHERE "fsCount" >= 2;

CREATE INDEX CONCURRENTLY IF NOT EXISTS "Company_fscount2_okres_stats_idx"
  ON "Company" ("okres", "city")
  INCLUDE ("latestRevenue", "latestProfit")
  WHERE "fsCount" >= 2;

CREATE INDEX CONCURRENTLY IF NOT EXISTS "Company_fscount2_city_stats_idx"
  ON "Company" ("city")
  INCLUDE ("latestRevenue", "latestProfit")
  WHERE "fsCount" >= 2;

CREATE INDEX CONCURRENTLY IF NOT EXISTS "Company_fscount2_nace_stats_idx"
  ON "Company" ("naceCode", "kraj", "okres")
  INCLUDE ("city", "latestRevenue", "latestProfit")
  WHERE "fsCount" >= 2;

ANALYZE "Company";
