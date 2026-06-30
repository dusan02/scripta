"""Centralized logging + Sentry initialization."""
import logging
import sys

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

    # Root logger — structured format
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(
        logging.Formatter(
            "%(asctime)s [%(levelname)s] %(name)s: %(message)s",
            datefmt="%Y-%m-%d %H:%M:%S",
        )
    )
    root = logging.getLogger()
    root.setLevel(level)
    root.handlers.clear()
    root.addHandler(handler)

    # File handler pre errors
    file_handler = logging.FileHandler("errors.log")
    file_handler.setLevel(logging.ERROR)
    file_handler.setFormatter(
        logging.Formatter(
            "%(asctime)s [%(levelname)s] %(name)s: %(message)s",
            datefmt="%Y-%m-%d %H:%M:%S",
        )
    )
    root.addHandler(file_handler)
