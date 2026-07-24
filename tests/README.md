# Verifa.sk — Test Suite

## Štruktúra

```
tests/                              # Frontend & API integration tests (bash/curl)
├── run_all.sh                      # Test runner — spustí všetky shell testy
└── integration/
    ├── test_auth.sh                # Auth: login, logout, CSRF, session, middleware
    ├── test_api.sh                 # API: reports, credits, settings, feedback, lookup
    ├── test_functional.sh          # Functional: forgot/reset password, report creation
    └── test_worker.sh              # Worker: health, frontend↔worker bridge, docs

worker/tests/                       # Python unit & integration tests (pytest)
├── test_analytics.py               # Unit: finančné metriky (ratios, Altman Z, Piotroski, scorecard)
├── test_ruz_parser.py              # Unit: RÚZ JSON parser (_to_float, sanity check, parse tables)
├── test_pdf_ingestion.py           # Unit: PDF ingestion (extract core financials, strip notes)
├── test_scrapers.py                # Integration: scraper tests (Dôvera, SP, VšZP, Union, ORSR, RPVS, ZRSR, INS)
└── test_fs_links.py                # Smoke: Finančná správa scraper link/input existence
```

## Kategórie

### Unit Tests (`worker/tests/test_analytics.py`, `test_ruz_parser.py`, `test_pdf_ingestion.py`)
Testujú izolované funkcie bez externých závislostí:
- **Finančné výpočty**: `_safe_div`, `_safe_pct`, `compute_financial_ratios`, `compute_altman_z_score`, `compute_piotroski_f_score`, `detect_startup_profile`, `compute_white_horse_indicator`, `sanitize_cash_flow_fields`, `estimate_missing_cash_flow`, `get_nace_weights`, `compute_vestnik_degradation`
- **RÚZ parser**: `_to_float` (SK/US formátovanie, zátvorky), `_extract_row_value`, `_sanity_check` (bilančná rovnica), `parse_tables_to_metrics` (unit detection, gross margin, consolidated flag)
- **PDF ingestion**: `extract_core_financials` (odstránenie notes sekcie)

### Integration Tests (`tests/integration/`, `worker/tests/test_scrapers.py`)
Testujú interakciu medzi komponentmi na reálnej aplikácii:
- **Auth**: login/logout flow, CSRF token, session, middleware route protection
- **API**: reports CRUD, credits, settings, feedback, lookup — vrátane auth checks
- **Worker**: health endpoint, frontend↔worker bridge, FastAPI docs
- **Scrapers**: page load, search form, clean company, nonexistent company (na živých portáloch)

### Functional Tests (`tests/integration/test_functional.sh`)
Testujú end-to-end používateľské toky:
- Forgot password (rate limiting, nonexistent email)
- Reset password (invalid token, short password)
- Report creation (credits, worker availability)

### Smoke Tests (`worker/tests/test_fs_links.py`)
Rýchle overenie že FS scraper linky a input polia stále existujú na portáli.

## Spustenie

### Shell testy (frontend/API na produkcii)
```bash
BASE_URL=https://verifa.sk \
WORKER_URL=http://89.185.250.213:8000 \
TEST_EMAIL=dusan02@gmail.com TEST_PASSWORD=22222222 \
bash tests/run_all.sh
```

### Python unit testy (lokálne alebo v Dockeri)
```bash
# Lokálne
cd worker && python -m pytest tests/test_analytics.py tests/test_ruz_parser.py tests/test_pdf_ingestion.py -v

# V Dockeri
docker compose exec worker bash -c 'cd /app && python -m pytest tests/test_analytics.py tests/test_ruz_parser.py -v'
```

### Scraper testy (v Dockeri — vyžadujú Playwright)
```bash
docker compose exec worker bash -c 'cd /app && python -m pytest tests/test_scrapers.py tests/test_fs_links.py -v'
```

### Všetko naraz
```bash
# 1. Shell testy
bash tests/run_all.sh

# 2. Python testy
cd worker && python -m pytest tests/ -v --tb=short
```

## Poznámky

- Rate limiting (429) je akceptovaný v functional testoch ako validný výsledok
- Scraper testy vyžadujú prístup na slovenské štátne portály (môžu failnúť pri zmene DOM)
- Známe bugy: ZRSR vracia "Aktívny záznam" pre neexistujúce IČO, VšZP clean company test failed
