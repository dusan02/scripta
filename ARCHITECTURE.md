# Verifa.sk — Architektúra aplikácie

> **Účel tohto dokumentu:** Rýchly onboarding pre LLM agenty (Devin, Claude, GPT) a developerov, ktorí kontrolujú alebo rozvíjajú aplikáciu. Obsahuje všetko podstatné na zorientovanie sa v codebase bez čítania každého súboru.

---

## 1. Čo appka robí

**Verifa.sk** je SaaS platforma pre forenznú analýzu slovenských firiem. Generuje **PDF reporty** (tzv. "forenzné posudky") ktoré:

- Stiahnu dáta z **25+ slovenských štátnych registrov** (ORSR, RÚZ, Vestník, Finančná správa, zdravotné poisťovne, exekúcie, súdne rozhodnutia, etc.)
- Extrahujú finančné metriky z **účtovných závierok** (PDF) pomocou LLM (Google Gemini)
- Vypočítajú **verifaScore** (0–100) deterministickým modelom 5 pilierov
- Vygenerujú **AI verdikt** (Chief Auditor) s executive summary, dôkazmi a rizikovou kategóriou
- Zlúčia všetko do **evidence_binder.pdf** (~50–200 strán) s grafmi, tabuľkami a prílohami

**Cieľová skupina:** Audítori, banky, poisťovne, leasingové spoločnosti, B2B firmy overujúce dodávateľov.

**Business model:** Pay-per-report (1 credit = 1 report). Ceny: 14€/report (PAYG), 8,90€ (balík 10), 7,80€ (balík 50). Subskripcie: Freelance/Firma/Korporát. Platieby cez Paddle.

---

## 2. Tech stack

| Vrstva | Technológia |
|--------|-------------|
| **Frontend** | Next.js 15 (App Router), TypeScript, Tailwind CSS, Prisma ORM |
| **Backend (Worker)** | Python 3.11+, FastAPI, ARQ (async task queue), Playwright |
| **Database** | PostgreSQL 16 (Docker) |
| **Queue** | Redis 7 (ARQ jobs) |
| **Browser** | Browserless (headless Chromium, anti-bot stealth) |
| **LLM** | Google Gemini (3.7 Flash, 3.5 Flash-Lite, 3.1 Pro) |
| **PDF** | Playwright (HTML→PDF), PyPDF2 (merge), ReportLab (overlay) |
| **Charts** | Plotly (server-side), vlastné infografiky (SVG) |
| **Billing** | Paddle (sandbox/production) |
| **Auth** | NextAuth.js (Google OAuth, Azure AD, email/password) |
| **Email** | Resend (transakčné + inbound) |
| **Monitoring** | Sentry (worker), Vercel Analytics (frontend) |
| **Deploy** | Docker Compose na VPS (89.185.250.213), frontend na Vercel |

---

## 3. Repository štruktúra

```
scripta/
├── docker-compose.yml          # Produkčný stack (7 kontajnerov)
├── Dockerfile.postgres         # PostgreSQL s pg_trgm, citext extenziami
├── .env.example                # Všetky env vars (šablóna)
│
├── frontend/                   # Next.js 15 (App Router)
│   ├── prisma/
│   │   └── schema.prisma       # Databázová schéma (27 modelov)
│   ├── src/
│   │   ├── app/
│   │   │   ├── (main)/         # Authenticated routes (dashboard, reports, screener, credits)
│   │   │   ├── (pub)/          # Public firma page (verifa.sk/firma/[ico-slug])
│   │   │   ├── (pub-de)/       # Nemecká lokalizácia (/de/firma/...)
│   │   │   ├── (pub-cs)/       # Česká lokalizácia
│   │   │   ├── (pub-hu)/       # Maďarská lokalizácia
│   │   │   ├── (pub-pl)/       # Poľská lokalizácia
│   │   │   ├── (pub-en)/       # Anglická lokalizácia
│   │   │   └── api/            # API routes (reports, billing, credits, cron, auth)
│   │   └── lib/                # Business logic (credits, billing, auth, worker client, i18n)
│   └── package.json
│
├── worker/                     # Python FastAPI worker
│   ├── src/
│   │   ├── main.py             # FastAPI app + report execution orchestrator (~850 lines)
│   │   ├── worker_arq.py       # ARQ worker (async task queue, Redis-backed)
│   │   ├── pipeline.py         # AI pipeline: extrakcia, analýza, scoring (~800 lines)
│   │   ├── verdict_builder.py  # Deterministic adjustment, ORSR forensic, fallback verdict
│   │   ├── analytics.py        # Altman Z'', Piotroski, financial ratios, scorecard v3
│   │   ├── report_scoring.py   # Insolvency score, fraud heatmap, strengths/weaknesses
│   │   ├── report_generator.py # HTML→PDF report (Jinja2 templates + Playwright)
│   │   ├── verdict_metrics.py  # Metric placeholders, YoY text, trend formatting
│   │   ├── config.py           # Pydantic Settings (env vars, model config, limits)
│   │   ├── db_client.py        # Prisma Python client
│   │   ├── db_repository.py    # DB queries (reports, companies, events, scoring)
│   │   ├── llm_orchestrator.py # safe_llm_call (retry, fallback, rate limit)
│   │   ├── extraction_cache.py # LLM response cache (pdfHash + model + promptVersion)
│   │   ├── pdf_ingestion.py    # PDF slicing (IFRS vs SK GAAP, notes, narrative)
│   │   ├── stealth.py          # Anti-bot: UA rotation, proxy, stealth JS
│   │   ├── browser_manager.py  # Browserless connection + circuit breaker
│   │   ├── i18n.py             # Report translations (sk, en, de, cs, hu, pl)
│   │   ├── s3_client.py        # S3/MinIO upload (optional)
│   │   ├── cleanup.py          # Auto-delete old reports, stuck report recovery
│   │   │
│   │   ├── agents/             # LLM agents (Gemini)
│   │   │   ├── chief_auditor.py       # Final verdict (6 jazykové verzie promptu)
│   │   │   ├── financial_analyst.py   # Extrakcia financií z PDF (IFRS/SK GAAP)
│   │   │   ├── narrative.py           # Naratívna analýza (text z PDF)
│   │   │   ├── notes_forensic.py      # Forenzná analýza poznámok (related party)
│   │   │   ├── pdf_reader.py          # Extrakcia company events z PDF príloh
│   │   │   ├── cross_analysis.py      # Krížová analýza (prepája finančné + právne)
│   │   │   ├── report_qa.py           # QA agent (quality check pred compile)
│   │   │   ├── orsr_forensic.py       # Deterministická ORSR analýza (regex, bez LLM)
│   │   │   ├── vestnik.py             # Extrakcia vestník udalostí
│   │   │   ├── staff_costs.py         # Extrakcia personálnych nákladov
│   │   │   ├── shared.py              # Gemini klient, key rotation, token tracking
│   │   │   └── prompt_common.py       # Zdieľané prompt fragmenty (6 jazykov)
│   │   │
│   │   ├── scrapers/           # 25 scraperov pre slovenské registre
│   │   │   ├── base.py                # BaseScraper (_get_page, _safe_goto, stealth)
│   │   │   ├── registry.py            # run_scrapers orchestrátor (semaphore, timeout, retry)
│   │   │   ├── orsr.py                # Obchodný register (httpx + Playwright fallback)
│   │   │   ├── registeruz.py          # RÚZ (API, JSON)
│   │   │   ├── obchodny_vestnik.py    # Obchodný vestník (API, XML)
│   │   │   ├── rpo.py                 # Register právnických osô (React SPA)
│   │   │   ├── fs.py + fs_*.py        # Finančná správa (7 sub-scrapers, zdieľajú server)
│   │   │   ├── sp_dlznici.py          # Slobodný program — dlžníci
│   │   │   ├── vszp_dlznici.py        # VšZP dlžníci
│   │   │   ├── dovera_dlznici.py      # Dôvera dlžníci
│   │   │   ├── union_dlznici.py       # UNION dlžníci
│   │   │   ├── poverenia.py           # Poverenia na exekúciu
│   │   │   ├── ncrzp.py               # Notársky register záložných práv
│   │   │   ├── ncrd.py                # Register diskvalifikovaných osô
│   │   │   ├── diskvalifikacie.py     # Register diskvalifikácií (justice.gov.sk)
│   │   │   ├── rpvs.py                # Register partnerov verejného sektora
│   │   │   ├── insolvency.py          # Register úpadcov (RKR)
│   │   │   ├── zrsr.py                # Živnostenský register
│   │   │   ├── crz.py                 # Central register zmlúv
│   │   │   ├── rozhodnutia.py         # Súdne rozhodnutia
│   │   │   └── uvo.py                 # Verejné obstarávanie (UVO)
│   │   │
│   │   ├── pdf/
│   │   │   └── compiler.py            # PdfCompiler (merge scraped PDFs + cover page)
│   │   ├── templates/                 # Jinja2 HTML templates pre PDF report
│   │   └── utils/                     # ORSR heuristics, helpers
│   │
│   ├── tests/                  # pytest (1363+ tests)
│   ├── AGENTS.md               # Scoring engine v3 freeze + Vestník pipeline docs
│   └── pyproject.toml
│
├── docs/                       # Dodatočná dokumentácia
└── ARCHITECTURE.md             # Tento súbor
```

---

## 4. Produkčný Docker stack

```
┌─────────────────────────────────────────────────────────────┐
│ Docker Compose (VPS 89.185.250.213)                         │
│                                                             │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐   │
│  │  frontend    │  │  worker      │  │  arq_worker      │   │
│  │  (Next.js)   │  │  (FastAPI)   │  │  (ARQ consumer)  │   │
│  │  :3000       │  │  :8000       │  │  :8011/health    │   │
│  └──────┬───────┘  └──────┬───────┘  └────────┬─────────┘   │
│         │                 │                    │             │
│         │   HTTP /tasks   │   Redis queue      │             │
│         ├────────────────►│───────────────────►│             │
│         │                 │                    │             │
│         │     ┌───────────┴──────────────┐     │             │
│         │     │                          │     │             │
│  ┌──────▼─────▼──┐  ┌──────────────┐  ┌──▼─────▼──┐         │
│  │  postgres     │  │  redis       │  │ browserless│         │
│  │  :5432        │  │  :6379       │  │ :3000      │         │
│  │  (verifa DB)  │  │  (ARQ queue) │  │ (Chromium) │         │
│  └───────────────┘  └──────────────┘  └────────────┘         │
│                                                             │
│  ┌──────────────┐  ┌──────────────┐                         │
│  │  db_backup   │  │  (S3/MinIO)  │  (optional, env-based)  │
│  │  (cron)      │  │              │                         │
│  └──────────────┘  └──────────────┘                         │
└─────────────────────────────────────────────────────────────┘
```

| Kontajner | Účel | Port |
|-----------|------|------|
| `verifa_frontend` | Next.js SSR + API routes | 3000 |
| `verifa_worker` | FastAPI — prijíma `/tasks` od frontendu | 8000 |
| `verifa_arq_worker` | ARQ worker — spracúva queue jobs z Redis | 8011 (health) |
| `verifa_postgres` | PostgreSQL 16 | 5432 (interný) |
| `verifa_redis` | Redis 7 (ARQ queue + cache) | 6379 (interný) |
| `verifa_browserless` | Headless Chromium (anti-bot stealth) | 3000 (interný) |
| `verifa_db_backup` | Cron pg_dump (denne) | — |

**Dôležité:** Frontend beží aj na **Vercel** (edge). Worker + DB + Redis + Browserless bežia na VPS. Frontend na Vercel komunikuje s workerom cez `WORKER_URL` env var.

---

## 5. Report generation — kompletný flow

Toto je hlavný proces aplikácie. Trvá **5–15 minút** na jeden report.

```
User klikne "Generovať report" (frontend)
         │
         ▼
┌──────────────────────────────────────────────────────────────┐
│ 1. FRONTEND (Next.js API route /api/reports)                  │
│    a. Auth check (getCurrentUser)                             │
│    b. Rate limit check                                        │
│    c. Credit check + consume (consumeCreditsTx)               │
│    d. Create ReportRequest v DB (status=PENDING)              │
│    e. enqueueReportTask → POST /tasks na worker               │
│    f. Return report ID (client polling)                       │
└──────────────────────────────────────────────────────────────┘
         │
         ▼
┌──────────────────────────────────────────────────────────────┐
│ 2. WORKER (FastAPI → ARQ queue)                               │
│    a. POST /tasks → enqueue do Redis (arq)                    │
│    b. ARQ worker picks up job → _execute_report()             │
│    c. Update status → PROCESSING                              │
└──────────────────────────────────────────────────────────────┘
         │
         ▼
┌──────────────────────────────────────────────────────────────┐
│ 3. SCRAPER FÁZA (main.py:255-410) — 2–5 min                   │
│    run_scrapers() spustí 25 scraperov paralelne:              │
│    • 5 browser slotov (global_semaphore)                      │
│    • Per-scraper timeout (60–180s)                            │
│    • Dependent scrapery čakajú na ORSR (persons[])            │
│    • Retry 5× s exponential backoff (2s, 5s, 15s, 30s, 60s)  │
│    • Browser health check pred každým retry                   │
│                                                               │
│    Scrapery:                                                  │
│    ├── ORSR (Obchodný register) — httpx + Playwright fallback │
│    ├── REGISTER_UZ (RÚZ) — API, JSON, finančné výkazy         │
│    ├── OBCHODNY_VESTNIK — API, XML, 365-day lookback          │
│    ├── RPO (Register právnických osô) — React SPA             │
│    ├── FINANCNA_SPRAVA + 7 sub-scrapers — daňové registre     │
│    ├── SP/VSZP/DOVERA/UNION dlžníci — zdravotné poisťovne     │
│    ├── POVERENIA — exekučné poverenia                         │
│    ├── NCRZP — notársky register záložných práv               │
│    ├── NCRD/DISKVALIFIKACIE — register diskvalifikácií        │
│    ├── RPVS — register partnerov verejného sektora            │
│    ├── INSOLVENCY — register úpadcov (RKR)                    │
│    ├── ZRSR — živnostenský register                           │
│    ├── CRZ — central register zmlúv                           │
│    ├── ROZHODNUTIA — súdne rozhodnutia                        │
│    └── UVO — verejné obstarávanie                             │
│                                                               │
│    Výstup: list[ScrapedSource] s statusom SUCCESS/FAILED/     │
│    UNAVAILABLE + PDF súbory v results/<report_id>/            │
└──────────────────────────────────────────────────────────────┘
         │
         ▼
┌──────────────────────────────────────────────────────────────┐
│ 4. AI PIPELINE (pipeline.py) — 1–3 min, paralelne so scrapermi│
│                                                               │
│    4a. PDF INGESTION (pdf_ingestion.py)                       │
│        ├── IFRS firmy: extrakcia z PDF (50+ polí, LLM)        │
│        ├── SK GAAP firmy: tabuľky z RÚZ JSON + PDF poznámky   │
│        └── Cache: ExtractionCache (pdfHash + model + version) │
│                                                               │
│    4b. LLM EXTRAKCIA (agents/financial_analyst.py)            │
│        ├── FinancialAnalyst: 50+ finančných polí z PDF        │
│        ├── Narrative: riziká z naratívneho textu              │
│        ├── NotesForensic: related party, off-balance          │
│        ├── Vestnik: štruktúrované udalosti z vestníka         │
│        └── StaffCosts: personálne náklady                     │
│                                                               │
│    4c. PDF READER AGENT (agents/pdf_reader.py) — paralelne    │
│        ├── Extrakcia CompanyEvents z PDF príloh               │
│        ├── Súdne rozhodnutia, exekúcie, daňové nedoplatky     │
│        └── Uloženie do DB (CompanyEvent table)                │
│                                                               │
│    4d. ORSR FORENSIC AGENT (verdict_builder.py) — paralelne   │
│        ├── Deterministická analýza Úplného výpisu (regex)     │
│        ├── Počet zmien štatutárov, sídla                      │
│        ├── Virtuálne sídlo, zahraničný štatutár               │
│        ├── Historický konkurz/reštrukturalizácia scan         │
│        └── CompanyEvent(FORENSIC_ANALYSIS) → DB               │
└──────────────────────────────────────────────────────────────┘
         │
         ▼
┌──────────────────────────────────────────────────────────────┐
│ 5. SCORING (analytics.py + verdict_builder.py)                │
│                                                               │
│    5a. FORENSIC SCORECARD v3 (analytics.py)                   │
│        Deterministický model 5 pilierov (FROZEN):             │
│        ├── P1: Solventnosť a exekúcie (max 30b)               │
│        ├── P2: Finančné zdravie — Altman Z'' + Piotroski (25b)│
│        ├── P3: Ziskovosť a stabilita (20b)                    │
│        ├── P4: Rast a trendová sila (15b)                     │
│        ├── P5: Právna bezúhonnosť (10b)                       │
│        └── NACE-weighted (obchod vs. výroba vs. služby)       │
│        → algorithmic_prescore (0–100)                         │
│                                                               │
│    5b. DETERMINISTIC ADJUSTMENT (verdict_builder.py:385)      │
│        Konvertuje LLM nálezy na penalizácie:                  │
│        ├── going_concern_doubts → -3                          │
│        ├── litigation_risks → -2                              │
│        ├── related_party_transactions → -2 (non-consol only)  │
│        ├── contingent_risks → -2                              │
│        ├── CompanyEvent CRITICAL → -3 each (max -6)           │
│        ├── Aktívne poverenie na exekúciu → -15 (mimo cap)     │
│        ├── equity_decline -50%+ → -2                          │
│        ├── Cap: -5 (poverenia penalty mimo cap)               │
│        → deterministic_adjustment (-15 to +0)                 │
│                                                               │
│    5c. ORSR OVERRIDE (verdict_builder.py:355)                 │
│        Ak Chief Auditor nastaví white_horse_risk_dismissed,   │
│        refunduje ORSR penalizáciu (max 15b)                   │
│                                                               │
│    5d. FINAL SCORE                                            │
│        verifaScore = algorithmic_prescore                     │
│                    + deterministic_adjustment                 │
│                    + orsr_override_refund                     │
│        Kategórie: AAA (90+), A (70-89), B (40-69), C (0-39)   │
│                                                               │
│    ⚠️ llm_score_adjustment je INFORMATÍVNY — neovplyvňuje     │
│       finálne skóre. Je to len signalizácia od Chief Auditora.│
└──────────────────────────────────────────────────────────────┘
         │
         ▼
┌──────────────────────────────────────────────────────────────┐
│ 6. CHIEF AUDITOR (agents/chief_auditor.py) — 30–90s           │
│    LLM syntetizuje všetky nálezy do AuditVerdict:             │
│    ├── executive_summary (2–3 vety)                           │
│    ├── executive_sections (4–5 sekcií s odrážkami)            │
│    ├── zdovodnenie (list[EvidenceItem] — dôkazy)              │
│    ├── final_verdict (CRITICALLY RISKY / RISKY / STABLE / OK) │
│    ├── verifa_score = algorithmic_prescore (BEZ zmeny)        │
│    ├── llm_score_adjustment (informative, -10 to +10)         │
│    ├── risk_category (AAA/A/B/C z finálneho skóre)            │
│    ├── white_horse_risk_dismissed (bool)                      │
│    └── debt_exposure_rating (0–10)                            │
│                                                               │
│    Expert Mode: 2-pass (draft → refine na Pro 3.1)            │
│    Standard Mode: 1-pass na Flash 3.7                         │
│                                                               │
│    Prompty v 6 jazykoch: SK, EN, DE, CS, HU, PL               │
│    (prompt_common.py — zdieľané fragmenty)                    │
└──────────────────────────────────────────────────────────────┘
         │
         ▼
┌──────────────────────────────────────────────────────────────┐
│ 7. CROSS-ANALYSIS + QA (agents/cross_analysis.py, report_qa)  │
│    ├── Cross-Analysis: krížové prepájanie indikátorov         │
│    │   ("X je pozitívne, ALE Y to komplikuje → Z")            │
│    ├── QA Agent: kontrola disproporcií pred compile           │
│    │   ├── CRITICAL discrepancies → re-run Chief Auditor      │
│    │   └── WARNING discrepancies → log + pokračuj             │
│    └── Re-run trigger: nové vestník events, nové výkazy,      │
│        verdict > 90 dní                                       │
└──────────────────────────────────────────────────────────────┘
         │
         ▼
┌──────────────────────────────────────────────────────────────┐
│ 8. PDF COMPILE (report_generator.py + pdf/compiler.py)        │
│    ├── Cover page (HTML→PDF cez Playwright)                   │
│    ├── Forenzný posudok (Jinja2 template → HTML → PDF)        │
│    │   ├── Executive summary + sekcie                         │
│    │   ├── Finančné tabuľky (5-ročné trendy)                  │
│    │   ├── Grafy (Plotly: revenue, balance, P&L, cashflow,    │
│    │   │   ratios, radar, Altman, employees)                  │
│    │   ├── Infografiky (PL infographic, balance sheet,        │
│    │   │   cashflow waterfall)                                │
│    │   ├── Scorecard breakdown (5 pilierov)                   │
│    │   ├── Fraud heatmap                                      │
│    │   └── Registry status summary                            │
│    ├── Prílohy (scraped PDFs s overlay nadpismi)              │
│    └── Merge všetkých → evidence_binder.pdf                   │
│                                                               │
│    Výstup: results/<report_id>/evidence_binder.pdf            │
│    Upload: S3/MinIO (ak je nastavené) alebo lokálny disk      │
└──────────────────────────────────────────────────────────────┘
         │
         ▼
┌──────────────────────────────────────────────────────────────┐
│ 9. FINALIZE (main.py)                                         │
│    ├── Update ReportRequest status → COMPLETED/PARTIAL/FAILED │
│    ├── Save AuditVerdict, ScoringSnapshot do DB               │
│    ├── Save phase durations (scrapers, ai, auditor, compile)  │
│    ├── Token cost summary (Gemini API cost tracking)          │
│    ├── Refund credits ak FAILED (refundCredits)               │
│    └── Frontend polling → zobrazí report                      │
└──────────────────────────────────────────────────────────────┘
```

### Statusy reportu

| Status | Význam |
|--------|--------|
| `PENDING` | Vytvorený, čaká na enqueue |
| `PROCESSING` | Worker spracúva (scrapers → AI → compile) |
| `COMPLETED` | Všetky zdroje SUCCESS, PDF vygenerované |
| `PARTIAL` | Niektoré zdroje FAILED/UNAVAILABLE, ale PDF vygenerované |
| `FAILED` | Kritická chyba (ORSR not found, compile error, etc.) — credit refund |

---

## 6. Scoring Engine v3 (FROZEN)

**Stav:** Architektúra zmrazená od 2026-08-20. Ďalšie zmeny sú kalibrácia, nie architektúra.

### 5 pilierov

| Pilier | Max | Čo meria |
|--------|-----|----------|
| **P1: Solventnosť a exekúcie** | 30 | Bežná likvidita, vlastný kapitál, kritické vestník udalosti |
| **P2: Finančné zdravie** | 25 | Altman Z'' (BEZPEČNÉ/ŠEDÁ/ÚPADEK) + Piotroski F-Score, hierarchický fallback |
| **P3: Ziskovosť a stabilita** | 20 | Počet ziskových rokov, po sobe idúce straty, čistá marža |
| **P4: Rast a trendová sila** | 15 | CAGR tržieb, YoY rast equity, pokles tržieb |
| **P5: Právna bezúhonnosť** | 10 | Váha vestník udalostí, výrok audítora |

### Kľúčové pravidlá

1. **Score ≠ Confidence** — Score = čo vieme o firme. Confidence = ako spoľahlivo to vieme.
2. **N/A ≠ 0** — Chýbajúce dáta = "nemožno posúdiť", nie "finančne zlé".
3. **P2 hierarchický scoring**:
   - Tier 1: Altman Z'' + Piotroski (plné dáta)
   - Tier 2: Ratio-based fallback (ROA, equity/TA, D/E, CR)
   - Tier 3: Data void (minimum)
4. **Vestník single-counting** — Penalizuje sa len v P5, nie v P1-P4.
5. **Deterministic adjustment clamp** — Max -5 (poverenia -15 mimo cap).
6. **LLM adjustment je informatívny** — `llm_score_adjustment` sa NEpričíta k skóre.

### NACE weighting

Rôzne odvetvia majú rôzne štrukturálne vlastnosti (velkoobchod = nízka marža, vysoké D/E). Scorecard aplikuje NACE-dependent váhy na piliere.

### Validácia

- 170/170 unit testov pass
- 35/35 adversarial audit pass, 0 HIGH
- 12 575 firiem scored, 0 errors
- 11/11 decile metrics monotonic
- Distribúcia: Mean 58.0, Median 61, AAA 0%, A 26.3%, B 59.4%, C 14.2%

---

## 7. Databázová schéma

PostgreSQL, 27 Prisma modelov. Schéma v `frontend/prisma/schema.prisma`.

### Kľúčové tabuľky

| Tabuľka | Účel | Kľúčové polia |
|---------|------|---------------|
| **User** | Auth + profil | email, role, walletId |
| **ReportRequest** | Report job | ico, status, userId, reportLanguage, sources[] |
| **ReportSource** | Per-source status v reporte | reportRequestId, sourceType, status, pageCount |
| **Company** | Firma z RPO/ORSR | ico, name, legalStatus, legalStatusSource, orsrSyncedAt |
| **CompanyPerson** | Ľudia z ORSR | ico, rawName, role, functionStart, isActive |
| **FinancialStatement** | Účtovná závierka | ico, year, assets, equity, revenue, profit, ... |
| **VestnikEvent** | Udalosť z Vestníka | companyIco, eventType, severity, publishedAt |
| **CompanyEvent** | Forenzná udalosť (z PDF/ORSR) | ico, source, eventType, severity, title |
| **NarrativeRiskAnalysis** | LLM naratívna analýza | ico, year, goingConcernDoubts, litigationRisks, ... |
| **NotesRiskAnalysis** | LLM forenzná analýza poznámok | ico, year, relatedPartyTransactions, ... |
| **AuditVerdict** | Chief Auditor verdikt | ico, verifaScore, riskCategory, executiveSummary, ... |
| **ScoringSnapshot** | Scorecard breakdown | ico, pillars[], adjustment, finalScore |
| **CreditBatch** | Nákup kreditov | userId, amount, remaining, source, expiresAt |
| **Wallet** | Peňaženka používateľa | userId, balance |
| **WalletTransaction** | Transakcia (debit/credit) | walletId, amount, type, reportRequestId |
| **WatchedCompany** | Sledovaná firma (alerts) | userId, ico, alertConfig |
| **AlertEvent** | Alert udalosť | watchedCompanyId, eventType, severity |
| **VestnikSyncCheckpoint** | Vestník sync state | lastId, lastRunSuccess, lastProcessedSince |

### Dátové toky

```
RPO dump (XML)  ────────►  Company (518 642 firiem)
                              │
ORSR bulk scrape ──────────►  Company.legalStatus, CompanyPerson (1.3M)
  (515 907 firiem, 15h)        │
                              │
RÚZ API ──────────────────►  FinancialStatement (per-report, WAF-blocked)
                              │
Vestník API ──────────────►  VestnikEvent (4 790 events, 3 146 firiem)
  (76 strán, 365-day)          │
                              │
Report generation ────────►  NarrativeRiskAnalysis, NotesRiskAnalysis,
                              AuditVerdict, ScoringSnapshot, CompanyEvent
```

---

## 8. Scraping infraštruktúra

### 25 scraperov

| Scraper | Zdroj | Spôsob | Timeout |
|---------|-------|--------|---------|
| ORSR | orsr.sk | httpx + Playwright fallback | 60s |
| REGISTER_UZ | registeruz.sk | API (JSON) | 60s |
| OBCHODNY_VESTNIK | datahub.ekosystem.slovensko.digital | API (XML) | 90s |
| RPO | rpvs.gov.sk | Playwright (React SPA) | 180s |
| FINANCNA_SPRAVA + 7 sub | finstat.sk/fs | Playwright (zdieľajú server, semafor 3) | 150s |
| SP/VSZP/DOVERA/UNION | 4 zdravotné poisťovne | Playwright | 180s |
| POVERENIA | poverenia.justice.sk | Playwright | 120s |
| NCRZP | ncrzp.sk | Playwright | 120s |
| NCRD | ncrd.justice.sk | Playwright | 120s |
| DISKVALIFIKACIE | justice.gov.sk | Playwright (dependent na ORSR) | 120s |
| RPVS | rpvs.gov.sk | Playwright | 90s |
| INSOLVENCY | rkr.justice.sk | Playwright | 90s |
| ZRSR | zrsr.sk | Playwright | 90s |
| CRZ | crz.gov.sk | Playwright | 90s |
| ROZHODNUTIA | rozhodnutia.justice.sk | Playwright | 45s |
| UVO | uvo.gov.sk | Playwright | 90s |

### Anti-bot ochrana

- **Stealth JS** — `navigator.webdriver`, plugins, languages, WebGL, CDP signs
- **User-Agent rotation** — náhodné UA pri každom browser context
- **Proxy rotation** — voliteľné cez `PROXY_LIST` env var (round-robin)
- **Browserless** — `stealth=1` + `launch` args (`--disable-blink-features=AutomationControlled`)
- **F5 anti-bot fallback** — ORSR: httpx → ak F5 deteguje, fallback na Playwright

### Známe blokády (F5 BIG-IP / Cloudflare)

| Zdroj | Stav | Riešenie |
|-------|------|----------|
| RÚZ (registeruz.sk) | WAF-blocked z VPS | Treba proxy alebo bežať z inej IP |
| Finstat.sk | Cloudflare block | Treba proxy |
| UVO (uvo.gov.sk) | F5 BIG-IP 403 | Treba proxy alebo whitelist IP |

### Retry logika

```
Initial scrape (300s global timeout)
  ↓
Retry loop (5 passov, exponential backoff):
  Pass 1: 2s delay
  Pass 2: 5s delay
  Pass 3: 15s delay
  Pass 4: 30s delay
  Pass 5: 60s delay
  ↓
Total retry budget: 600s (vrátane scraper execution)
Retry len UNAVAILABLE a TIMEOUT (network issues), nie FAILED (interné chyby)
```

---

## 9. AI pipeline — LLM agenti

### Model konfigurácia

| Agent | Model (Standard) | Model (Expert) | Účel |
|-------|------------------|----------------|------|
| FinancialAnalyst | gemini-3.7-flash | gemini-3.7-flash | Extrakcia 50+ polí z PDF |
| Narrative | gemini-3.7-flash | gemini-3.7-flash | Naratívna analýza rizík |
| NotesForensic | gemini-3.7-flash | gemini-3.7-flash | Related party, off-balance |
| Vestnik | gemini-3.5-flash-lite | gemini-3.5-flash-lite | Štruktúrovaná extrakcia |
| CrossAnalysis | gemini-3.7-flash | gemini-3.7-flash | Krížová analýza |
| ChiefAuditor | gemini-3.7-flash | **gemini-3.1-pro-preview** | Finálny verdikt (2-pass) |
| ReportQA | gemini-3.5-flash-lite | gemini-3.7-flash | Quality check |
| Fallback | gemini-3.5-flash → 3.5-flash-lite | — | Pri 404/503/429 |

### LLM orchestrácia (`llm_orchestrator.py`)

- `safe_llm_call()` — retry s exponential backoff (5s, 15s, 30s)
- Multi-key rotation (`GEMINI_API_KEYS` env var, comma-separated)
- Key failure tracking + automatic failover
- Token cost tracking (per-model pricing v `config.py`)
- Global semaphore (10 concurrent LLM calls)

### Extraction Cache (`extraction_cache.py`)

IFRS firmy (template 709/703) nemajú RÚZ JSON tabuľky — všetko sa extrahuje z PDF cez LLM. Cache garantuje determinizmus:

- Cache key: `pdfHash + extractor + model + promptVersion + schemaVersion`
- HIT → return cached (0 LLM calls)
- MISS → call LLM, store, return
- Invalidation: bump `PROMPT_VERSION` alebo `SCHEMA_VERSION`

### Chief Auditor prompty

6 jazykových verzií (SK, EN, DE, CS, HU, PL) v `agents/chief_auditor.py`. Zdieľané fragmenty v `agents/prompt_common.py`:
- `COMMON_FORENSIC_RULES` — pravidlá pre sektorové kontexty, cash flow, ORSR anomálie
- `COMMON_BUT_PATTERNS` — krížové vzorce "ALE" (X pozitívne, ALE Y komplikuje)
- `COMMON_TEXT_QUALITY_RULES` — pravidlá pre jazykovú kvalitu textu

**Kritické:** `llm_score_adjustment` je v promptoch označený ako INFORMATIVNÝ — NEpričíta sa k finálnemu skóre. Finálne `verifaScore` je deterministické.

---

## 10. Frontend

### Route skupiny

| Route | Auth | Účel |
|-------|------|------|
| `/` | Public | Landing page |
| `/dashboard` | Required | Prehľad reportov, štatistiky |
| `/dashboard/[ico]` | Required | Detail firmy |
| `/reports` | Required | Zoznam reportov |
| `/screener` | Required | Filter firiem podľa skóre, odvetvia, kraja |
| `/firmy` | Required | Zoznam sledovaných firiem |
| `/credits` | Required | Nákup kreditov, billing |
| `/pricing` | Public | Cenník |
| `/firma/[ico-slug]` | Public | Verejná stránka firmy (SEO, 6 jazykov) |
| `/admin` | Admin | Admin panel |
| `/api/*` | Mixed | API routes |

### API routes

| Route | Účel |
|-------|------|
| `POST /api/reports` | Vytvor report (enqueue na worker) |
| `GET /api/reports/[id]` | Stav reportu (polling) |
| `POST /api/billing/checkout` | Paddle checkout |
| `POST /api/billing/webhook` | Paddle webhook |
| `GET /api/credits/plan` | Aktuálny plán |
| `POST /api/credits/expire` | Expirácia kreditov (cron) |
| `GET /api/company/[ico]` | Detail firmy z DB |
| `GET /api/cron/vestnik-ingest` | Vestník sync (cron) |
| `GET /api/cron/reseed-all` | Re-seed DB z RÚZ/ORSR (cron) |
| `GET /api/cron/monitoring-check` | Health check alerting |

### Billing

- **Paddle** ako payment provider (sandbox/production)
- Credit-based system: 1 credit = 1 report
- Credit sources: `trial` (30d expiry), `subscription` (60d), `addon` (permanent), `rollover` (60d)
- Refund pri FAILED reporte (`refundCredits`)
- Wallet model: `Wallet.balance` = `SUM(CreditBatch.remaining)`
- Negative balance handling: ak user má debt (chargeback po spend), nový batch najprv vyrovná debt

---

## 11. Cron jobs

| Job | Frekvencia | Účel |
|-----|------------|------|
| Vestník ingest | Denne | Sync nových vestník udalostí (365-day lookback) |
| Re-seed all | Týždenne | Re-seed DB z RÚZ + ORSR (518k firiem) |
| Monitoring check | každých 5 min | Health check alerting (stuck reports, DB, worker) |
| Credit expiry | Denne | Expirácia trial/subscription kreditov |
| Report cleanup | Hodinove (worker) | Auto-delete reporty > 30 dní, stuck recovery (> 60 min) |
| DB backup | Denne | pg_dump → S3/local |

---

## 12. Multi-language

Reporty sa generujú v **6 jazykoch**: SK, EN, DE, CS, HU, PL.

| Vrstva | Implementácia |
|--------|---------------|
| Frontend public pages | Next.js App Router route groups `(pub-de)`, `(pub-cs)`, etc. |
| Report PDF | Jinja2 templates + `i18n.py` (get_i18n_strings) |
| Chief Auditor prompt | 6 verzií v `chief_auditor.py` + zdieľané v `prompt_common.py` |
| Grafy | Plotly `lang` parameter |
| AI extrakcia | `report_language` parameter v pipeline |

---

## 13. Environment variables

Kompletný zoznam v `.env.example`. Kľúčové:

| Var | Required | Účel |
|-----|----------|------|
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `REDIS_URL` | Yes | Redis connection (ARQ queue) |
| `WORKER_SECRET` | Prod | Shared secret frontend↔worker |
| `CRON_SECRET` | Prod | Auth pre cron API routes |
| `GEMINI_API_KEYS` | Yes | Google Gemini API keys (comma-separated, rotation) |
| `BROWSERLESS_TOKEN` | No | Browserless auth token |
| `PROXY_LIST` | No | Proxy rotation (pre anti-bot block) |
| `EXPERT_MODE` | No | `1` = Chief Auditor na Pro 3.1 (2-pass) |
| `SENTRY_DSN` | No | Sentry error tracking |
| `PADDLE_*` | Prod | Paddle billing config |
| `S3_*` | No | S3/MinIO pre report storage |
| `RESEND_API_KEY` | No | Email transakcie |

---

## 14. Build & deploy

### Lokálny dev

```bash
# Frontend
cd frontend && npm install && npm run dev

# Worker
cd worker && pip install -e . && uvicorn src.main:app --reload

# Docker (full stack)
docker compose up -d
```

### Produkčný deploy

```bash
# 1. Push na GitHub
git push origin master

# 2. SSH na VPS, pull + rebuild + restart
ssh root@89.185.250.213
cd /var/www/verifa
git pull origin master
docker compose build worker
docker compose up -d worker arq_worker

# 3. Frontend auto-deploy na Vercel (GitHub integration)
```

### Testy

```bash
cd worker

# Unit tests (1363+ tests)
.venv/bin/python -m pytest tests/ -q

# Scoring engine tests
.venv/bin/python -m pytest tests/test_forensic_scorecard.py tests/test_analytics.py -x

# Adversarial audit (35 checks)
.venv/bin/python -m tests.adversarial_scoring_audit

# Scraper integration tests (live, pomalé)
.venv/bin/python -m pytest tests/test_scrapers.py -q
```

---

## 15. Kľúčové súbory pre orientáciu

Ak chceš rýchlo zmeniť niečo konkrétne, začni tu:

| Chcem zmeniť... | Súbor |
|-----------------|-------|
| Scoring model | `worker/src/analytics.py` (compute_forensic_scorecard_v3) |
| Deterministic adjustment | `worker/src/verdict_builder.py` (_compute_deterministic_adjustment) |
| Chief Auditor prompt | `worker/src/agents/chief_auditor.py` + `prompt_common.py` |
| Pridať/opraviť scraper | `worker/src/scrapers/<name>.py` + `registry.py` |
| Report template (PDF) | `worker/src/templates/` (Jinja2 HTML) |
| Report generation flow | `worker/src/main.py` (_execute_report) |
| AI pipeline | `worker/src/pipeline.py` (process_company) |
| LLM model config | `worker/src/config.py` (Settings) |
| DB schéma | `frontend/prisma/schema.prisma` |
| Frontend API route | `frontend/src/app/api/<route>/route.ts` |
| Billing/credits | `frontend/src/lib/credits.ts` + `pricing-plans.ts` |
| Auth | `frontend/src/lib/auth.ts` |
| Worker client | `frontend/src/lib/worker.ts` |
| i18n strings | `worker/src/i18n.py` + `frontend/src/lib/i18n/` |

---

## 16. Gotchas & známe problémy

1. **RÚZ API je WAF-blocked z VPS** — finančné výkazy sa stiahnu len ak beží z inej IP (proxy alebo lokálne). Pre-existing data v DB je z predchádzajúcich importov.

2. **UVO je F5 BIG-IP blocked** — 403 Forbidden z VPS IP. Treba proxy.

3. **Browserless `launch` param** — Musí byť base64-encoded JSON, nie URL-encoded. Formát: `launch=base64({"args":["--disable-blink-features=AutomationControlled"]})`.

4. **`llm_score_adjustment` je informatívny** — NEpričíta sa k `verifaScore`. Toto je častý zdroj zmätku. Finálne skóre je `algorithmic_prescore + deterministic_adjustment + orsr_override_refund`.

5. **Scoring engine v3 je FROZEN** — Architektúra sa nemení. Iba kalibrácia. Detaily v `worker/AGENTS.md`.

6. **Vestník lookback = 365 dní** — Staršie udalosti sa nezachytia. ORSR Forensic Agent skenuje Úplný výpis pre historické konkurzy ako fallback.

7. **ExtractionCache** — Pre IFRS firmy sa LLM výsledky cachujú podľa `pdfHash + model + promptVersion`. Bump `PROMPT_VERSION` v `extraction_cache.py` pri zmene promptu.

8. **ARQ worker vs FastAPI** — `verifa_worker` (FastAPI) prijíma `/tasks`, `verifa_arq_worker` (ARQ) spracúva queue. Obe zdieľajú `src/main.py` logiku. Locky (`_scraper_lock`, `_pdf_lock`) sa inicializujú v `worker_arq.py:startup()`.

9. **Prisma Python client** — Worker používa `prisma` (Python), frontend `@prisma/client` (Node). Schéma je jedna (`frontend/prisma/schema.prisma`), ale Python client ju introspektuje z DB (nie zo súboru).

10. **`db push` workflow** — Project nepoužíva `prisma migrate` pre worker tabuľky. `ExtractionCache` bola vytvorená cez raw SQL. Pre frontend sa používa `prisma db push`.

---

*Posledná aktualizácia: 2026-09-01*
