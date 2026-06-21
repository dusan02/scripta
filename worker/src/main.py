from __future__ import annotations
from datetime import datetime, timezone
from pathlib import Path

import traceback
import asyncpg
from fastapi import BackgroundTasks, FastAPI, HTTPException
from playwright.async_api import async_playwright

from .config import settings
from .db import get_db_pool, update_report_status, upsert_report_sources
from .models import ReportTask, ScrapedSource
from .pdf.compiler import PdfCompiler
from .scrapers.registry import run_scrapers

app = FastAPI(title="Scripta Worker", version="0.1.0")


def _identifier(task: ReportTask) -> str:
    if task.target_type == "COMPANY":
        return f"IČO {task.ico}"
    return f"{task.name} {task.surname}, nar. {task.birth_date}"


async def _execute_report(task: ReportTask) -> None:
    """Background job: stiahne výpisy, vygeneruje Cover Page a zlúči PDF."""
    report_dir = settings.results_dir / task.report_request_id
    report_dir.mkdir(parents=True, exist_ok=True)

    pool: asyncpg.Pool | None = None
    browser = None
    playwright = None

    try:
        pool = await get_db_pool()
        await update_report_status(pool, task.report_request_id, "PROCESSING")

        playwright = await async_playwright().start()
        browser = await playwright.chromium.launch(headless=settings.playwright_headless)

        sources = await run_scrapers(
            sources=task.sources,
            output_dir=report_dir,
            browser=browser,
            target_type=task.target_type,
            ico=task.ico,
            name=task.name,
            surname=task.surname,
            birth_date=task.birth_date,
        )

        # Uložíme výsledky jednotlivých zdrojov.
        await upsert_report_sources(pool, task.report_request_id, sources)

        # Zlúčime PDF aj ak niektorý zdroj zlyhal — report pokračuje.
        compiler = PdfCompiler(settings.results_dir)
        final_path = compiler.compile(
            report_request_id=task.report_request_id,
            target_type=task.target_type,
            identifier=_identifier(task),
            sources=sources,
        )

        # Rozhodneme finálny status reportu.
        any_unavailable = any(s.status == "UNAVAILABLE" for s in sources)
        any_failed = any(s.status == "FAILED" for s in sources)
        all_success = all(s.status == "SUCCESS" for s in sources)

        final_status = "COMPLETED" if all_success else ("PARTIAL" if any_unavailable or any_failed else "FAILED")

        await update_report_status(
            pool,
            task.report_request_id,
            final_status,
            result_file_path=str(final_path),
        )
    except Exception as e:
        # Ak celý worker zlyhá, report označíme ako FAILED.
        traceback.print_exc()
        if pool:
            await update_report_status(pool, task.report_request_id, "FAILED")
        raise
    finally:
        if browser:
            await browser.close()
        if playwright:
            await playwright.stop()
        if pool:
            await pool.close()


@app.post("/tasks")
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

    uvicorn.run("worker.src.main:app", host="0.0.0.0", port=8000, reload=settings.app_env == "development")
