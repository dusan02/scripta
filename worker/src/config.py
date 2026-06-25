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

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")


settings = Settings()
settings.results_dir.mkdir(parents=True, exist_ok=True)
