# SEO Handover — Next Steps

**Date:** 2026-08-29  
**Status:** Technical SEO architecture COMPLETE. Awaiting GSC credentials for monitoring.

---

## What's Done

### Technical Infrastructure
- 1,300+ hub pages deployed across 5 hub types × 6 languages
- 171/171 regression tests PASS
- Sitemap index (`/sitemap.xml`) working correctly — 39 child sitemaps, ~1.7M URLs
- Canonical, hreflang, JSON-LD, breadcrumbs — all verified
- ISR caching enabled — median 2.1s response time
- Thin hubs (<10 companies) noindexed
- Internal linking: 96.7% of quality companies reachable in ≤3 clicks
- `/mesto/` city slug resolution optimized with SQL unaccent

### Scripts Ready
- `scripts/validate-hub-seo.mjs` — hub SEO validator (246 URLs × 6 langs)
- `scripts/seo-regression-tests.mjs` — 171 automated regression checks
- `scripts/gsc-monitor.mjs` — GSC monitoring (requires credentials)

---

## What's Needed Next

### 1. GSC Service Account Setup (BLOCKING — needed for monitoring)

The `gsc-monitor.mjs` script is complete but requires a Google service account.

**Steps:**

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a project (or use existing "verifa" project)
3. Enable **Search Console API** (not just the web interface)
4. Create a **Service Account**:
   - IAM & Admin → Service Accounts → Create
   - Name: `verifa-gsc-monitor`
   - Role: None needed (GSC uses property-level auth)
5. Create a **JSON key** for the service account:
   - Click the service account → Keys → Add Key → JSON
   - Download the JSON file
6. Add the service account email to **Google Search Console**:
   - Go to [Search Console](https://search.google.com/search-console)
   - Select `verifa.sk` property
   - Settings → Users and permissions → Add user
   - Paste service account email (e.g. `verifa-gsc-monitor@project.iam.gserviceaccount.com`)
   - Permission: **Restricted** (read-only is sufficient)
7. Set environment variable:
   ```bash
   export GSC_SERVICE_ACCOUNT_FILE=/path/to/downloaded-key.json
   ```
8. Run:
   ```bash
   node scripts/gsc-monitor.mjs
   ```

**What the script reports:**
- Search performance (clicks, impressions, CTR, position) — last 28 days
- Top pages by clicks
- Top queries by clicks
- Sitemap status (submitted, indexed, errors, warnings)
- URL inspection (verdict, coverage state, canonical, last crawl)

### 2. Sitemap Submission to GSC

Once GSC access is set up:

1. Submit `https://verifa.sk/sitemap.xml` in GSC → Sitemaps
2. Monitor processing status (may take 24-48h for first crawl)
3. Check for errors/warnings after processing

### 3. fsCount Cron Job

The `fsCount` column on `Company` table needs periodic refresh when new financial statements are synced.

**Current state:** Updated manually. Should be added to `/api/cron/reseed-all` pipeline.

**SQL to refresh:**
```sql
UPDATE "Company" c
SET "fsCount" = sub.cnt
FROM (
  SELECT "companyIco", COUNT(*) as cnt
  FROM "FinancialStatement"
  GROUP BY "companyIco"
) sub
WHERE c.ico = sub."companyIco";
```

### 4. Baseline Metrics (after GSC is connected)

Run `gsc-monitor.mjs` weekly and track:

| Metric | Week 1 | Week 2 | Week 4 | Week 8 |
|--------|--------|--------|--------|--------|
| Indexed pages | ? | ? | ? | ? |
| Discovered URLs | ? | ? | ? | ? |
| Impressions | ? | ? | ? | ? |
| Clicks | ? | ? | ? | ? |
| CTR | ? | ? | ? | ? |
| Avg position | ? | ? | ? | ? |
| Crawl errors | ? | ? | ? | ? |

---

## Phase Roadmap (Post-GSC)

### Phase 1 — Indexation (weeks 1-4)
- GSC sitemap submission
- Monitor discovered vs indexed URLs
- Watch for "Discovered - currently not indexed"
- Check crawl stats and anomalies

### Phase 2 — Search Demand (weeks 4-8)
- Which queries Verifa appears for
- Which `/firma/` pages get impressions
- Which hubs get impressions
- Which languages perform

### Phase 3 — CTR Optimization (weeks 8-12)
- Title experiments
- Description optimization
- Rich results
- Brand vs generic queries

### Phase 4 — Authority (ongoing)
- Internal linking based on GSC data
- External backlinks
- Slovak/Czech business directories
- PR/content

---

## Key Files

| File | Purpose |
|------|---------|
| `scripts/validate-hub-seo.mjs` | Hub SEO validator (run before/after deploy) |
| `scripts/seo-regression-tests.mjs` | Regression tests (run after deploy) |
| `scripts/gsc-monitor.mjs` | GSC monitoring (run weekly, needs credentials) |
| `docs/seo-indexation-status.md` | Final technical SEO status report |
| `docs/seo-readiness-report.md` | Detailed audit report from previous session |
| `frontend/AGENTS.md` | Development guide with SEO notes |

---

## Commits (This Session)

| Commit | Description |
|--------|-------------|
| `a76ba02` | perf: optimize resolveCitySlug with SQL unaccent |
| `d05b210` | fix: resolveCitySlug SQL query order + regression tests |
| `b681b5f` | docs: SEO/indexation status report + regression test docs |
