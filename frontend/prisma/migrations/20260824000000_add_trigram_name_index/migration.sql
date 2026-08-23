-- GIN trigram index on Company.name for fast ILIKE '%query%' fulltext search.
-- pg_trgm extension is already installed.
-- Without this index, `name ILIKE '%OKTE%'` on 518K rows does a seq scan (15+ seconds).
-- With the GIN trigram index, the same query is ~10-50ms.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "Company_name_trgm_idx"
  ON "Company" USING gin ("name" gin_trgm_ops);
