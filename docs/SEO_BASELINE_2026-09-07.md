# Verifa.sk — SEO Baseline (2026-09-07)

**Deploy SHA:** `f230571`
**Date:** 2026-09-07
**Purpose:** Document the SEO baseline before Google indexes the new clean URL architecture. This is the reference point for measuring SEO performance over the next 1-2 weeks.

## Sitemap Structure

| Sitemap | Content | Unique SK URLs | With hreflang (×6) |
|---|---|---|---|
| `/sitemap/0.xml` | Hub pages + static + glossary | 1,398 | 8,363 |
| `/sitemap/1.xml` – `/sitemap/38.xml` | Company pages (≥2 FS) | ~277,000 | ~1,662,000 |
| **Total** | | **~278,398** | **~1,670,363** |

## Sitemap 0 — Breakdown

| Category | Unique SK URLs | With hreflang |
|---|---|---|
| NACE hubs (`/firmy/{nace-slug}`) | 21 | 126 |
| NACE × region (`/firmy/{nace-slug}/{region-slug}`) | 168 | 1,008 |
| Region hubs (`/kraj/{kraj}`) | 8 | 48 |
| District hubs (`/okres/{okres}`) | 79 | 474 |
| City hubs (`/mesto/{city-slug}`) | 1,098 | 6,588 |
| Glossary (`/slovnik/{slug}`) | 10 | 60 |
| Screener (`/screener`) | 1 | 6 |
| Static pages (`/`, `/pricing`, etc.) | 6 | 36 |
| **Total sitemap 0** | **1,391** | **8,346** |

## Company Pages (Sitemap 1-38)

| Metric | Value |
|---|---|
| Total company sitemaps | 38 |
| URLs per sitemap (avg) | ~7,300 |
| Last sitemap (38) | 3,552 (partial) |
| **Total unique company URLs** | **~277,000** |
| Quality gate | `fsCount >= 2` (≥2 financial statements) |
| With hreflang (×6) | ~1,662,000 |

## Indexability Rules

### Indexable (`index, follow`)

| URL pattern | Condition | Count (SK) |
|---|---|---|
| `/firmy/{nace-slug}` | ≥10 firms | 21 |
| `/firmy/{nace-slug}/{region-slug}` | ≥10 firms | ~150 (est.) |
| `/firmy/{nace-slug}/{city-slug}` | ≥10 firms (on-demand) | ~500-2000 (est.) |
| `/kraj/{kraj}` | ≥10 firms | 8 |
| `/okres/{okres}` | ≥10 firms | ~70 (est.) |
| `/mesto/{city-slug}` | ≥20 firms (sitemap), ≥10 (index) | ~1,098 |
| `/firma/{ico}-{slug}` | ≥2 FS | ~277,000 |
| `/slovnik/{slug}` | always | 10 |
| `/screener` (no params) | always | 1 |
| `/firmy` (no params) | always | 1 |
| Static pages | always | 6 |
| **Total indexable (SK, est.)** | | **~278,800** |

### Non-indexable (`noindex, follow`)

| URL pattern | Reason |
|---|---|
| `/screener?naceSection=I` | Canonical to `/firmy/{nace-slug}` |
| `/screener?kraj=SK010` | Canonical to `/kraj/{kraj}` |
| `/screener?q=...` | Infinite URL space (search) |
| `/screener?...` (other filters) | Not curated, thin/duplicate |
| `/firmy?odvetvie=I` | Canonical to `/firmy/{nace-slug}` |
| `/firmy?...` (other filters) | Not curated |
| Thin hubs (<10 firms) | Thin content |

### Non-indexable (`noindex, nofollow`)

| URL pattern | Reason |
|---|---|
| Invalid NACE slug | 404 |
| Invalid city/region slug | 404 |
| `/firmy/{nace-slug}/najvacsie` | Intent not implemented (P2) |

### Redirects (308)

| URL pattern | Target |
|---|---|
| `/odvetvie/{section}` | `/firmy/{nace-slug}` |
| `/odvetvie/{section}/{kraj}` | `/firmy/{nace-slug}/{region-slug}` |

## Canonical Policy

| Route | Canonical |
|---|---|
| `/firmy/{nace-slug}` | self |
| `/firmy/{nace-slug}/{region-slug}` | self |
| `/firmy/{nace-slug}/{city-slug}` | self |
| `/firma/{ico}-{slug}` | self |
| `/kraj/{kraj}` | self |
| `/okres/{okres}` | self |
| `/mesto/{city-slug}` | self |
| `/screener` (no params) | self |
| `/screener?naceSection=I` | `/firmy/{nace-slug}` |
| `/screener?kraj=SK010` | `/kraj/{kraj}` |
| `/firmy` (no params) | self |
| `/firmy?odvetvie=I` | `/firmy/{nace-slug}` |

## Hreflang

- **Languages:** sk, en, de, cs, hu, pl (6)
- **x-default:** sk (canonical SK URL)
- **All localized URL return 200** (middleware rewrite, not separate routes)
- **Sitemap includes hreflang alternates** for all entries

## robots.txt

- **Allow:** `/`, `/firma/`, `/firmy`, `/screener`, `/pricing`, `/register`, `/slovnik`, etc.
- **Disallow:** `/api/`, `/admin/`, `/dashboard/`, `/reports/`, `/settings/`, `/login`, etc.
- **AI crawlers:** GPTBot, ChatGPT-User, ClaudeBot, PerplexityBot, Google-Extended, Applebot-Extended — all allowed for public content, disallowed for authenticated pages
- **Sitemap:** `https://verifa.sk/sitemap.xml`

## Not in Scope (P2 — deferred)

| Feature | Status | Gate |
|---|---|---|
| NACE × city in sitemap | Not implemented | Need ≥20 firms quality gate |
| Business intent pages | Not implemented | P2 after indexation measurement |
| `/firmy/{nace-slug}/najvacsie` | Returns 404 + noindex | P2 |
| `/firmy/{nace-slug}/najziskovejsie` | Returns 404 + noindex | P2 |
| `/firmy/{nace-slug}/v-strate` | Returns 404 + noindex | P2 |

## Production Verification (2026-09-07)

| URL | HTTP | Canonical | Robots | H1 | Verified |
|---|---|---|---|---|---|
| `/firmy/ubytovanie-a-stravovanie` | 200 | self | index, follow | Ubytovanie a stravovanie | ✅ |
| `/firmy/ubytovanie-a-stravovanie/bratislavsky-kraj` | 200 | self | index, follow | Ubytovanie a stravovanie — Bratislavský kraj | ✅ |
| `/firmy/ubytovanie-a-stravovanie/bratislava` | 200 | self | index, follow | Ubytovanie a stravovanie | ✅ |
| `/odvetvie/I` | 308 | — | — | — | → `/firmy/ubytovanie-a-stravovanie` ✅ |
| `/odvetvie/I/SK010` | 308 | — | — | — | → `/firmy/.../bratislavsky-kraj` ✅ |
| `/screener` | 200 | self | index, follow | Screener firiem na Slovensku | ✅ |
| `/screener?naceSection=I` | 200 | `/firmy/ubytovanie-a-stravovanie` | index, follow | Firmy — Ubytovanie a stravovanie | ✅ 219 firms |
| `/screener?kraj=SK010` | 200 | `/kraj/SK010` | index, follow | Firmy — Bratislavský kraj | ✅ 982 firms |
| `/firmy/.../najvacsie` | 200 | `verifa.sk/` | noindex, nofollow | Stránka nenájdená | ✅ |
| All 6 localized `/en/firmy/...` | 200 | — | — | — | ✅ |
