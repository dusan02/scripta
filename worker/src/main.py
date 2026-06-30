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
from .logging_setup import setup_logging
from .db import (
    get_db_pool,
    update_report_status,
    update_report_ai_status,
    get_avg_completion_seconds,
    upsert_report_sources,
    upsert_single_report_source,
    close_db_pool,
)
from .models import ReportTask
from .pdf.compiler import PdfCompiler
from .scrapers.registry import run_scrapers
from .cleanup import _cleanup_loop

setup_logging()
logger = logging.getLogger(__name__)

# Obmedzenie súčasných reportov — chráni pred OOM pri veľa paralelných browseroch.
# Vytvára sa lazy v lifespan, aby sa naviazal na správny event loop.
_report_semaphore: Optional[asyncio.Semaphore] = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    global _report_semaphore
    _report_semaphore = asyncio.Semaphore(3)
    cleanup_task = asyncio.create_task(_cleanup_loop())
    yield
    cleanup_task.cancel()
    await close_db_pool()


app = FastAPI(title="Verifa.sk Worker", version="0.1.0", lifespan=lifespan)


async def verify_worker_secret(x_worker_secret: Optional[str] = Header(default=None)) -> None:
    """Overí shared-secret medzi Next.js API a workerom.

    V produkcii: vyžaduje presnú zhodu s settings.worker_secret.
    V dev režime: ak nie je nastavený, umožní komunikáciu bez neho.
    """
    if not settings.worker_secret:
        if settings.app_env == "production":
            raise HTTPException(status_code=500, detail="WORKER_SECRET must be set in production")
        return
        
    if x_worker_secret != settings.worker_secret:
        raise HTTPException(status_code=401, detail="Invalid worker secret")


def _identifier(task: ReportTask) -> str:
    return f"IČO {task.ico}"


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
    if _report_semaphore is None:
        await _execute_report_inner(task)
        return
    async with _report_semaphore:
        await _execute_report_inner(task)


def _extract_company_name(sources, target_type: str) -> Optional[str]:
    """Extract company name from first successful scraper that has it."""
    if target_type != "COMPANY":
        return None
    for s in sources:
        if s.status == "SUCCESS" and getattr(s, "company_name", None):
            return s.company_name
    return None


def _determine_final_status(sources) -> str:
    """Determine report final status from individual source statuses."""
    any_unavailable = any(s.status == "UNAVAILABLE" for s in sources)
    any_failed = any(s.status == "FAILED" for s in sources)
    all_success = all(s.status == "SUCCESS" for s in sources)
    if all_success:
        return "COMPLETED"
    if any_unavailable or any_failed:
        return "PARTIAL"
    return "FAILED"


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
        await update_report_status(pool, task.report_request_id, "PROCESSING")

        # Nastavíme počiatočný ETA z historických dát, aby frontend zobrazil odhad hneď
        avg_seconds = await get_avg_completion_seconds(pool)
        initial_eta = int(avg_seconds) if avg_seconds and avg_seconds > 0 else 130
        await update_report_ai_status(pool, task.report_request_id, "Preverovanie štátnych registrov", initial_eta)

        playwright = await async_playwright().start()
        browser = await playwright.chromium.launch(headless=settings.playwright_headless)
        t_browser = time.perf_counter()
        logger.debug(f"[WORKER] Browser launched ({t_browser - t_start:.2f}s)")

        _background_tasks = set()

        def _on_source_done(source) -> None:
            logger.debug(f"[WORKER] Source done: {source.source_type}:{source.status}")
            try:
                loop = asyncio.get_running_loop()
                t1 = loop.create_task(
                    upsert_single_report_source(pool, task.report_request_id, source)
                )
                _background_tasks.add(t1)
                t1.add_done_callback(_background_tasks.discard)

                if source.source_type == "ORSR" and source.status == "SUCCESS" and getattr(source, "company_name", None):
                    t2 = loop.create_task(
                        _save_company_name(pool, task.report_request_id, source.company_name)
                    )
                    _background_tasks.add(t2)
                    t2.add_done_callback(_background_tasks.discard)
            except RuntimeError:
                pass

        ai_task = None
        if task.target_type == "COMPANY" and task.ico:
            from src.pipeline import process_company
            logger.info(f"[WORKER] Spúšťam AI Forenznú Pipeline paralelne pre IČO: {task.ico}")
            ai_task = asyncio.create_task(process_company(task.ico, task.report_request_id))

        sources = await run_scrapers(
            sources=task.sources,
            output_dir=report_dir,
            browser=browser,
            target_type=task.target_type,
            ico=task.ico,
            orsr_extract_type=task.orsr_extract_type,
            crz_date_from=task.crz_date_from,
            on_source_done=_on_source_done,
        )
        
        if _background_tasks:
            await asyncio.gather(*_background_tasks, return_exceptions=True)

        t_scrape = time.perf_counter()
        logger.debug(f"[WORKER] Scrapers done ({t_scrape - t_browser:.2f}s): {[f'{s.source_type}:{s.status}' for s in sources]}")

        await upsert_report_sources(pool, task.report_request_id, sources)

        company_name = _extract_company_name(sources, task.target_type)

        # Počkáme na dokončenie paralelnej AI Forenznej Pipeline pred kompiláciou
        if ai_task:
            try:
                await ai_task
            except Exception as ai_err:
                logger.error(f"[WORKER] AI Pipeline zlyhala pre {task.ico}: {ai_err}", exc_info=True)

        # Chief Auditor (sudca) sa spúšťa PO dokončení scraperov aj AI pipeline,
        # aby mal prístup k PDF súborom z registrov (dlhy, exekúcie, insolvencia)
        # aj k DB dátam (finančné výkazy, naratív, vestník).
        if task.target_type == "COMPANY" and task.ico:
            from src.pipeline import run_and_save_audit_verdict
            try:
                await run_and_save_audit_verdict(task.ico)
            except Exception as verdict_err:
                logger.error(f"[WORKER] Chief Auditor zlyhal pre {task.ico}: {verdict_err}", exc_info=True)

        compile_eta = 50
        avg_seconds = await get_avg_completion_seconds(pool)
        if avg_seconds and float(avg_seconds) > 0:
            compile_eta = max(10, int(float(avg_seconds) * 0.2))
        await update_report_ai_status(pool, task.report_request_id, "Kompilácia vizuálneho PDF reportu", compile_eta)

        compiler = PdfCompiler(settings.results_dir)
        final_path = await compiler.compile(
            report_request_id=task.report_request_id,
            target_type=task.target_type,
            identifier=_identifier(task),
            sources=sources,
            company_name=company_name,
        )
        t_compile = time.perf_counter()
        logger.debug(f"[WORKER] PDF compiled ({t_compile - t_scrape:.2f}s): {final_path}")

        # Aktualizujeme pageCount v DB podľa reálnych hodnôt zistených compilerom
        from src.db import update_source_page_counts
        await update_source_page_counts(pool, task.report_request_id, sources)

        # Cleanup medziproduktov — ponechať len evidence_binder.pdf
        try:
            import shutil
            for f in report_dir.glob("*.pdf"):
                if f.name != "evidence_binder.pdf":
                    f.unlink()
            debug_dir = report_dir / "debug"
            if debug_dir.exists():
                shutil.rmtree(debug_dir, ignore_errors=True)
            logger.debug(f"[WORKER] Cleanup: medziprodukty zmazané z {report_dir}")
        except Exception as cleanup_err:
            logger.warning(f"[WORKER] Cleanup zlyhal: {cleanup_err}")

        final_status = _determine_final_status(sources)
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
    # Pre jednoduchosť použijeme report_request_id ako task ID.
    background_tasks.add_task(_execute_report, task)
    return {"taskId": task.report_request_id, "status": "accepted"}


@app.get("/health")
async def health():
    return {"ok": True, "timestamp": datetime.now(timezone.utc).isoformat()}


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("src.main:app", host="0.0.0.0", port=8000, reload=settings.app_env == "development")
