# Scripta.sk — B2B Legal-Tech SaaS Skeleton

Automatizovaná príprava `Evidence Binder` (zlúčené PDF výpisy zo štátnych registrov + titulná strana s nálezmi) pre advokátov.

## Architektúra

```
┌─────────────┐     ┌──────────────┐     ┌─────────────────────┐
│  Next.js    │────▶│   Python     │────▶│   PostgreSQL +      │
│  App Router │     │   Worker     │     │   Prisma ORM        │
│  (UI + API) │◄────│ (FastAPI)    │◄────│   Wallet / Reports  │
└─────────────┘     └──────────────┘     └─────────────────────┘
                           │
                           ▼
                   ┌──────────────┐
                   │   Playwright │
                   │   Scrapers   │
                   └──────────────┘
```

## Tech Stack

- **Frontend / API**: Next.js 14 App Router, TypeScript, TailwindCSS
- **ORM / DB**: Prisma + PostgreSQL
- **RPA Worker**: Python, FastAPI, Playwright
- **PDF**: ReportLab (cover page), PyPDF2 (merge), `pdfcpu` / `PyPDF2` signing (timestamp placeholder)
- **Queue**: FastAPI `BackgroundTasks` (jednoduchý variant); možnosť nahradiť za Celery + Redis
- **Platby**: Stripe (dobíjanie kreditovej peňaženky)

## Flow

1. Právnik zadá IČO / Meno+Priezvisko+Dátum narodenia.
2. Systém vypočíta kreditový náklad podľa zvolených registrov.
3. API strhne kredity z peňaženky atomicky cez `WalletTransaction`.
4. API pošle úlohu workerovi.
5. Worker spustí scrapery pre každý register. Ak register spadne, zdroj sa označí ako `UNAVAILABLE` a report pokračuje.
6. Worker vygeneruje Cover Page so semaformi a zlúči všetky dostupné PDF.
7. Worker uloží finálne PDF a aktualizuje `ReportRequest` so `resultUrl`.

## Štruktúra

- `frontend/` — Next.js aplikácia s Prisma a API
- `worker/` — Python FastAPI worker, scrapery, PDF compiler

## Poznámky k implementácii

- **Scrapery**: `OrsrScraper` je plnootočená šablóna so všetkými helpers. Selektory a URL ORSR je potrebné doladiť podľa aktuálnej verzie štátneho webu. Šablóna zvláda fallback `print-to-pdf` ak register neponúka priamy download.
- **Časová pečiatka**: V skeletoni sa pridáva do PDF metadata. Na produkciu nahraď digitálnym časovým pečiatkovaním cez TSA (napr. `pdfcpu` + RFC 3161).
- **Nedostupný register**: Každý scraper beží v samostatnej úlohe. Výpadok jedného registra (timeout / 5xx) sa prevedie na `UNAVAILABLE` a report pokračuje — na Cover Page sa zobrazí oranžový status.
- **Kredity**: Cena platených zdrojov (aktuálne CRE = 5 kreditov) je definovaná v `frontend/src/app/api/reports/schema.ts`. Worker priamo neúčtuje, iba aktualizuje výsledky zdrojov.

## Inštalácia

### Frontend

```bash
cd frontend
npm install
npx prisma generate
npx prisma migrate dev
npm run dev
```

### Worker

```bash
cd worker
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
playwright install chromium
python -m worker.src.main
```

> Poznámka: Worker beží na `http://localhost:8000`. Next.js API ho volá cez `WORKER_URL` env premennú.
