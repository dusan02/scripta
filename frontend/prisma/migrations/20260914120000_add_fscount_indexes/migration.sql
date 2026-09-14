-- fsCount indexes — fix 75-178s sitemap/hub queries
--
-- Root cause (2026-09-14 production EXPLAIN ANALYZE):
--   * getAllHubPaths() city query (GROUP BY city WHERE "fsCount" >= 2) → 178s
--     (subquery aggregated all ~1.36M FinancialStatement rows)
--   * Even after switching the query to the fsCount column, it still took 75s
--     because the index declared in schema.prisma (@@index([fsCount])) was
--     never applied to the production DB → Parallel Seq Scan on 518K rows.
--
-- 1. Company_fsCount_idx — declared in schema.prisma, missing in production.
--    Serves the sitemap index count + company chunk filter (fsCount >= 2).
-- 2. Company_city_fscount_idx — partial covering index for the sitemap/0.xml
--    city-hub query: index-only scan over cities of quality-gated companies.
--
-- IF NOT EXISTS keeps this migration idempotent.

CREATE INDEX IF NOT EXISTS "Company_fsCount_idx" ON "Company"("fsCount");
CREATE INDEX IF NOT EXISTS "Company_city_fscount_idx" ON "Company"(city)
  WHERE "fsCount" >= 2 AND city IS NOT NULL AND city <> '';
