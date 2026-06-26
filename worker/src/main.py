from __future__ import annotations
from datetime import datetime, timezone
from typing import Optional
import asyncio
import logging
import time

import asyncpg
from contextlib import asynccontextmanager
from fastapi import BackgroundTasks, Depends, FastAPI, Header, HTTPException
from playwright.async_api import async_playwright

from .config import settings
from .db import (
    get_db_pool,
    update_report_status,
    upsert_report_sources,
    upsert_single_report_source,
    close_db_pool,
)
from .models import ReportTask
from .pdf.compiler import PdfCompiler
from .scrapers.registry import run_scrapers
from .cleanup import _cleanup_loop

logger = logging.getLogger(__name__)

# Obmedzenie súčasných reportov — chráni pred OOM pri veľa paralelných browseroch.
_report_semaphore = asyncio.Semaphore(3)


@asynccontextmanager
async def lifespan(app: FastAPI):
    cleanup_task = asyncio.create_task(_cleanup_loop())
    yield
    cleanup_task.cancel()
    await close_db_pool()


app = FastAPI(title="Registro.sk Worker", version="0.1.0", lifespan=lifespan)


async def verify_worker_secret(x_worker_secret: Optional[str] = Header(default=None)) -> None:
    """Overí shared-secret medzi Next.js API a workerom.

    Ak nie je nastavený `worker_secret` (lokálny vývoj), kontrola sa preskočí.
    """
    expected = settings.worker_secret
    if not expected:
        return
    if x_worker_secret != expected:
        raise HTTPException(status_code=401, detail="Invalid worker secret")


def _identifier(task: ReportTask) -> str:
    if task.target_type == "COMPANY":
        return f"IČO {task.ico}"
    return f"{task.name} {task.surname}, nar. {task.birth_date}"


async def _save_company_name(pool: asyncpg.Pool, report_request_id: str, company_name: str) -> None:
    """Uloží company_name do ReportRequest ihneď ako ho ORSR extrahuje."""
    try:
        await pool.execute(
            'UPDATE "ReportRequest" SET "companyName" = $1, "updatedAt" = NOW() WHERE id = $2',
            company_name,
            report_request_id,
        )
        logger.debug(f"[WORKER] Company name saved: {company_name}")
    except Exception as e:
        logger.warning(f"[WORKER] Failed to save company name: {e}")


async def _execute_report(task: ReportTask) -> None:
    """Background job: stiahne výpisy, vygeneruje Cover Page a zlúči PDF."""
    async with _report_semaphore:
        await _execute_report_inner(task)


async def _execute_report_inner(task: ReportTask) -> None:
    """Interná implementácia — volaná pod semaphore."""
    t_start = time.perf_counter()
    logger.info(f"[WORKER] Starting report {task.report_request_id} for ICO {task.ico}")
    report_dir = settings.results_dir / task.report_request_id
    report_dir.mkdir(parents=True, exist_ok=True)

    pool: Optional[asyncpg.Pool] = None
    browser = None
    playwright = None

    try:
        pool = await get_db_pool()
        logger.debug("[WORKER] DB pool acquired")
        await update_report_status(pool, task.report_request_id, "PROCESSING")
        logger.debug("[WORKER] Status set to PROCESSING")

        playwright = await async_playwright().start()
        browser = await playwright.chromium.launch(headless=settings.playwright_headless)
        t_browser = time.perf_counter()
        logger.debug(f"[WORKER] Browser launched ({t_browser - t_start:.2f}s)")

        # Callback — upsertne každý zdroj do DB ihneď ako skončí
        def _on_source_done(source) -> None:
            logger.debug(f"[WORKER] Source done: {source.source_type}:{source.status}")
            try:
                asyncio.get_running_loop()
                asyncio.ensure_future(
                    upsert_single_report_source(pool, task.report_request_id, source)
                )
                # Ak ORSR extrahoval company_name, uložíme ho ihneď do ReportRequest
                if source.source_type == "ORSR" and source.status == "SUCCESS" and getattr(source, "company_name", None):
                    asyncio.ensure_future(
                        _save_company_name(pool, task.report_request_id, source.company_name)
                    )
            except RuntimeError:
                pass

        sources = await run_scrapers(
            sources=task.sources,
            output_dir=report_dir,
            browser=browser,
            target_type=task.target_type,
            ico=task.ico,
            name=task.name,
            surname=task.surname,
            birth_date=task.birth_date,
            orsr_extract_type=task.orsr_extract_type,
            crz_date_from=task.crz_date_from,
            on_source_done=_on_source_done,
        )
        t_scrape = time.perf_counter()
        logger.debug(f"[WORKER] Scrapers done ({t_scrape - t_browser:.2f}s): {[f'{s.source_type}:{s.status}' for s in sources]}")

        # Finálny upsert všetkých zdrojov (pre istotu — pokryje prípadné preteky callbacku)
        await upsert_report_sources(pool, task.report_request_id, sources)
        logger.debug("[WORKER] Sources upserted (final)")

        # Extrahujeme obchodné meno, ak ho niektorý úspešný scraper získal
        company_name = None
        if task.target_type == "COMPANY":
            for s in sources:
                if s.status == "SUCCESS" and getattr(s, "company_name", None):
                    company_name = s.company_name
                    break

        # Zlúčime PDF aj ak niektorý zdroj zlyhal — report pokračuje.
        logger.debug("[WORKER] Starting PDF compile...")
        compiler = PdfCompiler(settings.results_dir)
        final_path = compiler.compile(
            report_request_id=task.report_request_id,
            target_type=task.target_type,
            identifier=_identifier(task),
            sources=sources,
            company_name=company_name,
        )
        t_compile = time.perf_counter()
        logger.debug(f"[WORKER] PDF compiled ({t_compile - t_scrape:.2f}s): {final_path}")

        # Rozhodneme finálny status reportu.
        any_unavailable = any(s.status == "UNAVAILABLE" for s in sources)
        any_failed = any(s.status == "FAILED" for s in sources)
        all_success = all(s.status == "SUCCESS" for s in sources)

        final_status = "COMPLETED" if all_success else ("PARTIAL" if any_unavailable or any_failed else "FAILED")
        logger.info(f"[WORKER] Final status: {final_status}")

        await update_report_status(
            pool,
            task.report_request_id,
            final_status,
            result_file_path=str(final_path),
            company_name=company_name,
        )
        t_end = time.perf_counter()
        logger.info(f"[WORKER] Report completed — total {t_end - t_start:.2f}s (browser {t_browser - t_start:.2f}s, scrapers {t_scrape - t_browser:.2f}s, compile {t_compile - t_scrape:.2f}s)")
    except Exception:
        # Ak celý worker zlyhá, report označíme ako FAILED.
        logger.error(f"[WORKER] Report {task.report_request_id} failed", exc_info=True)
        if pool:
            await update_report_status(pool, task.report_request_id, "FAILED")
        raise
    finally:
        if browser:
            await browser.close()
        if playwright:
            await playwright.stop()
        # Pool je modulový singleton — nezatvárame ho po každej úlohe.


@app.post("/tasks", dependencies=[Depends(verify_worker_secret)])
async def create_task(task: ReportTask, background_tasks: BackgroundTasks):
    """Prijme úlohu z Next.js API a okamžite vráti task ID."""
    if task.target_type == "COMPANY" and not task.ico:
        raise HTTPException(status_code=400, detail="ICO is required for COMPANY target")
    if task.target_type == "PERSON" and (not task.name or not task.surname or not task.birth_date):
        raise HTTPException(status_code=400, detail="Name, surname and birth_date are required for PERSON target")

    # Pre jednoduchosť použijeme report_request_id ako task ID.
    background_tasks.add_task(_execute_report, task)
    return {"taskId": task.report_request_id, "status": "accepted"}


@app.get("/health")
async def health():
    return {"ok": True, "timestamp": datetime.now(timezone.utc).isoformat()}


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("src.main:app", host="0.0.0.0", port=8000, reload=settings.app_env == "development")
