# SEO Audit Report — Company Pages (verifa.sk)

**Date:** 2026-08-27T13:49:24.487Z
**Sample size:** 5000
**Seed:** 42
**Base URL:** https://verifa.sk
**Concurrency:** 8

## Executive Summary

```text
Sample size:      5000
HTTP 200:         100.0% (5000)
Indexable:        70.6% (3532)
noindex:          29.4% (1468)
Canonical OK:     100.0% (5000)
Title OK:         90.7% (4533)
Meta desc OK:     67.3% (3363)
H1 OK:            100.0% (5000)
JSON-LD OK:       100.0% (5000)
Thin content:     0.1% (6)
Very thin (<50w): 0.0% (0)
No company name:  8.1% (407)
Duplicate titles: 0 groups
Duplicate desc:   0 groups
Duplicate H1:     1 groups
Canonical coll:   0 groups
5xx:              0
404/410:          0
Timeouts:         0
```

## Performance

```text
Average response: 791ms
p50:              712ms
p95:              1618ms
p99:              2407ms
Slow pages (>5s): 1
```

## Severity Distribution

| Severity | Count | % |
|----------|------:|---:|
| PASS | 2311 | 46.2% |
| P2 (minor) | 1002 | 20.0% |
| P1 (important) | 1687 | 33.7% |
| P0 (critical) | 0 | 0.0% |

**Note on P1:** 751 of 1687 P1 pages are P1 *only* because of NOINDEX (quality gate: <2 financial statements). This is **expected behavior**. Real P1 issues (excluding NOINDEX): 936.

## Top Issues

| Code | Count | Severity | Notes |
|------|------:|----------|-------|
| META_DESC_TOO_LONG | 1637 | P2 |  |
| NOINDEX | 1468 | P1 | Expected (quality gate <2 FS) |
| TITLE_TOO_LONG | 467 | P2 |  |
| NO_COMPANY_NAME_IN_CONTENT | 407 | P1 |  |
| H1_NO_COMPANY_NAME | 282 | P2 |  |
| LOW_CONTENT | 6 | P2 |  |
| SLOW_RESPONSE | 1 | P2 |  |

## Duplicate Analysis

### Duplicate Titles: 0 groups
None ✅

### Duplicate Meta Descriptions: 0 groups
None ✅

### Duplicate H1s: 1 groups
- "family, s.r.o." — 2 pages: 55517234, 31639542

### Canonical Collisions: 0 groups
None ✅

## P0 Issues (Critical)

**None ✅**

## P1 Issues (Important) — Excluding Expected NOINDEX

- **57661669** (JUDr. Pavel Lacko, LL.M., PhD., advokátska kancelária s. r. o.) — https://verifa.sk/firma/57661669-judr-pavel-lacko-ll-m-phd-advokatska-kancelaria-s-r-o
- **31374531** (PePa - Slovensko s.r.o. v likvidácii) — https://verifa.sk/firma/31374531-pepa-slovensko-s-r-o-v-likvidacii
- **35863625** (BRUSTAV s.r.o.) — https://verifa.sk/firma/35863625-brustav-s-r-o
- **56929234** (Výtlky EU s. r. o.) — https://verifa.sk/firma/56929234-vytlky-eu-s-r-o
- **36584274** (KERAMIKA PARADISE BIS, s.r.o.) — https://verifa.sk/firma/36584274-keramika-paradise-bis-s-r-o
- **52425592** (KUČERA & PARTNERS advokátska kancelária, s.r.o.) — https://verifa.sk/firma/52425592-kucera-partners-advokatska-kancelaria-s-r-o
  - [NO_COMPANY_NAME_IN_CONTENT] Company name not found in title or H1
- **57110964** (EMERON s. r. o.) — https://verifa.sk/firma/57110964-emeron-s-r-o
- **46581839** (RIKKI s. r. o.) — https://verifa.sk/firma/46581839-rikki-s-r-o
- **54189357** (DM - sped s. r. o.) — https://verifa.sk/firma/54189357-dm-sped-s-r-o
- **35901993** (B - INVEST, s.r.o.) — https://verifa.sk/firma/35901993-b-invest-s-r-o
- **57402230** (Sabko Bratislava s. r. o.) — https://verifa.sk/firma/57402230-sabko-bratislava-s-r-o
- **46315748** (TRANSIT 123, s. r. o.) — https://verifa.sk/firma/46315748-transit-123-s-r-o
  - [NO_COMPANY_NAME_IN_CONTENT] Company name not found in title or H1
- **44978189** (Gratems, s. r. o.) — https://verifa.sk/firma/44978189-gratems-s-r-o
  - [NO_COMPANY_NAME_IN_CONTENT] Company name not found in title or H1
- **53856864** (Herbaday s. r. o.) — https://verifa.sk/firma/53856864-herbaday-s-r-o
- **57355851** (Bloom by Mona s. r. o.) — https://verifa.sk/firma/57355851-bloom-by-mona-s-r-o
- **36214591** (NOVA. V., s.r.o. Košice) — https://verifa.sk/firma/36214591-nova-v-s-r-o-kosice
- **44547315** (include, s. r. o.) — https://verifa.sk/firma/44547315-include-s-r-o
- **57104085** (Titans-solution s. r. o.) — https://verifa.sk/firma/57104085-titans-solution-s-r-o
- **57748616** (SLADOLED s. r. o.) — https://verifa.sk/firma/57748616-sladoled-s-r-o
- **46196706** (Palazzo s. r. o.) — https://verifa.sk/firma/46196706-palazzo-s-r-o
  - [NO_COMPANY_NAME_IN_CONTENT] Company name not found in title or H1
- **53092953** (F&H Holding s. r. o.) — https://verifa.sk/firma/53092953-f-h-holding-s-r-o
  - [NO_COMPANY_NAME_IN_CONTENT] Company name not found in title or H1
- **30776970** (STEART spoločnosť s ručením obmedzeným STEART spol. s r.o. (skrátený názov)) — https://verifa.sk/firma/30776970-steart-spolocnost-s-rucenim-obmedzenym-steart-spol-s-r-o-skr
- **55240411** (Integrity team s.r.o.) — https://verifa.sk/firma/55240411-integrity-team-s-r-o
- **46442146** (K & K Salix s.r.o.) — https://verifa.sk/firma/46442146-k-k-salix-s-r-o
  - [NO_COMPANY_NAME_IN_CONTENT] Company name not found in title or H1
- **35932261** (BG Group, s.r.o.) — https://verifa.sk/firma/35932261-bg-group-s-r-o
- **57462054** (Allukim s. r. o.) — https://verifa.sk/firma/57462054-allukim-s-r-o
- **51101122** (JOKRES s.r.o.) — https://verifa.sk/firma/51101122-jokres-s-r-o
  - [NO_COMPANY_NAME_IN_CONTENT] Company name not found in title or H1
- **57676437** (Quorum 5 s. r. o.) — https://verifa.sk/firma/57676437-quorum-5-s-r-o
- **57709998** (ZK legal, s. r. o.) — https://verifa.sk/firma/57709998-zk-legal-s-r-o
- **51800446** (Rustiliol, s.r.o.) — https://verifa.sk/firma/51800446-rustiliol-s-r-o
  - [NO_COMPANY_NAME_IN_CONTENT] Company name not found in title or H1

## Thin Content Examples

- **31584667** (BUROŠ-TRADING s.r.o.) — 198 words — https://verifa.sk/firma/31584667-buros-trading-s-r-o
- **31661181** (SOFTIMEX s.r.o.) — 197 words — https://verifa.sk/firma/31661181-softimex-s-r-o
- **36001872** (EUROJAZYK s.r.o.) — 197 words — https://verifa.sk/firma/36001872-eurojazyk-s-r-o
- **31445870** (DARKUS s.r.o.) — 196 words — https://verifa.sk/firma/31445870-darkus-s-r-o
- **31736718** (SLOVKIM, s.r.o.) — 197 words — https://verifa.sk/firma/31736718-slovkim-s-r-o
- **36538761** (KAMENOSTAV, s.r.o.) — 197 words — https://verifa.sk/firma/36538761-kamenostav-s-r-o

## Company Name Not in Title/H1 — Examples

- **52425592** name="KUČERA & PARTNERS advokátska kancelária, s.r.o." title="KUČERA &amp; PARTNERS advokátska kancelária, s.r.o. (5242559" h1=["KUČERA &amp; PARTNERS advokátska kancelária, s.r.o."]
- **46315748** name="TRANSIT 123, s. r. o." title="Esso Market s. r. o. (46315748) — Finančné dáta, zisk, súvah" h1=["Esso Market s. r. o."]
- **44978189** name="Gratems, s. r. o." title="Graditec s. r. o. (44978189) — Finančné dáta, zisk, súvaha" h1=["Graditec s. r. o."]
- **46196706** name="Palazzo s. r. o." title="Naprus s. r. o. (46196706) — Finančné dáta, zisk, súvaha" h1=["Naprus s. r. o."]
- **53092953** name="F&H Holding s. r. o." title="F&amp;H Holding s. r. o. (53092953) — Finančné dáta, zisk, s" h1=["F&amp;H Holding s. r. o."]
- **46442146** name="K & K Salix s.r.o." title="K &amp; K Salix s.r.o. (46442146) — Finančné dáta, zisk, súv" h1=["K &amp; K Salix s.r.o."]
- **51101122** name="JOKRES s.r.o." title="EMERO TRADE s.r.o. (51101122) — Finančné dáta, zisk, súvaha" h1=["EMERO TRADE s.r.o."]
- **51800446** name="Rustiliol, s.r.o." title="TANAGO &amp; Co. s.r.o. (51800446) — Finančné dáta, zisk, sú" h1=["TANAGO &amp; Co. s.r.o."]
- **36587231** name="VADALA s.r.o." title="GENNA s.r.o. (36587231) — Finančné dáta, zisk, súvaha" h1=["GENNA s.r.o."]
- **36682985** name="P&T Consulting s.r.o." title="P&amp;T Consulting s.r.o., v likvidácii (36682985) — Finančn" h1=["P&amp;T Consulting s.r.o., v likvidácii"]

## H1 Without Company Name — Examples

- **46315748** name="TRANSIT 123, s. r. o." h1="Esso Market s. r. o."
- **44978189** name="Gratems, s. r. o." h1="Graditec s. r. o."
- **46196706** name="Palazzo s. r. o." h1="Naprus s. r. o."
- **53092953** name="F&H Holding s. r. o." h1="F&amp;H Holding s. r. o."
- **51101122** name="JOKRES s.r.o." h1="EMERO TRADE s.r.o."
- **51800446** name="Rustiliol, s.r.o." h1="TANAGO &amp; Co. s.r.o."
- **36587231** name="VADALA s.r.o." h1="GENNA s.r.o."
- **36682985** name="P&T Consulting s.r.o." h1="P&amp;T Consulting s.r.o., v likvidácii"
- **53219325** name="S667 trade s. r. o." h1="Molettdíva s. r. o."
- **46681752** name="METAL EUROPA s.r.o." h1="First Year, s.r.o."

## Title Too Long — Examples

- **57661669** (103 chars) "JUDr. Pavel Lacko, LL.M., PhD., advokátska kancelária s. r. o. (57661669) — Fina..."
- **31374531** (77 chars) "PePa - Slovensko s.r.o. v likvidácii (31374531) — Finančné dáta, zisk, súvaha..."
- **54396352** (94 chars) "Znalecký ústav v Zdravotníctve a Psychológii s. r. o. (54396352) — Finančné dáta..."
- **52425592** (92 chars) "KUČERA &amp; PARTNERS advokátska kancelária, s.r.o. (52425592) — Finančné dáta, ..."
- **55011501** (71 chars) "Prometheus LPG Košice s. r. o. (55011501) — Finančné dáta, zisk, súvaha..."

## Meta Description Too Long — Examples

- **57661669** (222 chars) "JUDr. Pavel Lacko, LL.M., PhD., advokátska kancelária s. r. o. (57661669), Brati..."
- **52270742** (176 chars) "SCALO s. r. o. (52270742), Bratislava - mestská časť Petržalka — účtovné závierk..."
- **31374531** (173 chars) "PePa - Slovensko s.r.o. v likvidácii (31374531), Bratislava — účtovné závierky, ..."
- **35863625** (176 chars) "BRUSTAV s.r.o. (35863625), Bratislava - mestská časť Petržalka — účtovné závierk..."
- **56929234** (178 chars) "Výtlky EU s. r. o. (56929234), Bratislava - mestská časť Ružinov — účtovné závie..."

## Methodology

- **Sample selection:** Random 5000 from production DB (eligible legal forms: s.r.o., a.s., v.o.s., k.s.)
- **URL format:** `/firma/{ico}-{slug}` (canonical URL with slug)
- **HTTP checks:** Manual redirect following (up to 5), timeout 20s
- **HTML parsing:** Lightweight regex-based (no headless browser)
- **Concurrency:** 8 parallel requests
- **User-Agent:** VerifaSEOAudit/1.0 (+https://verifa.sk/bot)
- **noindex note:** Pages with <2 financial statements are intentionally noindex (quality gate). 751 pages are P1 only due to this — expected behavior, not a bug.

## Reproducibility

```bash
# Re-run with same sample:
ssh root@89.185.250.213 "cd /var/www/verifa && docker exec verifa_postgres psql -U verifa -d verifa -t -A -c \"SELECT ico,name,\\\"legalForm\\\" FROM \\\"Company\\\" WHERE \\\"legalForm\\\" IN ('s.r.o.','a.s.','v.o.s.','k.s.') ORDER BY RANDOM() LIMIT 5000\" | node scripts/seo-audit-company-pages.mjs --sample-size 5000 --seed 42
```

## Raw Data

- `scripts/seo-audit-results.json` — full per-URL results (JSON)
- `scripts/seo-audit-results.csv` — CSV export for spreadsheet analysis
