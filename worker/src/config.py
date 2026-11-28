from __future__ import annotations
from datetime import date
from typing import Optional
from pydantic_settings import BaseSettings, SettingsConfigDict
from pathlib import Path


class Settings(BaseSettings):
    app_env: str = "development"
    database_url: str = "postgresql://user:password@localhost:5432/scripta"
    results_dir: Path = Path("./results")
    web_concurrency: int = 4
    playwright_headless: bool = True
    playwright_timeout: int = 60_000
    scraper_retries: int = 2
    scraper_retry_delay: float = 1.5
    # Debug screenshoty počas scrapovania — vypnuté v produkcii (spomaľujú a zapisujú na disk)
    debug_screenshots: bool = False

    # Cleanup — mazanie starých lokálnych scratch adresárov (DB + S3 PDF sa nikdy nemažú)
    cleanup_max_age_days: int = 30          # lokálne scratch súbory staršie ako X dní sa zmažú
    cleanup_max_reports_per_user: int = 50  # deprecated (P0.4 retention: užívateľské reporty sa nemažú)
    cleanup_interval_hours: int = 1         # ako často beží cleanup loop (1h — častejšie pre stuck recovery)
    stale_report_threshold_minutes: int = 60  # reporty v PROCESSING dlhšie ako X min → FAILED + refund

    # Shared-secret medzi Next.js API a workerom (voliteľné v dev; povinné v produkcii)
    worker_secret: Optional[str] = None

    # Proxy rotation — pre anti-detekciu (voliteľné)
    # Formát: "http://user:pass@host:port" alebo "http://host:port"
    # Viacero proxy oddelených čiarkou — round-robin medzi scrapermi
    proxy_list: Optional[str] = None

    # ── Expert Mode ────────────────────────────────────────────────────────────
    # EXPERT_MODE=1 → Chief Auditor na Gemini 4 Hydrogen (thinking XHIGH), QA na Flash 3.8, viac strán PDF
    expert_mode: bool = False
    # 1-pass Hydrogen s thinking HIGH/XHIGH nahradil pomalý 2-pass (draft→refine) na Pro 3.1;
    # možno zapnúť cez env CHIEF_AUDITOR_TWO_PASS=1 ak treba dodatočný refine pass.
    chief_auditor_two_pass_enabled: bool = False

    # ── LLM Model Configuration (Tiered Routing) ─────────────────────────────
    # Tier 1 — Jednoduchá štruktúrovaná extrakcia & nezávislá verifikácia: 3.5 Flash-Lite ($0.30/$2.50)
    model_staff_costs: str = "gemini-3.5-flash-lite"  # Cielená extrakcia 1 čísla (osobné náklady)
    model_vestnik: str = "gemini-3.5-flash-lite"      # Klasifikácia/sumarizácia XML z Obchodného vestníka
    model_pdf_reader: str = "gemini-3.5-flash-lite"   # Prepis právnych udalostí z textu PDF registrov
    model_verify: str = "gemini-3.5-flash-lite"       # Slepá verifikácia 5 kľúčových čísel (nezávislý model)
    # Tier 2 — Komplexné multimodálne PDF extraktory & QA: 3.8 Flash ($0.75/$3.75 do 31.12.2026)
    model_ifrs: str = "gemini-3.8-flash"              # IFRS/SK GAAP tabuľky — komplexná extrakcia 50+ polí
    model_narrative: str = "gemini-3.8-flash"         # Naratívna analýza Výročných správ (VS)
    model_notes: str = "gemini-3.8-flash"             # Forenzný analytik poznámok k závierke
    # Tier 3 — Krížová syntéza & hlavný posudok: Gemini 4 Hydrogen ($1.50/$7.50)
    model_cross_analysis: str = "gemini-4-hydrogen"   # Cross-Analysis Agent — krížová analýza (thinking=MEDIUM)
    model_verdict: str = "gemini-4-hydrogen"          # Chief Auditor — finálny forenzný posudok
    model_verdict_fallback: str = "gemini-3.1-pro-preview"  # Chief Auditor fallback (3.1 Pro → model_ifrs)
    # Fallback chain (3.7 Flash Google presmeruje na 3.8 = používame nezávislý 3.6 Flash → 3.5 Flash-Lite)
    model_fallback: str = "gemini-3.6-flash"
    model_fallback_2: str = "gemini-3.5-flash-lite"
    thinking_level_cross: str = "MEDIUM"              # Hydrogen thinking level pre Cross-Analysis
    llm_backoff_seconds: str = "5,15,30"              # Exponential backoff pre 429/503

    @property
    def thinking_level_verdict(self) -> str:
        """Chief Auditor thinking level — XHIGH in Expert Mode, HIGH in Standard."""
        return "XHIGH" if self.expert_mode else "HIGH"

    @property
    def model_qa(self) -> str:
        """QA Agent model — Flash 3.8 in Expert Mode, Flash-Lite 3.5 in Standard."""
        return "gemini-3.8-flash" if self.expert_mode else "gemini-3.5-flash-lite"

    @property
    def chief_auditor_two_pass(self) -> bool:
        """2-pass Chief Auditor (draft→refine) — off by default for Gemini 4 Hydrogen (1-pass XHIGH)."""
        return self.chief_auditor_two_pass_enabled

    # ── PDF Ingestion ─────────────────────────────────────────────────────────
    pdf_max_pages_sk_gaap: int = 20    # Úč POD, Úč MUJ — štandardné slovenské závierky
    pdf_max_pages_absolute: int = 100  # Absolútny hard limit (120 v Expert Mode)

    @property
    def pdf_max_pages_ifrs(self) -> int:
        """IFRS page limit — 120 in Expert Mode, 80 in Standard."""
        return 120 if self.expert_mode else 80

    @property
    def pdf_max_pages_absolute_limit(self) -> int:
        """Absolute hard limit — 150 in Expert Mode, 100 in Standard."""
        return 150 if self.expert_mode else 100
    pdf_ifrs_min_notes_page: int = 25  # Pre IFRS začneme hľadať poznámky až od tejto strany (ESG spravy môžu byť dlhé)
    pdf_sk_gaap_min_notes_page: int = 5  # Pre SK GAAP od strany 5
    pdf_scanned_min_pages: int = 30    # Ak má PDF tento počet strán a 0 textu → IFRS mode

    # ── RÚZ Scraper ───────────────────────────────────────────────────────────
    ruz_max_years: int = 5             # Koľko rokov závierok stiahnuť

    # ── Pipeline ──────────────────────────────────────────────────────────────
    pipeline_baseline_fallback: float = 130  # Fallback ETA sekundy

    # ── Sentry (voliteľné) ────────────────────────────────────────────────────
    sentry_dsn: Optional[str] = None

    # ── Celery + Redis (voliteľné — pre produkčnú škálovateľnosť) ─────────────
    celery_broker_url: str = "redis://localhost:6379/0"
    celery_result_backend: str = "redis://localhost:6379/1"

    model_config = SettingsConfigDict(env_file=".env", extra="ignore", protected_namespaces=("settings_",))

    @property
    def llm_backoff_list(self) -> list[int]:
        return [int(x) for x in self.llm_backoff_seconds.split(",")]

    @property
    def llm_pricing(self) -> dict[str, tuple[float, float]]:
        # 3.6/3.8 Flash: intro pricing do 31.12.2026, potom $1.50/$7.50.
        flash = (0.75, 3.75) if date.today() < date(2027, 1, 1) else (1.50, 7.50)
        return {
            "gemini-2.5-flash":       (0.075, 0.30),
            "gemini-2.5-pro":         (1.25, 10.00),
            "gemini-3.5-flash":       flash,
            "gemini-3.5-flash-lite":  (0.30,  2.50),
            "gemini-3.1-pro-preview": (2.00, 12.00),
            "gemini-3.6-flash":       flash,
            "gemini-3.7-flash":       flash,
            "gemini-3.8-flash":       flash,
            "gemini-4-hydrogen":      (1.50,  7.50),
            "gemini-4-neon":          (3.00, 15.00),
            "gemini-4-carbon":        (4.00, 20.00),
        }


settings = Settings()
settings.results_dir.mkdir(parents=True, exist_ok=True)
