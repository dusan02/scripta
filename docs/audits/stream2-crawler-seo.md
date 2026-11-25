# Stream 2 — Crawler & SEO Optimization Audit (P1)

**Date:** 2026-11-25  
**Branch:** `stream/2-crawler-seo-optimization` (branched from `e73d521` / `release/etapa-1`)  
**Log Window Analyzed (read-only on VPS `89.185.250.213`):**
- `/var/log/nginx/verifa_perf.log.1`: `24/Nov/2026:04:00:06 +0100` → `25/Nov/2026:00:00:23 +0100` (`242,951` lines)
- `/var/log/nginx/verifa_perf.log`: `25/Nov/2026:00:00:24 +0100` → `25/Nov/2026:14:09:27 +0100` (`224,508` lines)
- **Combined Window:** `34.155 hours` (`1.4231 days`), `467,459` total requests (**328,479 req/day**), **455,600 s** cumulative upstream response time (**320,146 s/day** = **3.71 continuous concurrency slots saturated 24/7**).

---

## 1. Executive Summary & ISR Disk Bloat Baseline

Direct read-only inspection of `verifa_frontend` (`/app/.next/server/app/`) confirmed:
- `/app/.next/server/app/firma/` currently occupies **13 GB** on disk (root FS `/` is at **75% / 69G of 97G**).
- `/app/.next/server/app/en/firma/` alone occupies **497 MB** (one of 5 non-default locales).
- Each unique ISR `MISS` on `/firma/` or `/{lang}/firma/` writes 3 files: `.html` (~185 KB) + `.rsc` (~85 KB) + `.meta` (~0.25 KB) ≈ **270 KB (~0.27 MB)** per unique page.
- Across 34.155h, crawlers generated **109,738 unique 200 ISR MISSes** (`41,619` `/firma/` + `68,119` `/{lang}/firma/`) = **77,112 unique ISR renders/day** → **~20.8 GB/day** of ISR disk churn (**~12.9 GB/day** from non-sitemap `/{lang}/firma/` alone!).

---

## 2. Log Breakdown by Crawler / User-Agent (34.155h Observed)

| Crawler / UA Group | Requests | Req/Day | `200` | `403` | `5xx` | `HIT` | `MISS` | `STALE` | `?_rsc=` | Sum RT (s) | % Server Time | Avg MISS RT |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| **Browser/Spoofed-Browser** | 207,893 | 146,085 | 116,555 | 82,858 | 510 | 8,983 | 35,333 | 7,375 | 29,644 | 178,087.0 | **39.1%** | 1.95s |
| **YandexBot** | 26,677 | 18,746 | 25,925 | 0 | 752 | 452 | 22,993 | 2,081 | 0 | 102,282.0 | **22.5%** | 3.23s |
| **Baiduspider** | 46,887 | 32,947 | 26,842 | 0 | 369 | 875 | 12,472 | 3,085 | 0 | 51,608.8 | **11.3%** | 1.77s |
| **GPTBot** | 144,949 | 101,854 | 144,767 | 0 | 44 | 18,198 | 13,636 | 12,872 | 63,224 | 48,642.8 | **10.7%** | 0.58s |
| **bingbot** | 19,359 | 13,603 | 18,796 | 0 | 371 | 217 | 16,876 | 1,062 | 0 | 47,673.8 | **10.5%** | 1.61s |
| **Googlebot (PROTECTED)** | 12,986 | 9,125 | 12,293 | 2 | 83 | 1,065 | 6,538 | 3,333 | 6 | 14,242.5 | **3.1%** | 1.40s |
| **Other-Bot** (`ExaSearchBot` 2.86k, `BacklinksExtendedBot` 342) | 3,356 | 2,358 | 3,232 | 16 | 10 | 307 | 1,332 | 1,339 | 3 | 4,049.1 | **0.9%** | 1.35s |
| **Headless/CLI-Scraper** (incl. internal cron) | 282 | 198 | 204 | 47 | 6 | 14 | 4 | 30 | 3 | 3,237.0 | **0.7%** | 3.20s |
| **Applebot** | 729 | 512 | 692 | 0 | 15 | 3 | 496 | 8 | 0 | 2,021.0 | **0.4%** | 2.05s |
| **OAI-SearchBot** | 1,391 | 977 | 1,090 | 0 | 0 | 186 | 184 | 136 | 988 | 1,355.3 | **0.3%** | 1.61s |
| **SemrushBot / AhrefsBot / Amazonbot / PerplexityBot / ClaudeBot / PetalBot / SEO-Blocklist** | 2,201 | 1,547 | 0 | 2,200 | 0 | 0 | 0 | 0 | 0 | 0.0 | **0.0%** | — |

---

## 3. Breakdown by Path Group (34.155h Observed)

| Path Group | Requests | `HIT` | `MISS` | `STALE` | Sum RT (s) | Avg MISS RT | Bandwidth (MB) |
|---|---:|---:|---:|---:|---:|---:|---:|
| **`/{lang}/firma/`** | 135,720 | 1,294 | **68,227** | 2,061 | **205,340.9** | 1.94s | 1,815.6 |
| **`/firma/`** | 134,136 | 22,555 | **41,642** | 29,187 | **170,585.2** | 1.93s | 2,287.5 |
| **`other`** (home, `/slovnik`, `/mesto`, `/login`, etc.) | 36,723 | 2 | 0 | 0 | 29,395.4 | — | 493.9 |
| **`/objednat`** (guest checkout funnel) | **93,990** | 0 | 0 | 0 | 16,286.0 | — | 789.2 |
| **`/firmy`** (hub pages) | 9,328 | 0 | 0 | 0 | 13,919.9 | — | 114.5 |
| **`/api/`** (`32,838` `/api/auth/session`) | 33,207 | 0 | 0 | 0 | 5,978.2 | — | 0.8 |
| **`static/_next`** | 16,745 | 6,150 | 2 | 83 | 5,085.7 | 0.82s | 429.0 |
| **`/sitemap\|robots`** | 580 | 318 | 0 | 0 | 3,326.5 | — | 163.9 |
| **`/{lang}/other`** | 4,929 | 0 | 0 | 0 | 3,299.5 | — | 23.6 |
| **`/screener`** | 2,101 | 0 | 0 | 0 | 734.3 | — | 75.5 |

---

## 4. Findings Ordered by Severity

### P1-1 (CRITICAL): `YandexBot` + `Baiduspider` consume 33.8% of total server time & 6.73 GB/day ISR with zero B2B value
- **`YandexBot`**: `26,677` req (`18,746/day`), `22,993` MISS (`15,931` on `/{lang}/firma/`, `7,061` on `/firma/`), `102,282s` RT (**22.5%** of all server time), `752` `5xx` errors.
- **`Baiduspider`**: `46,887` req (`32,947/day`), `12,472` MISS (`9,170` on `/{lang}/firma/`, `3,300` on `/firma/`), `13,842` hits on `/objednat?ico=`, `51,609s` RT (**11.3%** of server time), `369` `5xx` errors.
- Neither is restricted in `robots.ts` or Nginx (`0` 403s, `0` 429s).

### P1-2 (CRITICAL): `GPTBot` generates 31.0% of all requests (`101.9k/day`), mostly `/objednat` + `?_rsc=` waste
- `74,518` hits on `/objednat?ico=` (**51.4%** of GPTBot volume) — `/objednat` was missing from `robots.ts` `PRIVATE_PATHS`.
- `63,224` hits on `?_rsc=` Next.js prefetch URLs (`/firma/?_rsc=` 36.3k, `other?_rsc=` 18.8k, `/firmy?_rsc=` 4.9k, `/screener?_rsc=` 1.8k).
- `GPTBot` **fully respects** `robots.ts` (`0` `/{lang}/firma/` MISSes after localized paths were disallowed!). Updating `robots.ts` + Nginx `?_rsc=`/`/objednat` 403 + `12r/m` rate limit eliminates >90% of GPTBot load while preserving GEO visibility on canonical `/firma/`.

### P1-3 (CRITICAL): Spoofed-browser scraper farm (`116.179.0.0/16` / `Chrome/99.0.4844.51`) bypasses ASN & per-IP limits
- `82,858` requests were blocked (`403`) by `zz-farm-asn.conf`, but **`35,301` `200 OK` requests** (1,224 MISSes) slipped through from `116.179.0.0/16` using the exact 4.5-year-old `Chrome/99.0.4844.51` UA string (~800 req/IP across hundreds of IPs, staying under `120r/m`).
- Additionally, spoofed/headless browsers generated `32,838` `/api/auth/session` requests (`23,075/day`).

### P1-4 (HIGH): `bingbot` wastes 78.5% of its ISR MISSes on non-sitemap `/{lang}/firma/`
- `13,254` of `16,876` bingbot MISSes (`32,790s` RT = **7.2%** of all server time; **2.51 GB/day** ISR) hit `/{lang}/firma/`, which is intentionally omitted from `sitemap/[id]/route.ts`.
- Disallowing `/{lang}/firma/` + setting `crawlDelay: 2` for `bingbot` in `robots.ts` (plus gentle Nginx `10r/m` on `/{lang}/firma/` and `60r/m` on `/firma/`) preserves 100% of canonical SK `/firma/` indexing on Bing/Copilot while cutting Bing load by ~75%.

### P1-5 (MEDIUM): `ExaSearchBot`, `BacklinksExtendedBot`, `Applebot`, and `OAI-SearchBot` waste
- `ExaSearchBot` (`2,860` req, `1,264` MISSes) & `BacklinksExtendedBot` (`342` req) are completely unrestricted.
- `Applebot` (`729` req, `496` MISSes): **97.8%** (`485/496`) of its MISSes are `/{lang}/firma/`.
- `OAI-SearchBot` (`1,391` req): **71.0%** (`988/1,391`) are wasted `?_rsc=` prefetches.

---

## 5. Quantified Expected Savings (Per 24h Day)

Calculations normalized from the exact 34.155h (`1.4231d`) observed window, using measured **270 KB/page** ISR disk footprint:

| Control | Requests Saved / Day | ISR MISSes Saved / Day | ISR Disk Saved / Day | Upstream RT Saved / Day |
|---|---:|---:|---:|---:|
| Block `YandexBot` (`robots.ts` + Nginx 403) | 18,746 | 16,157 | **4.36 GB/day** | 71,873 s/day |
| Block `Baiduspider` (`robots.ts` + Nginx 403) | 32,947 | 8,764 | **2.37 GB/day** | 36,265 s/day |
| `GPTBot` `/objednat` + `?_rsc=` block + `12r/m` cap | ~92,000 | ~7,500 | **2.03 GB/day** | ~30,000 s/day |
| `bingbot` disallow `/{lang}/firma/` + `crawlDelay: 2` | ~9,700 | ~9,313 | **2.51 GB/day** | ~23,040 s/day |
| Block `Chrome/99.0.4844.51` spoofed farm (Nginx 403) | 24,806 | 860 | **0.23 GB/day** | ~8,500 s/day |
| `ExaSearchBot` / `BacklinksExtendedBot` / `Applebot` / `OAI-SearchBot` cleanup | ~2,600 | ~1,100 | **0.30 GB/day** | ~3,800 s/day |
| **Total Expected Savings** | **~180,800 req/day (-55.0%)** | **~43,694 MISS/day (-56.7%)** | **~11.80 GB/day (-56.7%)** | **~173,478 s/day (-54.2%)** |

- **SSR DB / CPU / RAM Impact:** Eliminating ~173,500 s/day of upstream SSR work removes **~2.01 continuous concurrency slots** (out of 3.71 saturated 24/7 — a **~54% reduction in steady-state Next.js + PostgreSQL SSR load**), directly cutting `5xx` timeouts (`2,159` observed in 34h) and RAM/GC pressure in `verifa_frontend`.

---

## 6. SEO Safety & Open Questions

1. **Googlebot 100% Protected:** Googlebot has **zero** Nginx blocks, **zero** Nginx rate limits, and inherits the unrestricted `*` rule in `robots.ts` (allowing `/`, `/firma/`, `/{lang}/firma/`, `/firmy`, `/screener`, `/slovnik`, `/pricing`, `/documents`, `/sitemap.xml`). Disallowing `/objednat` and `/*?_rsc=` strictly *improves* Googlebot crawl budget.
2. **Hreflang Integrity:** Localized `/{lang}/firma/` pages remain crawlable by Googlebot so Google Search Console will not report `hreflang` return-tag / `Blocked by robots.txt` errors. Only Bingbot, Applebot, and AI crawlers are steered away from `/{lang}/firma/`.
3. **Open Question — Residual Residential-Proxy Scraping:** Beyond `116.179.0.0/16` (`Chrome/99.0.4844.51`), ~81k `200 OK` requests (~22k MISSes) come from distributed residential/mobile IPs (`172.59/16`, `172.56/16`, `172.58/16`, etc.) with current Chrome UAs. Blocking those safely without false-positiving real users would require either Cloudflare Bot Management / Turnstile or an edge cookie challenge on `/{lang}/firma/` (out of scope for pure Nginx/robots.txt).
4. **Coordination with `release/etapa-2` (`90bccb5`):** `docs/nginx/verifa-crawler-policy.conf` intentionally reuses `verifa_gptbot` and `verifa_auth_session` zone names from `90bccb5` and generalizes `$verifa_ai_rsc_block` → `$verifa_bot_rsc_block` so merging Etapa 2 + Stream 2 has zero zone collisions.
