from __future__ import annotations
from typing import Optional
from pydantic_settings import BaseSettings
from pathlib import Path


class Settings(BaseSettings):
    app_env: str = "development"
    database_url: str = "postgresql://user:password@localhost:5432/scripta"
    results_dir: Path = Path("./results")
    web_concurrency: int = 4
    playwright_headless: bool = True
    playwright_timeout: int = 60_000

    # CRE — Centrálny register exekúcií (voliteľné; bez nich scraper vráti UNAVAILABLE)
    cre_username: Optional[str] = None
    cre_password: Optional[str] = None

    class Config:
        env_file = ".env"


settings = Settings()
settings.results_dir.mkdir(parents=True, exist_ok=True)
