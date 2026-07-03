"""Centralized logging + Sentry initialization."""
import logging
import sys
from logging.handlers import RotatingFileHandler

from src.config import settings


def setup_logging(level: int = logging.INFO) -> None:
    """Configure structured logging with optional Sentry integration."""

    # Sentry — len ak je DSN nastavený v .env
    if settings.sentry_dsn:
        import sentry_sdk
        from sentry_sdk.integrations.fastapi import FastApiIntegration
        from sentry_sdk.integrations.logging import LoggingIntegration

        sentry_sdk.init(
            dsn=settings.sentry_dsn,
            environment=settings.app_env,
            traces_sample_rate=0.1 if settings.app_env == "production" else 1.0,
            integrations=[
                FastApiIntegration(),
                LoggingIntegration(
                    level=logging.INFO,
                    event_level=logging.ERROR,
                ),
            ],
        )
        logging.info("Sentry initialized (env=%s)", settings.app_env)
    else:
        logging.info("Sentry disabled (no SENTRY_DSN set)")

    # Root logger — structured format with correlation ID support
    _fmt = "%(asctime)s [%(levelname)s] %(name)s: %(message)s"
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(
        logging.Formatter(_fmt, datefmt="%Y-%m-%d %H:%M:%S")
    )
    root = logging.getLogger()
    root.setLevel(level)
    root.handlers.clear()
    root.addHandler(handler)

    # Rotating file handler pre WARNING+ (max 5MB, 3 backups)
    file_handler = RotatingFileHandler(
        "errors.log", maxBytes=5_000_000, backupCount=3, encoding="utf-8"
    )
    file_handler.setLevel(logging.WARNING)
    file_handler.setFormatter(
        logging.Formatter(_fmt, datefmt="%Y-%m-%d %H:%M:%S")
    )
    root.addHandler(file_handler)

    # ── Noise reduction ──────────────────────────────────────────────
    # matplotlib: kategorické warningy pri generovaní grafov
    logging.getLogger("matplotlib").setLevel(logging.WARNING)
    logging.getLogger("matplotlib.category").setLevel(logging.WARNING)
    # httpx: každý HTTP request na INFO je zbytočný noise
    logging.getLogger("httpx").setLevel(logging.WARNING)
    # google_genai: interné info logy
    logging.getLogger("google_genai").setLevel(logging.WARNING)
    # asyncio: "Future exception was never retrieved" spam
    logging.getLogger("asyncio").setLevel(logging.WARNING)
