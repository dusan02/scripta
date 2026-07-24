# Verifa.sk — Test Suite Documentation

## Prehľad

Test suite pokrýva celú aplikáciu — od izolovaných finančných výpočtov cez API endpointy až po scraper integráciu na živých štátnych portáloch.

**Celkom: ~185 testov v 9 súboroch across 4 kategórie.**

---

## Štruktúra

```
tests/                              # Frontend & API tests (bash/curl)
├── run_all.sh                      # Test runner — spustí všetky shell testy
├── README.md                       # Tento súbor
└── integration/
    ├── test_auth.sh                # Integration: auth flow (15 tests)
    ├── test_api.sh                 # Integration: API endpoints (32 tests)
    ├── test_functional.sh          # Functional: end-to-end flows (10 tests)
    └── test_worker.sh              # Integration: worker connectivity (5 tests)

worker/tests/                       # Python tests (pytest)
├── test_analytics.py               # Unit: finančné metriky (57 tests)
├── test_ruz_parser.py              # Unit: RÚZ JSON parser (~30 tests)
├── test_pdf_ingestion.py           # Unit: PDF ingestion (1 test)
├── test_scrapers.py                # Integration: scraper tests (27 tests)
└── test_fs_links.py                # Smoke: FS scraper link existence (~8 tests)
```

---

## Kategórie

### 1. Unit Tests

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

---

### 2. Integration Tests

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

### 3. Functional Tests

End-to-end používateľské toky — testujú kompletné scenáre.

#### `tests/integration/test_functional.sh` — 10 testov

| Flow | Testov | Čo overuje |
|---|---|---|
| **Forgot password** | 3 | Valid email → 200 + message, nonexistent email → rovnaká odpoveď (security), no email → 400. Akceptuje 429 (rate limit). |
| **Reset password** | 3 | Invalid token → 400 + "Neplatný", short password → 400, no token → 400. Akceptuje 429. |
| **Register page** | 1 | `GET /register` → 200 |
| **Report creation** | 1 | `POST /api/reports` s valid IČO → 201 (created) / 402 (no credits) / 503 (worker down) / 401 (rate limited) |
| **Login rate limit** | 2 | Viacnásobné login pokusy → 429 akceptovaný |

---

### 4. Scraper Integration Tests

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

### Shell testy (frontend/API)
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
bash tests/integration/test_functional.sh
bash tests/integration/test_worker.sh
```

### Python unit testy
```bash
# Lokálne
cd worker && python -m pytest tests/test_analytics.py tests/test_ruz_parser.py tests/test_pdf_ingestion.py -v

# V Dockeri
docker compose exec worker bash -c 'cd /app && python -m pytest tests/test_analytics.py tests/test_ruz_parser.py -v'

# Len analytics
docker compose exec worker bash -c 'cd /app && python -m pytest tests/test_analytics.py -v --tb=short'
```

### Scraper testy (vyžadujú Playwright + prístup na portály)
```bash
docker compose exec worker bash -c 'cd /app && python -m pytest tests/test_scrapers.py tests/test_fs_links.py -v'
```

### Všetko naraz
```bash
# 1. Shell testy (frontend + API + worker)
bash tests/run_all.sh

# 2. Python testy (unit + scrapers)
cd worker && python -m pytest tests/ -v --tb=short
```

---

## Prostredie

| Premenná | Default | Popis |
|---|---|---|
| `BASE_URL` | `http://localhost:3000` | URL frontendu |
| `WORKER_URL` | `http://localhost:8000` | URL workera |
| `TEST_EMAIL` | `test@verifa.sk` | Prihlasovací email |
| `TEST_PASSWORD` | `heslo123` | Prihlasovacie heslo |

---

## Známe problémy

| Bug | Súbor | Popis |
|---|---|---|
| ZRSR nonexistent IČO | `test_scrapers.py::test_zrsr_nonexistent_company` | ZRSR vracia "Aktívny záznam" pre neexistujúce IČO `99999999` namiesto "Žiadny záznam" |
| VšZP clean company | `test_scrapers.py::test_vszp_clean_company` | VšZP scraper nedokáže nájsť čistú firmu — pravdepodobne zmena DOM na portáli |
| PDF ingestion coverage | `test_pdf_ingestion.py` | Len 1 test — treba pridať edge cases (multi-column, OCR, encrypted PDF) |

---

## Pokrytie — čo chýba

| Oblasť | Status | Priorita |
|---|---|---|
| `credits.ts` (consumeCredits, refundCredits) | ❌ Žiadne testy | Vysoká — peňažná logika |
| `email.ts` (sendEmail) | ❌ Žiadne testy | Stredná |
| `rateLimit.ts` | ❌ Žiadne testy | Stredná |
| PDF compiler (merge, cover page) | ❌ Žiadne testy | Stredná |
| Stripe webhook | ❌ Žiadne testy | Nízka (deleguje na `/api/billing/webhook`) |
| Frontend komponenty (React) | ❌ Žiadne testy | Nízka (nemáme jest/vitest) |
| Load/stress testy | ❌ Neexistujú | Budúce |
