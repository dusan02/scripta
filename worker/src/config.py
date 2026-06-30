from __future__ import annotations
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

    # Cleanup — automatické mazanie starých reportov
    cleanup_max_age_days: int = 30          # reporty staršie ako X dní sa zmažú
    cleanup_max_reports_per_user: int = 50  # max počet reportov per user (najstaršie sa zmažú)
    cleanup_interval_hours: int = 6         # ako často beží cleanup loop

    # Shared-secret medzi Next.js API a workerom (voliteľné v dev; povinné v produkcii)
    worker_secret: Optional[str] = None

    # CRE — Centrálny register exekúcií (voliteľné; bez nich scraper vráti UNAVAILABLE)
    cre_username: Optional[str] = None
    cre_password: Optional[str] = None

    # Proxy rotation — pre anti-detekciu (voliteľné)
    # Formát: "http://user:pass@host:port" alebo "http://host:port"
    # Viacero proxy oddelených čiarkou — round-robin medzi scrapermi
    proxy_list: Optional[str] = None

    # ── LLM Model Configuration ──────────────────────────────────────────────
    model_ifrs: str = "gemini-2.5-flash"        # IFRS tabuľky — spoľahlivý OCR/extraktor
    model_narrative: str = "gemini-2.5-flash"   # Naratívna analýza (VS)
    model_vestnik: str = "gemini-2.5-flash"     # Vestník udalosti — štruktúrovaná extrakcia
    model_verdict: str = "gemini-2.5-flash"     # Audit verdict / forenzný posudok
    model_fallback: str = "gemini-3.5-flash"    # Fallback pri vyčerpaní kvót
    llm_backoff_seconds: str = "15,45,120,300"  # Exponential backoff pre 429/503

    # ── PDF Ingestion ─────────────────────────────────────────────────────────
    pdf_max_pages_sk_gaap: int = 20    # Úč POD, Úč MUJ — štandardné slovenské závierky
    pdf_max_pages_ifrs: int = 60       # IFRS — veľké firmy môžu mať súvahu na stranách 20-50
    pdf_max_pages_absolute: int = 80   # Absolútny hard limit
    pdf_ifrs_min_notes_page: int = 20  # Pre IFRS začneme hľadať poznámky až od tejto strany
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
        return {
            "gemini-2.5-flash":       (0.075, 0.30),
            "gemini-3.5-flash":       (1.50,  9.00),
            "gemini-3.1-pro-preview": (2.00, 12.00),
            "gemini-3.1-pro":         (2.00, 12.00),
        }


settings = Settings()
settings.results_dir.mkdir(parents=True, exist_ok=True)
