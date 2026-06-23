from __future__ import annotations
from datetime import datetime, timezone
from typing import Optional

import traceback
import asyncpg
from fastapi import BackgroundTasks, Depends, FastAPI, Header, HTTPException
from playwright.async_api import async_playwright

from .config import settings
from .db import (
    get_db_pool,
    update_report_status,
    upsert_report_sources,
    upsert_single_report_source,
    refund_unavailable_paid_sources,
    close_db_pool,
)
from .models import ReportTask
from .pdf.compiler import PdfCompiler
from .scrapers.registry import run_scrapers

app = FastAPI(title="Scripta Worker", version="0.1.0")


async def verify_worker_secret(x_worker_secret: Optional[str] = Header(default=None)) -> None:
    """Overí shared-secret medzi Next.js API a workerom.

    Ak nie je nastavený `worker_secret` (lokálny vývoj), kontrola sa preskočí.
    """
    expected = settings.worker_secret
    if not expected:
        return
    if x_worker_secret != expected:
        raise HTTPException(status_code=401, detail="Invalid worker secret")


@app.on_event("shutdown")
async def _on_shutdown() -> None:
    await close_db_pool()


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
        print(f"[WORKER] Company name saved: {company_name}")
    except Exception as e:
        print(f"[WORKER] Failed to save company name: {e}")


async def _execute_report(task: ReportTask) -> None:
    """Background job: stiahne výpisy, vygeneruje Cover Page a zlúči PDF."""
    print(f"[WORKER] Starting report {task.report_request_id} for ICO {task.ico}")
    report_dir = settings.results_dir / task.report_request_id
    report_dir.mkdir(parents=True, exist_ok=True)

    pool: Optional[asyncpg.Pool] = None
    browser = None
    playwright = None

    try:
        pool = await get_db_pool()
        print(f"[WORKER] DB pool acquired")
        await update_report_status(pool, task.report_request_id, "PROCESSING")
        print(f"[WORKER] Status set to PROCESSING")

        playwright = await async_playwright().start()
        browser = await playwright.chromium.launch(headless=settings.playwright_headless)
        print(f"[WORKER] Browser launched")

        # Callback — upsertne každý zdroj do DB ihneď ako skončí
        import asyncio as _asyncio

        def _on_source_done(source) -> None:
            print(f"[WORKER] Source done: {source.source_type}:{source.status}")
            try:
                loop = _asyncio.get_running_loop()
                _asyncio.ensure_future(
                    upsert_single_report_source(pool, task.report_request_id, source)
                )
                # Ak ORSR extrahoval company_name, uložíme ho ihneď do ReportRequest
                if source.source_type == "ORSR" and source.status == "SUCCESS" and getattr(source, "company_name", None):
                    _asyncio.ensure_future(
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
            on_source_done=_on_source_done,
        )
        print(f"[WORKER] Scrapers done: {[f'{s.source_type}:{s.status}' for s in sources]}")

        # Finálny upsert všetkých zdrojov (pre istotu — pokryje prípadné preteky callbacku)
        await upsert_report_sources(pool, task.report_request_id, sources)
        print(f"[WORKER] Sources upserted (final)")

        # Vrátime kredity za platené registre, ktoré nezbehli úspešne (napr. CRE UNAVAILABLE).
        await refund_unavailable_paid_sources(pool, task.report_request_id)
        print(f"[WORKER] Refund check done")

        # Extrahujeme obchodné meno, ak ho niektorý úspešný scraper získal
        company_name = None
        if task.target_type == "COMPANY":
            for s in sources:
                if s.status == "SUCCESS" and getattr(s, "company_name", None):
                    company_name = s.company_name
                    break

        # Zlúčime PDF aj ak niektorý zdroj zlyhal — report pokračuje.
        print(f"[WORKER] Starting PDF compile...")
        compiler = PdfCompiler(settings.results_dir)
        final_path = compiler.compile(
            report_request_id=task.report_request_id,
            target_type=task.target_type,
            identifier=_identifier(task),
            sources=sources,
            company_name=company_name,
        )
        print(f"[WORKER] PDF compiled: {final_path}")

        # Rozhodneme finálny status reportu.
        any_unavailable = any(s.status == "UNAVAILABLE" for s in sources)
        any_failed = any(s.status == "FAILED" for s in sources)
        all_success = all(s.status == "SUCCESS" for s in sources)

        final_status = "COMPLETED" if all_success else ("PARTIAL" if any_unavailable or any_failed else "FAILED")
        print(f"[WORKER] Final status: {final_status}")

        await update_report_status(
            pool,
            task.report_request_id,
            final_status,
            result_file_path=str(final_path),
            company_name=company_name,
        )
        print(f"[WORKER] Report completed successfully")
    except Exception:
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
