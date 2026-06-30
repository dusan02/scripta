"""
Celery + Redis scaffold pre produkčnú škálovateľnosť.

Aktuálne sa reporty spracovávajú cez FastAPI BackgroundTasks (single-process, no retry).
Tento scaffold umožňuje prechod na Celery worker s Redis brokerom bez zmeny pipeline kódu.

Setup:
    1. brew install redis && brew services start redis
    2. pip install celery[redis]==5.4.0
    3. Spusti worker: celery -A src.celery_app worker --loglevel=info --concurrency=2
    4. V main.py nahraď background_tasks.add_task(process_company, ...) za:
       process_company_task.delay(ico, report_request_id)

Environment:
    CELERY_BROKER_URL=redis://localhost:6379/0
    CELERY_RESULT_BACKEND=redis://localhost:6379/1
"""
import asyncio
import logging
from typing import Optional

from src.config import settings

logger = logging.getLogger(__name__)

try:
    from celery import Celery

    broker_url = getattr(settings, "celery_broker_url", "redis://localhost:6379/0")
    result_backend = getattr(settings, "celery_result_backend", "redis://localhost:6379/1")

    app = Celery(
        "verifa",
        broker=broker_url,
        backend=result_backend,
    )

    app.conf.update(
        task_serializer="json",
        result_serializer="json",
        accept_content=["json"],
        timezone="Europe/Bratislava",
        enable_utc=True,
        task_track_started=True,
        task_time_limit=600,        # 10 min hard limit
        task_soft_time_limit=540,   # 9 min soft limit
        worker_prefetch_multiplier=1,  # Fair scheduling — 1 task per worker process
        task_acks_late=True,         # Ack only after task completes (crash recovery)
        task_reject_on_worker_lost=True,
    )

    @app.task(name="verifa.process_company", bind=True, max_retries=1)
    def process_company_task(self, ico: str, report_request_id: Optional[str] = None):
        """Celery wrapper pre async process_company pipeline."""
        from src.pipeline import process_company
        try:
            return asyncio.run(process_company(ico, report_request_id))
        except Exception as exc:
            logger.error(f"Celery task failed for {ico}: {exc}")
            raise self.retry(exc=exc, countdown=30)

    CELERY_AVAILABLE = True

except ImportError:
    logger.info("Celery not installed — using FastAPI BackgroundTasks (dev mode)")
    CELERY_AVAILABLE = False

    class _FakeTask:
        """Fallback: spustí priamo asyncio.run ak Celery nie je nainštalovaný."""
        @staticmethod
        def delay(ico: str, report_request_id: Optional[str] = None):
            from src.pipeline import process_company
            return asyncio.run(process_company(ico, report_request_id))

    process_company_task = _FakeTask()  # type: ignore
