# Verifa.sk - Architektúra a Roadmapa (MVP)

Tento dokument sumarizuje implementovanú architektúru MVP (Minimum Viable Product) projektu Verifa.sk a navrhuje ďalšie kroky pre škálovanie a vylepšovanie platformy.

## 🎯 Vízia: Forenzný nástroj
Verifa.sk slúži analytikom, advokátom a audítorom na hĺbkové preverovanie obchodných partnerov. Využíva AI na získanie kritických štruktúrovaných informácií z neštruktúrovaných a ťažko čitateľných formátov (skenované PDF výkazy, voľný text v Obchodnom vestníku).

---

## 🛠 Aktuálna Architektúra (MVP)

### 1. Backend (Python Worker)
Srdce extrakčného procesu. Zastrešuje získavanie dát a sémantickú analýzu.
- **Získavanie PDF:** Sťahovanie naskenovaných IFRS účtovných závierok (Playwright/HTTP).
- **Získavanie XML:** Parsovanie štruktúrovaného XML feedu Obchodného vestníka (OpenData/MV SR).
- **PDF Slicing (`pdf_ingestion.py`):** Modul na inteligentné orezávanie PDF dokumentov (napr. prvých 15 strán) s cieľom eliminovať "balast" a optimalizovať tokeny pre AI.
- **Multimodal AI Extraction (`llm_extractor.py`):** Prepojenie na **Google Gemini File API (v1beta)**. Prekladá obrázky a voľné texty na prísne validované Pydantic štruktúry:
  - `CompanyFinancialExtraction` (Zisk, aktíva, tržby, stanovisko audítora).
  - `VestnikExtraction` (Kategorizácia, red flags, severity).

### 2. Databáza & ORM (Prisma)
"Single Source of Truth" pre celý projekt.
- Použitá `schema.prisma` pre generovanie klientov ako pre backend (`prisma-client-python`), tak aj pre frontend (`@prisma/client`).
- Obsahuje modely ako `Company`, `FinancialStatement`, `AuditorOpinion`, `VestnikEvent`.
- Využitie `upsert` a nested writes pre atomické zápisy a odolnosť voči pádom.

### 3. Frontend (Next.js App Router)
Elegantné, moderné používateľské rozhranie pre okamžitý "Aha-moment" koncových používateľov.
- Založené na Tailwind CSS s **Glassmorphism** dizajnom a pútavou typografiou.
- Využíva Server Components (priame dopytovanie Prismy) pre nulový load-state.
- **Dashboard UI:** Zobrazuje "Metric Cards", vizualizáciu historických trendov cez `recharts` a pulzujúce výstrahy v sekcii "Forenzné Varovania (Red Flags)".

---

## 🚀 Budúce Kroky & Škálovanie

### 1. Robustnejší Error Handling v Python Pipeline
- Implementovať retry-logic pre API volania na Gemini s fallbackom.
- V prípade nemožnosti prečítať PDF alebo poškodeného XML záchyt výnimky a vytvorenie `FailedExtractionEvent` záznamu pre monitoring.

### 2. Nasadenie a Orchestrácia
- Využitie predpripraveného `Dockerfile` pre Worker. Worker môže byť zabalený a nasadený do **Google Cloud Run** alebo AWS ECS s prepojením na frontu (napr. Celery / RabbitMQ / Cloud Tasks).
- Frontend nasadiť na **Vercel** kvôli bezšvovej optimalizácii SSR komponentov.

### 3. Batch Processing
- Vytvorenie UI sekcie, kde analytik nahrá CSV súbor s desiatkami/stovkami IČO kódov.
- Asynchrónne spracovanie a následné notifikácie pri dokončení analýzy celého portfólia (napr. e-mailom).

### 4. Ďalšie Zdroje pre Forenznú Analytiku
- **Register Úpadcov / Insolvenčný register:** Automatická detekcia bankrotov spriaznených osôb.
- **Koneční užívatelia výhod (RPVS):** Analýza vlastníckej štruktúry a previazaností ("grafová databáza" vzťahov).
- **Zoznamy dlžníkov:** Finančná správa, Sociálna poisťovňa, Zdravotné poisťovne.
