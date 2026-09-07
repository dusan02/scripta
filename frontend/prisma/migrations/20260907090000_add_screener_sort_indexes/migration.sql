-- Screener sort indexes — fix 36-65s Parallel Seq Scan on ORDER BY with DESC NULLS LAST
--
-- Root cause (2026-09-07 production EXPLAIN ANALYZE):
--   * ORDER BY name ASC        → 47s (only GIN trigram index existed; no btree for sort)
--   * ORDER BY establishedAt DESC NULLS LAST → 54s (ASC index cannot serve DESC NULLS LAST)
--   * ORDER BY legalForm DESC NULLS LAST     → 65s (same)
--   * ORDER BY city DESC NULLS LAST         → 56s (same)
--   PostgreSQL fell back to Parallel Seq Scan + top-N heapsort on 518K rows.
--
-- Note: Company_name_idx existed in baseline migration but was missing in the
-- production DB (manually dropped when the trigram GIN index was added).
-- IF NOT EXISTS keeps this migration idempotent for environments where the
-- indexes were already created manually.

CREATE INDEX IF NOT EXISTS "Company_name_idx" ON "Company"("name" ASC);
CREATE INDEX "Company_establishedAt_desc_nulls_last_idx" ON "Company"("establishedAt" DESC NULLS LAST);
CREATE INDEX "Company_legalForm_desc_nulls_last_idx" ON "Company"("legalForm" DESC NULLS LAST);
CREATE INDEX "Company_city_desc_nulls_last_idx" ON "Company"(city DESC NULLS LAST);
