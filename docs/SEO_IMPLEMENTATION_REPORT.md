# Verifa.sk — SEO Implementation Report

## 1. What was discovered

### Existing architecture (pre-implementation)

- **Hub system**: `/odvetvie/[section]`, `/kraj/[kraj]`, `/okres/[okres]`, `/mesto/[city-slug]` — all ISR, 6 languages, JSON-LD, breadcrumbs, sub-hub links
- **Screener**: `/screener` with 16 FREE + 4 AUTH filters, tier-based access, cached FREE tier
- **Company pages**: `/firma/[ico-slug]` with ISR, quality gate (≥2 FS), slug validation + 308 redirect in middleware
- **Sitemap**: 39 child sitemaps (1 hub + 38 company), hreflang for all entries
- **robots.txt**: allow public content, disallow authenticated pages, AI crawler rules

### Issues found

1. **P0 — `naceSection` COUNT bug**: `naceSection` was missing from `isSelectiveFilter` list in `computeTotalCount()`. When `/screener?naceSection=I` was requested, the count fell back to `pg_class` approximation (~518K) instead of the actual ~15K for section I. The result set was correct (findMany applied the filter), but the displayed count was wrong.

2. **P1 — No clean SEO URLs**: NACE hubs were only accessible at `/odvetvie/{code}` (e.g. `/odvetvie/I`), not at human-readable URLs like `/firmy/ubytovanie-a-stravovanie`.

3. **P1 — Redirect URLs in sitemap**: `/screener/odvetvie/{section}` and `/screener/kraj/{kraj}` (which are 307 redirects) were in the sitemap — Google should not see redirect URLs in sitemaps.

4. **P1 — Screener canonical pointed to redirect URL**: `/screener?naceSection=I` had canonical `https://verifa.sk/screener/odvetvie/I` (a 307 redirect) instead of a clean hub URL.

5. **P1 — `/firmy` page without canonical/robots**: `/firmy` was `force-dynamic` without canonical or robots meta, allowing Google to index query-param permutations.

## 2. What was fixed

### P0: naceSection COUNT bug

- **File**: `src/lib/screener.ts`
- **Change**: Added `"naceSection"` to `isSelectiveFilter` array in `computeTotalCount()`
- **Effect**: `/screener?naceSection=I` now uses real COUNT with index scan instead of pg_class approximation
- **Test**: `testNaceSectionCountSelectivity()` in `screener.test.ts` — verifies all 21 NACE sections produce valid `naceCode` range WHERE for COUNT

### P1: Clean SEO URL architecture

- **New file**: `src/lib/seo-url.ts` — NACE/kraj slug mapping, indexability policy, legacy redirect resolution
- **New route**: `src/app/(main)/firmy/[nace-slug]/page.tsx` — 21 NACE hubs at `/firmy/{nace-slug}`
- **New route**: `src/app/(main)/firmy/[nace-slug]/[sub-slug]/page.tsx` — 168 NACE×region + on-demand NACE×city
- **Updated**: `src/lib/hub.ts` — `HubParams.canonicalPath` override for clean URL canonical/breadcrumbs/JSON-LD
- **Updated**: `src/components/hub-page.tsx` — breadcrumbs and hreflang use `canonicalPath` when set

### P1: Legacy URL migration (308 redirect)

- **Updated**: `src/app/(main)/odvetvie/[section]/page.tsx` — 308 redirect to `/firmy/{nace-slug}`
- **Updated**: `src/app/(main)/odvetvie/[section]/[kraj]/page.tsx` — 308 redirect to `/firmy/{nace-slug}/{region-slug}`
- **Rationale**: `/odvetvie/` URLs had real SEO value (in sitemap, canonical, 9 internal link locations, indexable). 308 permanent redirect preserves link equity.

### P1: Screener canonical/robots fix

- **Updated**: `src/app/(main)/screener/page.tsx`
- `/screener?naceSection=I` canonical → `/firmy/{nace-slug}` (was `/screener/odvetvie/I` — a redirect)
- `/screener?kraj=SK010` canonical → `/kraj/{kraj}` (was `/screener/kraj/{kraj}` — a redirect)

### P1: `/firmy` canonical/robots

- **Updated**: `src/app/(main)/firmy/page.tsx`
- `/firmy` (no params) → `index, follow`, canonical = self
- `/firmy?odvetvie=I` → `noindex, follow`, canonical = `/firmy/{nace-slug}`
- `/firmy?...` (other filters) → `noindex, follow`, canonical = self

### P1: Sitemap cleanup

- **Updated**: `src/app/sitemap/[id]/route.ts`
- Removed `/screener/odvetvie/{section}` (redirect URL — should not be in sitemap)
- Removed `/screener/kraj/{kraj}` (redirect URL — should not be in sitemap)
- Added `/screener` (single entry)
- **Updated**: `src/lib/hub.ts` `getAllHubPaths()` — now generates `/firmy/{nace-slug}` and `/firmy/{nace-slug}/{region-slug}` instead of `/odvetvie/{section}` and `/odvetvie/{section}/{kraj}`

### P1: Internal linking update

All internal links updated from `/odvetvie/{section}` to `/firmy/{nace-slug}`:
- `src/app/(main)/firmy/page.tsx` — NACE hub links
- `src/components/related-firms.tsx` — hub backlinks on company pages
- `src/components/company-header.tsx` — NACE code link
- `src/components/landing/ScreenerCtaSection.tsx` — homepage hub links
- `src/lib/hub.ts` — sub-hub links (NACE → region breakdown)

## 3. Existing URL patterns

| Pattern | Status | Count |
|---|---|---|
| `/firmy/{nace-slug}` | NEW (canonical) | 21 |
| `/firmy/{nace-slug}/{region-slug}` | NEW (canonical) | 168 |
| `/firmy/{nace-slug}/{city-slug}` | NEW (on-demand) | ~3,961 cities × 21 NACE (filtered by count) |
| `/odvetvie/{section}` | LEGACY (308 redirect) | 21 |
| `/odvetvie/{section}/{kraj}` | LEGACY (308 redirect) | 168 |
| `/kraj/{kraj}` | EXISTING (canonical) | 8 |
| `/okres/{okres}` | EXISTING (canonical) | 79 |
| `/mesto/{city-slug}` | EXISTING (canonical) | ~3,961 (filtered by ≥20 firms) |
| `/firma/{ico}-{slug}` | EXISTING (canonical) | ~350K (≥2 FS) |
| `/screener` | EXISTING (canonical) | 1 |
| `/slovnik/{slug}` | EXISTING (canonical) | 10 |

## 4. Maximum number of SEO URLs

| Category | Max URLs (SK only) | With 6 languages |
|---|---|---|
| Static pages | 10 | 60 |
| NACE hubs | 21 | 126 |
| NACE × region hubs | 168 | 1,008 |
| NACE × city hubs | ~83,181 (3,961 × 21) | ~498,786 |
| Region hubs | 8 | 48 |
| District hubs | 79 | 474 |
| City hubs | ~3,961 | ~23,766 |
| Company pages | ~350,000 | ~2,100,000 |
| Glossary | 10 | 60 |
| Screener | 1 | 6 |
| **Total (theoretical max)** | ~437,438 | ~2,624,628 |

**Note**: NACE × city is on-demand (not pre-rendered). Only cities with ≥20 firms are in sitemap. Most NACE × city combinations will have <10 firms and get `noindex`.

## 5. Number of indexable URLs (estimated)

| Category | Indexable (SK) | Rationale |
|---|---|---|
| Static pages | 10 | always indexable |
| NACE hubs | 21 | all have >10 firms |
| NACE × region | ~100-150 | only those with ≥10 firms |
| NACE × city | ~500-2000 | only those with ≥10 firms (on-demand) |
| Region hubs | 8 | all have >10 firms |
| District hubs | ~70 | only those with ≥10 firms |
| City hubs | ~200-500 | only those with ≥20 firms (sitemap) + ≥10 (index) |
| Company pages | ~350,000 | only those with ≥2 FS |
| Glossary | 10 | always indexable |
| Screener | 1 | no query params |
| **Total indexable (SK)** | ~350,800-352,800 | |

With 6 languages: ~2.1M-2.2M indexable URLs (most are company pages).

## 6. Intentionally noindex URLs

| Category | Count | Reason |
|---|---|---|
| Screener query-param permutations | infinite | crawl-trap prevention |
| Firmy query-param permutations | infinite | crawl-trap prevention |
| Thin hubs (<10 firms) | variable | thin content |
| Company pages (<2 FS) | ~170,000 | no financial data |
| Legacy redirect routes | 189 | redirect, not content |
| API endpoints | ~20 | not content |
| Authenticated pages | ~10 | not public |

## 7. Sitemap status

- **Sitemap index**: `/sitemap.xml` → 39 child sitemaps
- **Sitemap 0**: static + screener + hub pages + glossary (with hreflang ×6)
  - Now includes `/firmy/{nace-slug}` (21 ×6 = 126 entries)
  - Now includes `/firmy/{nace-slug}/{region-slug}` (168 ×6 = 1,008 entries)
  - Removed `/screener/odvetvie/{section}` and `/screener/kraj/{kraj}` (redirect URLs)
  - Added `/screener` (1 ×6 = 6 entries)
- **Sitemap 1-38**: company pages (8000 each, ≥2 FS filter, with hreflang ×6)
- **NACE × city**: NOT in sitemap (on-demand, would need count-based filtering — P2)
- **Cache**: `s-maxage=3600`

## 8. Canonical status

| Route | Canonical | Status |
|---|---|---|
| `/firmy/{nace-slug}` | self | ✅ |
| `/firmy/{nace-slug}/{region-slug}` | self | ✅ |
| `/firmy/{nace-slug}/{city-slug}` | self | ✅ |
| `/firma/{ico}-{slug}` | self | ✅ |
| `/kraj/{kraj}` | self | ✅ |
| `/okres/{okres}` | self | ✅ |
| `/mesto/{city-slug}` | self | ✅ |
| `/screener` (no params) | self | ✅ |
| `/screener?naceSection=I` | `/firmy/{nace-slug}` | ✅ (was redirect URL — fixed) |
| `/screener?kraj=SK010` | `/kraj/{kraj}` | ✅ (was redirect URL — fixed) |
| `/screener?q=...` | self, noindex | ✅ |
| `/screener?...` (other) | self, noindex | ✅ |
| `/firmy` (no params) | self | ✅ (was missing — added) |
| `/firmy?odvetvie=I` | `/firmy/{nace-slug}`, noindex | ✅ (was missing — added) |
| `/firmy?...` (other) | self, noindex | ✅ (was missing — added) |
| `/odvetvie/{section}` | 308 → `/firmy/{nace-slug}` | ✅ |
| `/odvetvie/{section}/{kraj}` | 308 → `/firmy/{nace-slug}/{region-slug}` | ✅ |

## 9. Internal-linking status

| Link source → target | Status |
|---|---|
| Homepage → NACE hubs | ✅ (ScreenerCtaSection, clean URL) |
| `/firmy` → NACE hubs | ✅ (clean URL) |
| `/firmy` → region hubs | ✅ |
| NACE hub → region sub-hubs | ✅ (clean URL when canonicalPath set) |
| NACE × region hub → district sub-hubs | ✅ |
| Region hub → district sub-hubs | ✅ |
| District hub → city sub-hubs | ✅ |
| Company page → NACE hub | ✅ (RelatedFirms, clean URL) |
| Company page → NACE × region hub | ✅ (RelatedFirms, clean URL) |
| Company header → NACE hub | ✅ (clean URL) |
| Breadcrumbs on all hub pages | ✅ |

## 10. Performance risks

| Risk | Mitigation |
|---|---|
| NACE × city on-demand rendering | `dynamicParams = true` + `revalidate = 3600` — rendered once, cached 1h |
| City slug resolution (DB query) | `CitySlugCache` table for O(1) lookup, fallback to unaccent() scan |
| Hub count query for thin detection | `getHubCompanyCount()` uses `fsCount` index (O(1)) |
| Screener COUNT on 518K rows | `buildWhereClauseForCount` omits `ico NOT IN` for Index Only Scan |
| NACE filter COUNT | Fixed — now uses real COUNT with `naceCode` index (was pg_class fallback) |
| Sitemap generation | `revalidate = 3600`, cached at CDN |
| Company page slug validation | Middleware 308 redirect, bypasses Sentry |

## 11. Test results

### Unit tests

```
npm run test:unit → 722 tests, 0 failures
npx tsx src/lib/__tests__/screener.test.ts → ALL TESTS PASSED (P0-H: naceSection COUNT selectivity)
npx tsx src/lib/__tests__/seo-url.test.ts → ALL TESTS PASSED (6 test suites)
```

### Typecheck

```
npx tsc --noEmit → 0 errors
```

### Build

```
npm run build → SUCCESS
  /firmy/[nace-slug] → 21 SSG paths
  /firmy/[nace-slug]/[sub-slug] → 168 SSG paths
  /odvetvie/[section] → 21 SSG paths (308 redirect)
  /odvetvie/[section]/[kraj] → 168 SSG paths (308 redirect)
```

## 12. Remaining issues

| # | Issue | Priority | Status |
|---|---|---|---|
| 1 | Business intent pages (`/firmy/{nace-slug}/najvacsie`, etc.) | P2 | Not implemented — deferred per user request |
| 2 | NACE × city pages not in sitemap | P2 | Need count-based filtering to avoid thin pages in sitemap |
| 3 | National intent pages (`/firmy/najvacsie-firmy-slovensko`) | P2 | Not implemented — deferred |
| 4 | ESLint config missing | P3 | Pre-existing — `npm run lint` prompts for setup |
| 5 | Localized `/odvetvie/` routes (en/de/cs/hu/pl) | P3 | Only SK `/odvetvie/` redirects; localized versions don't exist as separate routes (hub pages use `(main)` group with header-based language) |
| 6 | `/screener/odvetvie/{section}` and `/screener/kraj/{kraj}` routes still exist as 307 redirects | P3 | Not in sitemap, not linked — but still routable. Could be removed in future cleanup. |

## Example URLs and expected behavior

| URL | HTTP | Canonical | Robots | Firms |
|---|---|---|---|---|
| `/firmy/ubytovanie-a-stravovanie` | 200 | self | index, follow | ~15K |
| `/firmy/ubytovanie-a-stravovanie/bratislavsky-kraj` | 200 | self | index, follow | ~2K |
| `/firmy/ubytovanie-a-stravovanie/bratislava` | 200 | self | index, follow (if ≥10) | ~500 |
| `/firmy/stavebnictvo` | 200 | self | index, follow | ~50K |
| `/firmy/informacie-a-komunikacia` | 200 | self | index, follow | ~20K |
| `/odvetvie/I` | 308 | — | — | redirects to `/firmy/ubytovanie-a-stravovanie` |
| `/odvetvie/I/SK010` | 308 | — | — | redirects to `/firmy/ubytovanie-a-stravovanie/bratislavsky-kraj` |
| `/screener?naceSection=I` | 200 | `/firmy/ubytovanie-a-stravovanie` | noindex, follow | ~15K (correct count) |
| `/screener` | 200 | self | index, follow | ~518K |
| `/firmy` | 200 | self | index, follow | ~518K |
| `/firmy?odvetvie=I` | 200 | `/firmy/ubytovanie-a-stravovanie` | noindex, follow | ~15K |
| `/firma/36199222-us-steel-kosice-sro` | 200 | self | index, follow (if ≥2 FS) | — |
