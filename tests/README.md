# Verifa.sk — Test Suite Documentation

## Prehľad

Test suite pokrýva celú aplikáciu — od izolovaných finančných výpočtov cez API endpointy až po scraper integráciu na živých štátnych portáloch.

**Celkom: ~387 testov v 16 súboroch across 5 kategórií.**

---

## Štruktúra

```
tests/                              # Frontend & API tests
├── run_all.sh                      # Test runner — shell + TS + optional Python
├── README.md                       # Tento súbor
├── unit/
│   ├── rateLimit_spec.ts           # Unit: rateLimit.ts (13 tests)
│   └── i18n_spec.ts                # Unit: i18n key parity (23 tests)
├── integration/
│   ├── test_auth.sh                # Integration: auth flow (15 tests)
│   ├── test_api.sh                 # Integration: API endpoints (32 tests)
│   └── test_worker.sh              # Integration: worker connectivity (5 tests)
└── functional/
    └── test_functional.sh          # Functional: end-to-end flows (10 tests)

worker/tests/                       # Python tests (pytest)
├── conftest.py                     # Shared fixtures (stmt, stmt_dict, make_tables)
├── test_analytics.py               # Unit: finančné metriky (57 tests)
├── test_forensic_scorecard.py      # Unit: 5-pilier scorecard (81 tests)
├── test_attachment_filter.py       # Unit: PDF attachment filter (31 tests)
├── test_pdf_compiler.py            # Unit: PDF compiler helpers (35 tests)
├── test_ruz_parser.py              # Unit: RÚZ JSON parser (~30 tests)
├── test_pdf_ingestion.py           # Unit: PDF ingestion (1 test)
├── test_scrapers.py                # Integration: scraper tests (27 tests)
├── test_fs_links.py                # Smoke: FS scraper link existence (~8 tests)
└── test_orchestration.py            # Unit: orchestration retry/timeout/RÚZ (18 tests)
```

---

## Kategórie

### 1. Unit Tests — Python

Testujú izolované funkcie bez externých závislostí (bez DB, bez siete, bez browsera).

#### `worker/tests/test_analytics.py` — 57 testov

Finančné výpočty z `worker/src/analytics.py`.

| Test class | Počet | Čo testuje |
|---|---|---|
| `TestSafeDiv` | 5 | `_safe_div` — normálne delenie, zero denominator, negative denominator, decimals |
| `TestSafePct` | 4 | `_safe_pct` — percentá, zero denominator, negative numerator |
| `TestSanitizeCashFlow` | 4 | `sanitize_cash_flow_fields` — 0→None konverzia pre dict aj object, nonzero preserved |
| `TestComputeFinancialRatios` | 8 | `compute_financial_ratios` — likvidita (current/quick/cash ratio), zadlženosť (D/E, negative equity), rentabilita (ROE, ROA, margins), EBITDA, DSO/DPO, anualizácia pri skrátenom období |
| `TestAltmanZScore` | 6 | `compute_altman_z_score` — SAFE/GREY/DISTRESS zóny, chýbajúce dáta, zero assets, komponenty X1-X4 |
| `TestPiotroskiFScore` | 5 | `compute_piotroski_f_score` — high score (zlepšujúca sa firma), low score (zhoršujúca sa), insufficient data, empty list, max 8 |
| `TestStartupDetection` | 6 | `detect_startup_profile` — startup detected, high revenue, low equity, too many years, empty list, zero assets |
| `TestWhiteHorse` | 5 | `compute_white_horse_indicator` — schránková firma (0 mzdových nákladov), normálna firma, receivables >90% aktív, IFRS skip, empty list |
| `TestEstimateCashFlow` | 4 | `estimate_missing_cash_flow` — odhad z Δinventory/Δreceivables/Δpayables, CF už prítomný, chýba prev year, empty |
| `TestNaceWeights` | 5 | `get_nace_weights` — výroba, stavebníctvo, IT, default, empty code (súčet váh = 100) |
| `TestVestnikDegradation` | 5 | `compute_vestnik_degradation` — recent (1.0), 1yr (0.7), 3yr (0.4), 5yr (0.1), no date |

#### `worker/tests/test_forensic_scorecard.py` — 81 testov

5-pilierový scoring model z `worker/src/analytics.py` — `compute_forensic_scorecard` a súvisiace funkcie.

| Test class | Počet | Čo testuje |
|---|---|---|
| `TestRiskCategory` | 8 | `_risk_category` — AAA/A/B/C hranice (90/70/40/0) |
| `TestHardStop` | 4 | Konkurz / likvidácia / reštrukturalizácia → score 0, risk C, non-critical prejde |
| `TestPillar1` | 3 | Platobná schopnosť — current ratio, equity, vestník events, N/A fallback |
| `TestPillar2` | 3 | Finančné zdravie — Altman Z'', Piotroski, startup profil, data void |
| `TestPillar3` | 5 | Ziskovosť & CF — profitable years, consecutive losses penalty, strong/negative CF, no stmts |
| `TestPillar4` | 3 | Rast & trendy — CAGR growth, declining revenue, no CAGR data |
| `TestPillar5` | 6 | Právna bezúhonnosť — clean company, critical/medium/low vestník, auditor opinion (bez výhrad / s výhradou) |
| `TestDataQualityMultiplier` | 5 | DQ multiplier — 5+ stmts s/without audit, few stmts, no audit penalty |
| `TestWhiteHorsePenalty` | 2 | Shell company penalized, normal company no penalty |
| `TestOrsrForensicPenalty` | 7 | ORSR forensic — CRITICAL/HIGH severity, no events, >50 statutory changes, virtual seat + foreign statutory, big corp downgrade, penalty cap at 5 |
| `TestScorecardResult` | 5 | Štruktúra — 5 core pilierov, score 0-100, version v2, scores ≤ max, risk category match |
| `TestComputeFinancialTrends` | 9 | CAGR výpočet, consecutive losses, Altman Z per year, ratios per year, YoY revenue trend, bankruptcy risk indicators, short period anualization |
| `TestStateLiabilitiesAlert` | 7 | SP/tax/employee liabilities — CRITICAL s registry, INFO bez registry, WARNING threshold, zero values |
| `TestRevenuePerEmployee` | 7 | Reported vs estimated employee count, CRITICAL (≤1 emp + 500k rev), WARNING (>2M RPE), normal, zero revenue |
| `TestYoySummaryTable` | 7 | Headers, rows with key metrics, all-None row skipped, revenue decline 🟡/🔴, liabilities growth 🔴 |

#### `worker/tests/test_attachment_filter.py` — 31 testov

Logika vylúčenia príloh z PDF reportu z `worker/src/attachment_filter.py`.

| Test class | Počet | Čo testuje |
|---|---|---|
| `TestFromDict` | 4 | None config, empty dict → defaults, partial merge, full override |
| `TestIsCategoryEnabled` | 4 | None → all enabled, enabled/disabled category, unknown → default True |
| `TestShouldIncludeSource` | 6 | None → include all, disabled category excludes, enabled includes, uncategorized always included, REGISTER_UZ mapping |
| `TestGetExcluded` | 5 | None → no exclusions, excluded categories, source types, multiple, empty category |
| `TestHasRedFlagExcluded` | 5 | None → no red flags, non-excluded source, excluded source detected, not excluded, empty list |
| `TestCategoryMap` | 7 | ORSR/ZRSR/REGISTER_UZ mapped, auditorska_sprava empty, RED_FLAG_SOURCE_TYPES, ORSR not red flag, default config |

#### `worker/tests/test_pdf_compiler.py` — 35 testov

PDF compiler helper funkcie z `worker/src/pdf/compiler.py`.

| Test class | Počet | Čo testuje |
|---|---|---|
| `TestHasNoRecord` | 18 | SUCCESS with/without findings, FAILED/PENDING status, no/empty file_path, 13 "no record" markers, case insensitive, status_message fallback, real findings not flagged |
| `TestSourceOrder` | 5 | ORSR/INSOLVENCY in order, numeric values, unknown → 999 |
| `TestSourcesWithEmbeddedTitle` | 5 | ORSR has embedded, INSOLVENCY doesn't, all health insurers, FINANCNA_SPRAVA, frozenset type |
| `TestNoRecordMarkers` | 3 | Tuple type, non-empty, all strings |

#### `worker/tests/test_ruz_parser.py` — ~30 testov

RÚZ JSON parser z `worker/src/ruz_parser.py`.

| Test class | Počet | Čo testuje |
|---|---|---|
| `TestToFloat` | 18 | `_to_float` — Slovak thousand separators (medzery, NBSP), US formát, zátvorková notácia (negative), mixed comma/dot, empty/None/boolean, garbage |
| `TestExtractRowValue` | 7 | `_extract_row_value` — aktív full row (Netto2/Netto3), pasív full row, data-only row, too short, None, out of range, parentheses |
| `TestSanityCheck` | 5 | `_sanity_check` — bilančná rovnica (assets = equity + liab), tolerance, negative revenue, negative personnel costs, all None |
| `TestParseTablesToMetrics` | 12 | `parse_tables_to_metrics` — basic parsing, gross margin z COGS, fallback na Pridanú hodnotu, unit detection (tisíce EUR vs EUR), parentheses v net profit, missing tables, missing year, consolidated flag, employee count, months computation, short period |

#### `worker/tests/test_pdf_ingestion.py` — 1 test

| Test | Čo testuje |
|---|---|
| `test_extract_core_financials` | `extract_core_financials` — vytvorí dummy PDF (10 strán), overí že core statements sa extrahujú a Notes sekcia sa odstráni |

#### `worker/tests/test_orchestration.py` — 18 testov

Orchestrácia generovania reportu — retry, timeout, error handling.

| Test class | Počet | Čo testuje |
|---|---|---|
| `TestSafeGotoBroadened` | 3 | `_safe_goto` — network error retry, generic exception after retries, success on first try |
| `TestRuzApiRetry` | 5 | `_api_get` — retry on HTTP 500, retry on network error, no retry on 404, all retries exhausted, success first try |
| `TestRuzParallelVykazy` | 1 | `_process_zavierka` — výkazy stiahnuté paralelne (čas < sekvenčný) |
| `TestRetryFilter` | 2 | Retry filter zachytí UNAVAILABLE (nielen FAILED), starý filter by vynechal UNAVAILABLE |
| `TestExponentialBackoff` | 2 | Retry delays [3, 10, 30] — 3 passy, exponenciálny rast (≥2x) |
| `TestMaxYearsConsistency` | 3 | Scraper používa `_cfg.ruz_max_years` (nie hardcoded 3), config definuje hodnotu, pipeline používa config |
| `TestTimeoutPreservesPartial` | 2 | Timeout vytvorí FAILED záznamy (nie prázdny zoznam), source_types zodpovedajú task.sources |

---

### 2. Unit Tests — TypeScript

#### `tests/unit/rateLimit_spec.ts` — 13 testov

In-memory rate limiting z `frontend/src/lib/rateLimit.ts`.

| Test | Čo overuje |
|---|---|
| First request allowed | `rateLimitByKey` — prvé volanie → allowed, remaining = max-1 |
| Exhaust then blocked | 3 povolené, 4th blocked, remaining = 0 |
| Different keys independent | Key1 exhausted, key2 unaffected |
| Window reset | Po window expiry → opäť allowed |
| Remaining decrements | 4 → 3 → 2 pre maxRequests=5 |
| ResetTime in future | > now, ≤ now + window + buffer |
| 429 status | `rateLimitResponse` → status 429, Retry-After header, X-RateLimit-Remaining=0 |
| Error message | Body obsahuje `error` string |
| Retry-After positive | > 0, ≤ window seconds |
| IP from x-forwarded-for | Prvá IP z comma-separated listu |
| IP from x-real-ip | Fallback na x-real-ip header |
| IP unknown | Fallback na "unknown" |
| Same IP shared counter | 2 requesty z rovnakého IP zdieľajú counter |

#### `tests/unit/i18n_spec.ts` — 23 testov

Parita kľúčov a funkčnosť i18n z `frontend/src/lib/i18n.ts`.

| Test | Čo overuje |
|---|---|
| SK has 100+ keys | SK slovník má 515 kľúčov |
| EN same keys as SK | Všetky SK kľúče existujú v EN |
| DE same keys as SK | Všetky SK kľúče existujú v DE |
| EN/DE no extra keys | Žiadne extra kľúče v EN/DE mimo SK |
| No empty values | Žiadne prázdne hodnoty v žiadnom jazyku |
| No duplicate keys | Žiadne duplicitné kľúče v rámci jazyka |
| translate() SK/EN/DE | Vráti správnu hodnotu pre každý jazyk |
| translate() fallback | Chýbajúci kľúč → vráti key string |
| translate() interpolation | Parametre `{n}` sa nahradia v SK/EN/DE |
| LANGUAGES | 3 jazyky (sk, en, de) s flagmi a labelmi |
| LOCALE_MAP | sk→sk-SK, en→en-GB, de→de-DE |

---

### 3. Integration Tests

Testujú interakciu medzi komponentmi na reálnej bežiacej aplikácii (cez HTTP/curl).

#### `tests/integration/test_auth.sh` — 15 testov

Auth flow a middleware route protection.

| # | Test | Čo overuje |
|---|---|---|
| 1 | Login page loads | `GET /login` → 200 |
| 2 | CSRF token | `GET /api/auth/csrf` → valid token |
| 3 | Login valid credentials | `POST /api/auth/callback/credentials` → 302 redirect na `/dashboard` |
| 4 | Session has user | `GET /api/auth/session` → email zodpovedá prihlásenému |
| 5 | Auth providers | `GET /api/auth/providers` → credentials + google (žiadny azure) |
| 6 | Wrong password | Login s chybným heslom → redirect na error |
| 7 | Dashboard with auth | `GET /dashboard` s cookies → 200 |
| 8 | Dashboard without auth | `GET /dashboard` bez cookies → 307 redirect |
| 9 | Documents without auth | `GET /documents` → 307 |
| 10 | Credits without auth | `GET /credits` → 307 |
| 11-14 | Public auth routes | `/login`, `/register`, `/forgot-password`, `/reset-password` → 200 |
| 15 | Logout clears session | Po signout → session je prázdna |

#### `tests/integration/test_api.sh` — 32 testov

API endpointy — vrátane auth checks a validácie vstupov.

| Endpoint | Testov | Čo overuje |
|---|---|---|
| `GET /api/credits` | 4 | 200 s auth, `usedThisMonth` v response, 401 bez auth |
| `GET /api/credits/plan` | 6 | 200 s auth, `remaining`, `successfulReports`, `failedReports`, `periodStart`, 401 bez auth |
| `GET /api/reports` | 6 | 200 s auth, `reports` array, `total`, `totalPages`, pagination params, 401 bez auth |
| `POST /api/reports` | 3 | Invalid IČO (3 digits) → 400, empty sources → 400, 401 bez auth |
| `GET /api/settings` | 4 | 200 s auth, `orsrExtractType`, `defaultSources`, `reportLanguage`, 401 bez auth |
| `PATCH /api/settings` | 3 | Invalid orsrExtractType → 400, no fields → 400, 401 bez auth |
| `POST /api/feedback` | 4 | Valid data → ok, invalid category → 400, empty message → 400, 401 bez auth |
| `GET /api/lookup` | 3 | Valid IČO → found + companyName, invalid IČO → 400, 401 bez auth |

#### `tests/integration/test_worker.sh` — 5 testov

Worker connectivity a health.

| # | Test | Čo overuje |
|---|---|---|
| 1 | Worker health | `GET /health` → 200 |
| 2 | Health response body | Obsahuje `"ok"` |
| 3 | Frontend↔Worker bridge | `POST /api/reports` → 402 (worker reachable, no credits) alebo 201 (created) |
| 4 | Worker docs | `GET /docs` → 200 (FastAPI Swagger) |
| 5 | Worker unreachable | Ak 503 → fail (worker nebeží) |

---

### 4. Functional Tests

End-to-end používateľské toky — testujú kompletné scenáre.

#### `tests/functional/test_functional.sh` — 10 testov

| Flow | Testov | Čo overuje |
|---|---|---|
| **Forgot password** | 3 | Valid email → 200 + message, nonexistent email → rovnaká odpoveď (security), no email → 400. Akceptuje 429 (rate limit). |
| **Reset password** | 3 | Invalid token → 400 + "Neplatný", short password → 400, no token → 400. Akceptuje 429. |
| **Register page** | 1 | `GET /register` → 200 |
| **Report creation** | 1 | `POST /api/reports` s valid IČO → 201 (created) / 402 (no credits) / 503 (worker down) / 401 (rate limited) |
| **Login rate limit** | 2 | Viacnásobné login pokusy → 429 akceptovaný |

---

### 5. Scraper Integration Tests

Testujú scrapery na živých slovenských štátnych portáloch — vyžadujú Playwright (headless Chromium).

#### `worker/tests/test_scrapers.py` — 27 testov

| Scraper | Testov | Čo overuje |
|---|---|---|
| **Dôvera** | 3 | Page loads, search form inputs, clean company (35757442) |
| **Sociálna poisťovňa** | 3 | Page loads, search form, clean company |
| **VšZP** | 3 | Page loads, search form, clean company ⚠️ *known failure* |
| **UNION** | 3 | Page loads, search form, clean company |
| **ORSR** | 3 | Page loads, IČO input, clean company |
| **RPVS** | 3 | Page loads, search form, clean company |
| **ZRSR** | 4 | Page loads, input + submit, nonexistent company ⚠️ *known bug*, clean company |
| **INSOLVENCY** | 3 | Page loads, search form, nonexistent company |
| **Shared** | 2 | Browser fixture setup, Cloudflare skip logic |

#### `worker/tests/test_fs_links.py` — ~8 testov

Smoke testy pre 8 Finančná správa scraperov — overia že linky a input polia na stránke zoznamov stále existujú.

| Scraper | Čo overuje |
|---|---|
| `FinancnaSpravaScraper` | Daňovní dlžníci — link + input |
| `FsDphRusenieScraper` | Zrušenie DPH — link + input |
| `FsDphVymazaniScraper` | Vymazaní z DPH — link + input |
| `FsDanoveSubjektyScraper` | Index daň. spoľahlivosti — link + input |
| `FsDanZPrijmovScraper` | Daň z príjmov PO — link + input |
| `FsDphNadmernyOdpocetScraper` | Nadmerný odpočet — link + input |
| `FsDphRegistrovaniScraper` | Registrovaní platitelia DPH — link + input |
| `FsDanPrijmovRegistrovaniScraper` | Reg. k dani z príjmov — link + input |

---

## Spustenie

### Shell + TS testy (frontend/API)
```bash
# Na produkcii
BASE_URL=https://verifa.sk \
WORKER_URL=http://89.185.250.213:8000 \
TEST_EMAIL=dusan02@gmail.com TEST_PASSWORD=22222222 \
bash tests/run_all.sh

# Lokálne (vyžaduje bežiaci frontend na :3000)
BASE_URL=http://localhost:3000 bash tests/run_all.sh

# Jednotlivo
bash tests/integration/test_auth.sh
bash tests/integration/test_api.sh
bash tests/functional/test_functional.sh
bash tests/integration/test_worker.sh

# TypeScript unit testy
cd frontend && npx ts-node --transpile-only --compiler-options '{"module":"CommonJS"}' ../tests/unit/rateLimit_spec.ts
```

### Python unit testy
```bash
# V Dockeri (na serveri)
docker exec verifa_worker bash -c 'cd /app && python -m pytest tests/test_analytics.py tests/test_forensic_scorecard.py tests/test_attachment_filter.py tests/test_pdf_compiler.py -v'

# Všetko naraz (lokálne)
cd worker && python -m pytest tests/ -v --tb=short

# Len forensic scorecard
docker exec verifa_worker bash -c 'cd /app && python -m pytest tests/test_forensic_scorecard.py -v --tb=short'
```

### Scraper testy (vyžadujú Playwright + prístup na portály)
```bash
docker exec verifa_worker bash -c 'cd /app && python -m pytest tests/test_scrapers.py tests/test_fs_links.py -v'
```

### Všetko naraz
```bash
# 1. Shell + TS testy (frontend + API + worker + rateLimit)
bash tests/run_all.sh

# 2. Python testy (unit + scrapers) — cez SSH
RUN_PYTHON=1 bash tests/run_all.sh

# Alebo separátne
ssh root@89.185.250.213 "docker exec verifa_worker bash -c 'cd /app && python -m pytest tests/ -v --tb=short'"
```

---

## Prostredie

| Premenná | Default | Popis |
|---|---|---|
| `BASE_URL` | `http://localhost:3000` | URL frontendu |
| `WORKER_URL` | `http://localhost:8000` | URL workera |
| `TEST_EMAIL` | `test@verifa.sk` | Prihlasovací email |
| `TEST_PASSWORD` | `heslo123` | Prihlasovacie heslo |
| `RUN_PYTHON` | `0` | Ak `1`, spustí aj Python testy cez SSH |
| `WORKER_SSH` | `root@89.185.250.213` | SSH adresa workera pre Python testy |

---

## Známe problémy

| Bug | Súbor | Popis |
|---|---|---|
| ZRSR nonexistent IČO | `test_scrapers.py::test_zrsr_nonexistent_company` | ZRSR vracia "Aktívny záznam" pre neexistujúce IČO `99999999` namiesto "Žiadny záznam" |
| VšZP clean company | `test_scrapers.py::test_vszp_clean_company` | VšZP scraper nedokáže nájsť čistú firmu — pravdepodobne zmena DOM na portáli |
| PDF ingestion coverage | `test_pdf_ingestion.py` | Len 1 test — treba pridať edge cases (multi-column, OCR, encrypted PDF) |
| Shell testy akceptujú 429 | `test_functional.sh`, `test_worker.sh` | Rate limit sa považuje za "validný" výsledok — maskuje reálne problémy |
| Scraper testy flaky | `test_scrapers.py`, `test_fs_links.py` | Závisia na živých portáloch — môžu failnúť zmenou DOM |
| Orchestration testy mockované | `test_orchestration.py` | Testy používajú mocks — nepokrývajú reálny beh `main.py` (treba e2e test) |

---

## Pokrytie — čo chýba

| Oblasť | Status | Priorita |
|---|---|---|
| `credits.ts` (consumeCredits, refundCredits) | ❌ Žiadne testy | Vysoká — peňažná logika |
| `email.ts` (sendEmail) | ❌ Žiadne testy | Stredná |
| `token.ts` (hashToken) | ❌ Žiadne testy | Nízka — 1 riadok, ale security |
| `reports/schema.ts` (Zod validácia) | ❌ Žiadne testy | Stredná |
| Stripe webhook | ❌ Žiadne testy | Nízka (deleguje na `/api/billing/webhook`) |
| Frontend komponenty (React) | ❌ Žiadne testy | Nízka (nemáme jest/vitest) |
| CI integrácia | ❌ Neexistuje | Vysoká — testy sa nespúšťajú automaticky |
| Load/stress testy | ❌ Neexistujú | Budúce |
