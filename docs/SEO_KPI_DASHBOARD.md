# Verifa.sk — SEO KPI Dashboard Template

**Purpose:** Track SEO performance after the clean URL architecture deploy (2026-09-07).
**Cadence:** Weekly for first 4 weeks, then monthly.
**Data sources:** Google Search Console, Google Analytics 4, Verifa DB.

## 1. Google Search Console Metrics

### 1.1 Overall (site-wide)

| Metric | Baseline (Sep 4) | +7 days | +14 days | +30 days |
|---|---|---|---|---|
| Total impressions/day | ~3,213 avg | | | |
| Total clicks (period) | 107 (reported) | | | |
| Average CTR | TBD | | | |
| Average position | TBD | | | |
| Indexed pages | 4,402 | | | |
| Submitted URLs (sitemap) | ~278,000 | | | |
| Not indexed (excluded) | 1,732 | | | |
| Google discovery rate | 2.2% (6,134/278K) | | | |

### 1.2 By URL family

| URL family | Impressions | Clicks | CTR | Avg position | Indexed |
|---|---|---|---|---|---|
| `/firmy/{nace-slug}` (21 pages) | | | | | |
| `/firmy/{nace-slug}/{region-slug}` (168 pages) | | | | | |
| `/firmy/{nace-slug}/{city-slug}` (on-demand) | | | | | |
| `/firma/{ico}-{slug}` (~277K pages) | | | | | |
| `/kraj/{kraj}` (8 pages) | | | | | |
| `/okres/{okres}` (79 pages) | | | | | |
| `/mesto/{city-slug}` (1,098 pages) | | | | | |
| `/slovnik/{slug}` (10 pages) | | | | | |
| `/screener` (1 page) | | | | | |
| `/firmy` (1 page) | | | | | |
| Static pages (6 pages) | | | | | |

### 1.3 Top queries (new URL families)

| Query | Impressions | Clicks | CTR | Position | Landing page |
|---|---|---|---|---|---|
| | | | | | |
| | | | | | |
| | | | | | |

### 1.4 Redirect monitoring

| Legacy URL | Impressions | Clicks | Status |
|---|---|---|---|
| `/odvetvie/I` | | | Should drop to 0 as Google processes 308 |
| `/odvetvie/F` | | | |
| `/odvetvie/G` | | | |
| `/odvetvie/C` | | | |

## 2. Google Analytics 4 — Traffic & Conversion

### 2.1 Organic traffic

| Metric | Week 1 | Week 2 | Week 3 | Week 4 |
|---|---|---|---|---|
| Organic sessions | | | | |
| Organic users | | | | |
| New users (organic) | | | | |
| Bounce rate (organic) | | | | |
| Avg session duration | | | | |

### 2.2 Traffic by URL family

| URL family | Sessions | Users | Bounce rate | Avg duration |
|---|---|---|---|---|
| `/firmy/...` | | | | |
| `/firma/...` | | | | |
| `/kraj/...` | | | | |
| `/mesto/...` | | | | |
| `/slovnik/...` | | | | |
| `/screener` | | | | |

### 2.3 Conversion funnel (organic traffic)

| Step | Week 1 | Week 2 | Week 3 | Week 4 |
|---|---|---|---|---|
| Organic session | | | | |
| Registration | | | | |
| Free report generated | | | | |
| Paid report generated | | | | |
| Organic → paid conversion rate | | | | |
| CAC (organic, estimated) | | | | |

## 3. Sitemap Health

| Metric | Week 1 | Week 2 | Week 3 | Week 4 |
|---|---|---|---|---|
| Sitemap index accessible | ✅ | | | |
| Child sitemaps accessible (39) | ✅ | | | |
| Total submitted URLs | ~278K | | | |
| URLs returning 200 | | | | |
| URLs returning 308 (redirect) | 189 (legacy) | | | |
| URLs returning 404 | | | | |
| Sitemap lastmod updated | 2026-09-07 | | | |

## 4. Technical SEO Health

| Metric | Week 1 | Week 2 | Week 3 | Week 4 |
|---|---|---|---|---|
| Canonical consistency | ✅ | | | |
| Hreflang consistency | ✅ | | | |
| robots.txt accessible | ✅ | | | |
| No redirect URLs in sitemap | ✅ | | | |
| No duplicate canonicals | ✅ | | | |
| Invalid slugs → noindex | ✅ | | | |
| Thin hubs → noindex | ✅ | | | |
| Core Web Vitals (LCP) | TBD | | | |
| Core Web Vitals (CLS) | TBD | | | |
| Core Web Vitals (INP) | TBD | | | |

## 5. GSC URL Inspection — Sample

Inspect these URLs in Google Search Console weekly:

| URL | Index status | Coverage | Last crawled | Canonical |
|---|---|---|---|---|
| `https://verifa.sk/firmy/ubytovanie-a-stravovanie` | | | | |
| `https://verifa.sk/firmy/stavebnictvo` | | | | |
| `https://verifa.sk/firmy/obchod` | | | | |
| `https://verifa.sk/firmy/ubytovanie-a-stravovanie/bratislavsky-kraj` | | | | |
| `https://verifa.sk/firmy/ubytovanie-a-stravovanie/bratislava` | | | | |
| `https://verifa.sk/odvetvie/I` (legacy) | | | | Should show redirect |
| `https://verifa.sk/screener` | | | | |
| `https://verifa.sk/firma/35876832-kia-slovakia-s-r-o` | | | | |

## 6. Action Triggers

| Signal | Threshold | Action |
|---|---|---|
| Indexed pages < 50% of submitted after 2 weeks | <140K | Check GSC coverage report for errors |
| `/odvetvie/` URLs still indexed after 4 weeks | >0 | Submit removal request in GSC |
| Impressions for `/firmy/` URLs = 0 after 2 weeks | 0 | Check if sitemap was fetched |
| CTR < 1% for NACE hub pages | <1% | Optimize title/meta description |
| Average position > 50 for NACE hubs | >50 | Check content quality, internal links |
| Organic registrations = 0 after 2 weeks | 0 | Check conversion funnel, CTA placement |

## 7. GSC Setup Checklist

- [ ] Verify `verifa.sk` in Google Search Console (if not already)
- [ ] Submit sitemap: `https://verifa.sk/sitemap.xml`
- [ ] Check Coverage report for new URL families
- [ ] Check Sitemaps report for processing status
- [ ] Set up URL inspection for sample URLs (section 5)
- [ ] Connect GA4 to GSC for linked data
- [ ] Enable GSC API for automated monitoring (`scripts/gsc-monitor.mjs`)
- [ ] Set up `GSC_SERVICE_ACCOUNT_FILE` env var for `gsc-monitor.mjs`

## 8. Automated Monitoring

```bash
# GSC monitoring (requires GSC_SERVICE_ACCOUNT_FILE)
node scripts/gsc-monitor.mjs

# Hub SEO validator (246 URLs × 6 langs)
node scripts/validate-hub-seo.mjs

# SEO regression tests (171 checks)
node scripts/seo-regression-tests.mjs
```
