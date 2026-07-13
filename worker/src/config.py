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
    # Hybrid: extrakcia na flash (fallbacky riešia medzery), analýza na pro
    model_ifrs: str = "gemini-2.5-flash"        # IFRS tabuľky — extrakcia, fallbacky pokrývajú medzery
    model_narrative: str = "gemini-2.5-flash"   # Naratívna analýza (VS) — textová
    model_notes: str = "gemini-2.5-flash"       # Forenzný analytik (poznámky) — Flash stačí (štrukturálne dáta)
    model_vestnik: str = "gemini-2.5-flash"     # Vestník udalosti — štruktúrovaná extrakcia
    model_verdict: str = "gemini-3.5-pro"       # Chief Auditor — audítorský posudok a skóre (Pro pre komplexnú syntézu)
    model_cross_analysis: str = "gemini-2.5-flash"  # Cross-Analysis Agent — krížová analýza (Flash pre rýchlosť)
    model_fallback: str = "gemini-2.5-flash-lite"  # Fallback pri 404/503 (odlišný model pool)
    model_fallback_2: str = "gemini-2.5-pro"       # Sekundárny fallback (Pro tier)
    llm_backoff_seconds: str = "5,15,30"  # Exponential backoff pre 429/503 (Gemini free tier ~5 RPM)

    # ── PDF Ingestion ─────────────────────────────────────────────────────────
    pdf_max_pages_sk_gaap: int = 20    # Úč POD, Úč MUJ — štandardné slovenské závierky
    pdf_max_pages_ifrs: int = 80       # IFRS — veľké firmy môžu mať súvahu aj za ESG správou (strany 50-70+)
    pdf_max_pages_absolute: int = 100  # Absolútny hard limit
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
        return {
            "gemini-2.5-flash":       (0.075, 0.30),
            "gemini-2.5-flash-lite":  (0.075, 0.30),
            "gemini-2.5-pro":         (1.25, 10.00),
            "gemini-3.5-flash":       (1.50,  9.00),
            "gemini-3.5-pro":         (2.50, 15.00),
            "gemini-3.1-pro-preview": (2.00, 12.00),
            "gemini-3.1-pro":         (2.00, 12.00),
        }


settings = Settings()
settings.results_dir.mkdir(parents=True, exist_ok=True)
