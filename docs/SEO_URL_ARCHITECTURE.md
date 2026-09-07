# Verifa.sk — SEO URL Architecture

## Overview

Verifa.sk uses a clean, human-readable URL architecture for SEO landing pages.
All indexable pages are server-rendered (SSG/ISR) with unique metadata, canonical URLs,
JSON-LD structured data, and breadcrumbs.

## URL Pattern Reference

| URL pattern | Purpose | Indexable | Canonical | Sitemap | Example |
|---|---|---|---|---|---|
| `/firmy/{nace-slug}` | NACE section hub | YES (if ≥10 firms) | self | YES | `/firmy/ubytovanie-a-stravovanie` |
| `/firmy/{nace-slug}/{region-slug}` | NACE × region hub | YES (if ≥10 firms) | self | YES | `/firmy/ubytovanie-a-stravovanie/bratislavsky-kraj` |
| `/firmy/{nace-slug}/{city-slug}` | NACE × city hub | YES (if ≥10 firms) | self | YES (if ≥20 firms) | `/firmy/ubytovanie-a-stravovanie/bratislava` |
| `/firmy/{nace-slug}/{intent}` | Business intent (P2) | YES (whitelist) | self | YES (whitelist) | `/firmy/ubytovanie-a-stravovanie/najvacsie` |
| `/firmy` | All companies (filter UI) | YES (no query params) | self | YES | `/firmy` |
| `/firmy?...` | Filtered company list | NO | self | NO | `/firmy?odvetvie=I` |
| `/firma/{ico}-{slug}` | Company page | YES (if ≥2 FS) | self | YES (if ≥2 FS) | `/firma/36199222-us-steel-kosice-sro` |
| `/kraj/{kraj}` | Region hub | YES (if ≥10 firms) | self | YES | `/kraj/SK010` |
| `/okres/{okres}` | District hub | YES (if ≥10 firms) | self | YES | `/okres/SK0101` |
| `/mesto/{city-slug}` | City hub | YES (if ≥10 firms) | self | YES (if ≥20 firms) | `/mesto/bratislava` |
| `/screener` | Screener UI (no filters) | YES | self | YES | `/screener` |
| `/screener?naceSection=I` | Screener with NACE filter | NO | `/firmy/{nace-slug}` | NO | — |
| `/screener?kraj=SK010` | Screener with region filter | NO | `/kraj/{kraj}` | NO | — |
| `/screener?q=...` | Screener free-text search | NO | self | NO | — |
| `/screener?...` (other filters) | Screener with filters | NO | self | NO | — |
| `/screener/odvetvie/{section}` | Legacy redirect | NO | — | NO | 307 → `/screener?naceSection=` |
| `/screener/kraj/{kraj}` | Legacy redirect | NO | — | NO | 307 → `/screener?kraj=` |
| `/odvetvie/{section}` | Legacy redirect | NO | — | NO | 308 → `/firmy/{nace-slug}` |
| `/odvetvie/{section}/{kraj}` | Legacy redirect | NO | — | NO | 308 → `/firmy/{nace-slug}/{region-slug}` |
| `/slovnik/{slug}` | Glossary term | YES | self | YES | `/slovnik/altman-z-score` |
| `/` | Homepage | YES | self | YES | `/` |
| `/pricing` | Pricing page | YES | self | YES | `/pricing` |
| `/api/...` | API endpoints | NO | — | NO | — |
| `/admin/...`, `/dashboard/...` | Authenticated pages | NO | — | NO | — |

## NACE Section Slugs

| Section | Slug | Label (SK) |
|---|---|---|
| A | `polnohospodarstvo-a-lesnictvo` | Poľnohospodárstvo, lesníctvo a rybárstvo |
| B | `tazba-a-dobyanie` | Ťažba a dobývanie |
| C | `priemyselna-vyroba` | Priemyselná výroba |
| D | `energetika` | Výroba a rozvod elektriny, plynu a vody |
| E | `vodne-hospodarstvo` | Zásobovanie vodou a odvod odpadových vôd |
| F | `stavebnictvo` | Stavebníctvo |
| G | `obchod` | Veľkoobchod a maloobchod |
| H | `doprava-a-skladovanie` | Doprava a skladovanie |
| I | `ubytovanie-a-stravovanie` | Ubytovanie a stravovanie |
| J | `informacie-a-komunikacia` | Informačné a komunikačné technológie |
| K | `financie-a-poisovnictvo` | Finančné a poisťovacie činnosti |
| L | `nehnutelnosti` | Činnosti súvisiace s nehnuteľnosťami |
| M | `profesionalne-sluzby` | Profesionálne, vedecké a technické činnosti |
| N | `administrativne-sluzby` | Administratívne a podporné služby |
| O | `verejna-sprava` | Verejná správa a obrana |
| P | `vzdelavanie` | Vzdelávanie |
| Q | `zdravotnictvo` | Zdravotníctvo a sociálna pomoc |
| R | `kultura-a-zabava` | Kultúra, umenie a zábava |
| S | `ostatne-sluzby` | Ostatné činnosti služieb |
| T | `domacnosti` | Činnosti domácností ako zamestnávateľov |
| U | `extrateritorialne-cinnosti` | Činnosti extrateritoriálnych organizácií |

## Region (Kraj) Slugs

| Code | Slug | Label |
|---|---|---|
| SK010 | `bratislavsky-kraj` | Bratislavský kraj |
| SK021 | `trnavsky-kraj` | Trnavský kraj |
| SK022 | `nitriansky-kraj` | Nitriansky kraj |
| SK023 | `trenciansky-kraj` | Trenčiansky kraj |
| SK031 | `zilinsky-kraj` | Žilinský kraj |
| SK032 | `banskobystricky-kraj` | Banskobystrický kraj |
| SK041 | `presovsky-kraj` | Prešovský kraj |
| SK042 | `kosicky-kraj` | Košický kraj |

## Indexability Rules

### Indexable (index, follow)

1. **NACE hubs** (`/firmy/{nace-slug}`) — if ≥10 companies with ≥2 financial statements
2. **NACE × region hubs** (`/firmy/{nace-slug}/{region-slug}`) — if ≥10 companies
3. **NACE × city hubs** (`/firmy/{nace-slug}/{city-slug}`) — if ≥10 companies
4. **Region hubs** (`/kraj/{kraj}`) — if ≥10 companies
5. **District hubs** (`/okres/{okres}`) — if ≥10 companies
6. **City hubs** (`/mesto/{city-slug}`) — if ≥10 companies
7. **Company pages** (`/firma/{ico}-{slug}`) — if ≥2 financial statements
8. **Glossary pages** (`/slovnik/{slug}`) — always
9. **Static pages** (`/`, `/pricing`, `/register`, etc.) — always
10. **Screener** (`/screener` without query params) — always
11. **Firmy** (`/firmy` without query params) — always

### Non-indexable (noindex, follow)

1. **Screener with query params** (`/screener?...`) — except single `naceSection` or `kraj` filter (canonical to hub)
2. **Firmy with query params** (`/firmy?...`) — except single `odvetvie` filter (canonical to NACE hub)
3. **Thin hubs** (<10 companies) — noindex to avoid thin content
4. **Company pages without financial data** (<2 FS) — noindex, follow
5. **Legacy redirect routes** (`/odvetvie/...`, `/screener/odvetvie/...`, `/screener/kraj/...`)
6. **API endpoints** (`/api/...`)
7. **Authenticated pages** (`/admin/...`, `/dashboard/...`, `/login`, etc.)

### Non-indexable (noindex, nofollow)

1. **404 pages** — company not found, invalid NACE section, invalid city slug

## Canonical Policy

- **NACE hubs**: canonical = self (`/firmy/{nace-slug}`)
- **NACE × region**: canonical = self (`/firmy/{nace-slug}/{region-slug}`)
- **NACE × city**: canonical = self (`/firmy/{nace-slug}/{city-slug}`)
- **Company pages**: canonical = self (`/firma/{ico}-{slug}`)
- **Region/district/city hubs**: canonical = self
- **Screener (no filters)**: canonical = `/screener`
- **Screener (naceSection only)**: canonical = `/firmy/{nace-slug}`
- **Screener (kraj only)**: canonical = `/kraj/{kraj}`
- **Screener (other filters)**: canonical = self, but noindex
- **Firmy (no filters)**: canonical = `/firmy`
- **Firmy (odvetvie only)**: canonical = `/firmy/{nace-slug}`, noindex
- **Firmy (other filters)**: canonical = self, but noindex

## Legacy URL Migration

### `/odvetvie/{section}` → `/firmy/{nace-slug}`

- **Method**: 308 permanent redirect (preserves link equity)
- **Implementation**: `permanentRedirect()` in `odvetvie/[section]/page.tsx`
- **Sitemap**: `/odvetvie/{section}` removed, `/firmy/{nace-slug}` added
- **Internal links**: all updated to `/firmy/{nace-slug}`

### `/odvetvie/{section}/{kraj}` → `/firmy/{nace-slug}/{region-slug}`

- **Method**: 308 permanent redirect
- **Implementation**: `permanentRedirect()` in `odvetvie/[section]/[kraj]/page.tsx`
- **Sitemap**: removed, replaced with clean URL

### `/screener/odvetvie/{section}` and `/screener/kraj/{kraj}`

- **Status**: These are 307 redirect routes to `/screener?naceSection=` / `/screener?kraj=`
- **Sitemap**: Removed (redirect URLs must not be in sitemap)
- **Canonical**: Screener metadata now canonicalizes to `/firmy/{nace-slug}` or `/kraj/{kraj}`

## Sitemap Structure

```
/sitemap.xml          → sitemap index (39 child sitemaps)
/sitemap/0.xml        → static + screener + hub pages + glossary (with hreflang)
/sitemap/1.xml..38.xml → company pages (8000 each, ≥2 FS filter)
```

Sitemap 0 contains:
- Static pages (×6 languages with hreflang)
- `/screener` (single entry)
- `/firmy/{nace-slug}` (21 entries ×6 languages)
- `/firmy/{nace-slug}/{region-slug}` (168 entries ×6 languages)
- `/kraj/{kraj}` (8 entries ×6 languages)
- `/okres/{okres}` (79 entries ×6 languages)
- `/mesto/{city-slug}` (cities with ≥20 firms ×6 languages)
- `/slovnik/{slug}` (glossary ×6 languages)

## Internal Linking

- **Homepage** → NACE hubs (via ScreenerCtaSection)
- **`/firmy`** → all NACE hubs + all region hubs
- **NACE hub** → region sub-hubs (if >500 firms)
- **NACE × region hub** → district sub-hubs (if >500 firms)
- **Region hub** → district sub-hubs
- **District hub** → city sub-hubs
- **Company page** → NACE hub + NACE × region hub (via RelatedFirms)
- **Company header** → NACE hub (link on NACE code)
- **Breadcrumbs** on all hub pages

## Performance

- **ISR**: `revalidate = 3600` (1 hour) for all hub pages and company pages
- **SSG**: `generateStaticParams()` pre-renders 21 NACE + 168 NACE×region pages at build
- **On-demand**: NACE × city pages rendered on demand (`dynamicParams = true`)
- **Pagination**: capped at 10 pages (500 companies max per hub)
- **Quality gate**: `fsCount >= 2` (≥2 financial statements) for hub inclusion
- **Index usage**: `naceCode` index for NACE filter, `kraj` index for region filter
- **Count optimization**: `buildWhereClauseForCount` omits `ico NOT IN` for Index Only Scan

## Source Files

| File | Purpose |
|---|---|
| `src/lib/seo-url.ts` | NACE/kraj slug mapping, indexability policy, legacy redirect resolution |
| `src/lib/hub.ts` | Hub query logic, metadata, JSON-LD, sub-hub links |
| `src/lib/screener.ts` | Screener filter architecture, NACE section mapping |
| `src/components/hub-page.tsx` | Shared hub page renderer (renderHubPage, generateHubMetadata) |
| `src/app/(main)/firmy/[nace-slug]/page.tsx` | NACE hub route |
| `src/app/(main)/firmy/[nace-slug]/[sub-slug]/page.tsx` | NACE × region/city route |
| `src/app/(main)/odvetvie/[section]/page.tsx` | Legacy 308 redirect → `/firmy/{nace-slug}` |
| `src/app/(main)/odvetvie/[section]/[kraj]/page.tsx` | Legacy 308 redirect → `/firmy/{nace-slug}/{region-slug}` |
| `src/app/sitemap/[id]/route.ts` | Sitemap generation |
| `src/app/robots.ts` | robots.txt |
