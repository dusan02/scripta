# Verifa.sk — GSC Baseline Snapshot (2026-09-07, PRE-DEPLOY)

**Source:** Google Search Console → verifa.sk → Indexing → Pages
**Export date:** 2026-09-07
**Data range:** 2026-08-28 → 2026-09-04 (GSC property verified ~Aug 28)
**Deploy date:** 2026-09-07 (SEO URL architecture `f230571`)
**Note:** This is the PRE-DEPLOY baseline. New `/firmy/` URLs are NOT yet in this data.

## Indexation Status (2026-09-04)

| Metric | Value | % of total |
|---|---|---|
| **Indexed** | 4,402 | 71.8% |
| **Not indexed** | 1,732 | 28.2% |
| **Total URLs known to Google** | 6,134 | 100% |
| **Total URLs in sitemap** | ~278,000 | — |
| **Google discovery rate** | 6,134 / 278,000 = **2.2%** | — |

**Critical insight:** Google has only discovered 2.2% of the sitemap. The new `/firmy/` URLs (deployed Sep 7) are NOT yet in this data. The 4,402 indexed pages are the OLD architecture (pre-deploy).

## Not Indexed — Breakdown (1,732 URLs)

| Reason | Count | % | Expected? | Action |
|---|---|---|---|---|
| Stránka s presmerovaním (redirect) | 481 | 27.8% | ✅ Expected — old `/odvetvie/`, `/screener/odvetvie/`, `/screener/kraj/` URLs | Will drop as Google processes 308s |
| Blokovaná robots.txt | 436 | 25.2% | ✅ Expected — `/api/`, `/admin/`, `/dashboard/`, `/login`, etc. | No action needed |
| Indexovo prehľadávané – neindexované | 256 | 14.8% | 🟡 Investigate — crawled but not indexed (thin content?) | Monitor after deploy |
| Vylúčená noindex | 254 | 14.7% | ✅ Expected — screener query params, thin hubs | No action needed |
| Alternatívna canonical | 189 | 10.9% | 🟡 Investigate — Google chose different canonical | Check hreflang variants |
| Duplikovať bez canonical | 73 | 4.2% | 🟡 Investigate — duplicate without canonical | Check for missing canonical |
| Duplicitná – iná canonical | 25 | 1.4% | 🟡 Investigate — Google chose different canonical | Check hreflang variants |
| Nenájdené (404) | 8 | 0.5% | 🟡 Minor — 8 real 404s | Check which URLs |
| Falošné 404 | 7 | 0.4% | 🟡 Minor — false 404s | Check Google's crawl errors |
| Chyba servera (5xx) | 3 | 0.2% | 🟡 Minor — 3 server errors | Check server logs |

### Priority investigation items

1. **481 redirect pages** — Expected. These are old `/odvetvie/` URLs. After deploy (Sep 7), they now return 308 to `/firmy/`. Google will process these and drop them from the index over 1-4 weeks.

2. **189 + 25 = 214 canonical issues** — Google is choosing a different canonical than what we specified. Likely causes:
   - Hreflang variants (`/en/firmy/...`, `/de/firmy/...`) being treated as duplicates
   - Old `/screener?naceSection=I` vs new `/firmy/{nace-slug}` — Google may not have processed the canonical change yet
   - Need to check specific URLs after GSC provides them

3. **73 duplicate without canonical** — Pages that have no canonical tag and Google considers duplicates. Need to identify which URLs.

4. **256 crawled but not indexed** — Google crawled these pages but decided not to index them. Likely thin content or low quality. After deploy, these may get re-evaluated.

## Impressions Trend (Aug 28 – Sep 4)

| Date | Indexed | Not indexed | Impressions |
|---|---|---|---|
| 2026-08-28 | 1,194 | 1,168 | 2,270 |
| 2026-08-29 | 4,402 | 1,732 | 1,262 |
| 2026-08-30 | 4,402 | 1,732 | 2,269 |
| 2026-08-31 | 4,402 | 1,732 | **5,461** (peak) |
| 2026-09-01 | 4,402 | 1,732 | 2,841 |
| 2026-09-02 | 4,402 | 1,732 | 4,915 |
| 2026-09-03 | 4,402 | 1,732 | 3,910 |
| 2026-09-04 | 4,402 | 1,732 | 2,779 |

**Observations:**
- Aug 28 → Aug 29: indexed jumped from 1,194 to 4,402 (+3,208) — Google processed a batch of URLs
- Aug 29 onwards: stable at 4,402 indexed / 1,732 not indexed
- Average daily impressions: **~3,213**
- Peak: **5,461** (Aug 31 — Saturday, unusual)
- No clear upward trend in impressions yet — baseline is ~3,200/day

## What's Missing (need from GSC)

| Data | Status | Needed for |
|---|---|---|
| Indexing → Pages | ✅ Received | Indexation baseline |
| Performance → Search results | ❌ Missing | Queries, clicks, CTR, position, top pages |
| Sitemaps status | ❌ Missing | Sitemap processing status |
| URL Inspection (sample) | ❌ Missing | Per-URL index status |

## Post-Deploy Expectations (Sep 7 → Sep 21)

| Metric | Pre-deploy | Expected +7 days | Expected +14 days | Expected +30 days |
|---|---|---|---|---|
| Indexed | 4,402 | 4,400-4,500 (redirect processing) | 4,500-5,500 (new URLs discovered) | 5,500-10,000 (NACE hubs indexed) |
| Not indexed | 1,732 | 1,700-1,800 | 1,600-1,900 | 1,500-2,500 |
| Redirect pages | 481 | 400-481 (processing 308s) | 200-400 | 50-200 |
| Impressions/day | ~3,200 | 3,200-3,500 | 3,500-4,500 | 4,500-8,000 |
| Clicks | 107 (reported) | TBD | TBD | TBD |
| New `/firmy/` indexed | 0 | 0-10 | 10-50 | 50-200 |

**Note:** Google typically takes 2-14 days to discover new sitemap URLs and 3-30 days to index them. The ~278K company pages will take months to fully crawl.
