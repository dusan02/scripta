from __future__ import annotations
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional
import asyncio
import logging
import time
import shutil

import fitz
import os
import httpx
from arq import create_pool
from arq.connections import RedisSettings
from contextlib import asynccontextmanager
from fastapi import Depends, FastAPI, Header, HTTPException
from playwright.async_api import async_playwright

from .config import settings
from .logging_setup import setup_logging
from .db_repository import (
    upsert_company_name,
    update_report_status,
    update_ai_status as update_report_ai_status,
    get_avg_completion_seconds,
    get_avg_phase_durations,
    save_phase_duration,
    upsert_report_sources,
    upsert_single_report_source,
    update_source_page_counts,
    create_bug_report,
    charge_credit as _charge_credit,
    get_verifa_score,
)
from .models import ReportTask
from .pdf.compiler import PdfCompiler
from .scrapers.registry import run_scrapers
from .cleanup import _cleanup_loop
from .llm_extractor import reset_token_stats, log_token_summary
from .pipeline import process_company, run_and_save_audit_verdict, run_pdf_reader_agent
from src.log_helpers import set_correlation_id, PhaseTimer, get_correlation_id

setup_logging()
logger = logging.getLogger(__name__)

# Obmedzenie súčasných reportov — chráni pred OOM pri veľa paralelných browseroch.
# Vytvára sa lazy v lifespan, aby sa naviazal na správny event loop.
_report_semaphore: Optional[asyncio.Semaphore] = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    if settings.app_env == "production" and not settings.worker_secret:
        raise RuntimeError("WORKER_SECRET must be set in production")

    global _report_semaphore
    _report_semaphore = asyncio.Semaphore(3)

    redis_url = os.getenv("REDIS_URL", "redis://localhost:6379/0")
    app.state.redis = await create_pool(RedisSettings.from_dsn(redis_url))
    
    cleanup_task = asyncio.create_task(_cleanup_loop())
    yield
    cleanup_task.cancel()
    await app.state.redis.close()


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
    if not sources:
        return "FAILED"
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
    _rid = task.report_request_id[:12]  # krátky ID pre logy
    set_correlation_id(_rid)
    _log = logging.LoggerAdapter(logger, {"rid": _rid})
    _log.info(f"[{_rid}] Starting report for ICO {task.ico}")
    reset_token_stats()
    report_dir = settings.results_dir / task.report_request_id
    report_dir.mkdir(parents=True, exist_ok=True)

    browser = None
    playwright = None

    try:
        await update_report_status(task.report_request_id, "PROCESSING")

        # Nastavíme počiatočný ETA z historických dát, upravený podľa počtu zdrojov
        avg_seconds = await get_avg_completion_seconds()
        base_eta = int(avg_seconds) if avg_seconds and avg_seconds > 0 else 240
        # Source-count-weighted ETA: viac zdrojov = viac času (najmä compile)
        source_count = len(task.sources)
        # Baseline ~3s na zdroj pre scrapers + compile overhead
        initial_eta = max(base_eta, 60 + source_count * 4)

        # Phase-aware: načítaj historické phase timingy pre presnejšie ETA
        phase_avgs = await get_avg_phase_durations()
        _phase_historical = {}
        if phase_avgs:
            _phase_historical = phase_avgs
            _log.info(f"[{_rid}] Phase historical: {phase_avgs}")
            # Ak máme phase dáta, spočítaj presnejší initial ETA
            hist_total = sum(v or 0 for v in [phase_avgs.get('scrapers'), phase_avgs.get('ai'), phase_avgs.get('auditor'), phase_avgs.get('compile')])
            if hist_total > 0:
                initial_eta = max(initial_eta, int(hist_total))

        await update_report_ai_status(task.report_request_id, "ai.checking_registers", initial_eta)

        playwright = await async_playwright().start()
        from src.browser_manager import browser_manager
        browser = await browser_manager.get_browser(playwright)
        t_browser = time.perf_counter()
        logger.debug(f"[WORKER] Browser launched ({t_browser - t_start:.2f}s)")

        _background_tasks = set()
        _sources_done_count = 0
        _sources_total = len(task.sources)
        _t_scrape_start = time.perf_counter()

        def _on_source_done(source) -> None:
            nonlocal _sources_done_count
            _sources_done_count += 1
            logger.debug(f"[WORKER] Source done: {source.source_type}:{source.status} ({_sources_done_count}/{_sources_total})")
            try:
                loop = asyncio.get_running_loop()
                t1 = loop.create_task(
                    upsert_single_report_source(task.report_request_id, source)
                )
                _background_tasks.add(t1)
                t1.add_done_callback(_background_tasks.discard)

                if source.source_type == "ORSR" and source.status == "SUCCESS" and getattr(source, "company_name", None):
                    t2 = loop.create_task(
                        upsert_company_name(task.ico, source.company_name)
                    )
                    _background_tasks.add(t2)
                    t2.add_done_callback(_background_tasks.discard)

                # Progress-based ETA: odhad remaining na základe pomeru dokončených zdrojov
                if _sources_total > 1:
                    elapsed_scrape = time.perf_counter() - _t_scrape_start
                    progress = _sources_done_count / _sources_total
                    if progress > 0:
                        # Zostávajúci čas pre scrapovanie = koľko ešte treba podľa aktuálneho tempa
                        scrape_remaining = (elapsed_scrape / progress) - elapsed_scrape
                        
                        # Čas pre ďalšie fázy (AI, Auditor, Compile)
                        other_phases_eta = 60
                        if _phase_historical:
                            other_phases_eta = sum(v or 0 for k, v in _phase_historical.items() if k in ['ai', 'auditor', 'compile'])
                            
                        remaining = max(5, int(scrape_remaining + other_phases_eta))
                        t3 = loop.create_task(
                            update_report_ai_status(task.report_request_id, None, remaining)
                        )
                        _background_tasks.add(t3)
                        t3.add_done_callback(_background_tasks.discard)
            except RuntimeError:
                pass

        ai_task = None
        if task.target_type == "COMPANY" and task.ico:
            _log.info(f"[{_rid}] Spúšťam AI analytickú pipeline paralelne pre IČO: {task.ico}")
            ai_task = asyncio.create_task(process_company(task.ico, task.report_request_id, report_language=task.report_language or "sk"))

        _log.info(f"[{_rid}] Spúšťam {len(task.sources)} scraperov pre IČO: {task.ico}")
        try:
            sources = await asyncio.wait_for(
                run_scrapers(
                    sources=task.sources,
                    output_dir=report_dir,
                    browser=browser,
                    target_type=task.target_type,
                    ico=task.ico,
                    report_language=task.report_language or "sk",
                    orsr_extract_type=task.orsr_extract_type,
                    crz_date_from=task.crz_date_from,
                    rozhodnutia_date_from=task.rozhodnutia_date_from,
                    on_source_done=_on_source_done,
                ),
                timeout=180,
            )
        except asyncio.TimeoutError:
            _log.warning(f"[{_rid}] Scraperi prekročili 180s limit — pokračujem s dostupnými výsledkami.")
            sources = []
        
        if _background_tasks:
            await asyncio.gather(*_background_tasks, return_exceptions=True)

        t_scrape = time.perf_counter()
        _scrape_ms = int((t_scrape - t_browser) * 1000)
        await save_phase_duration(task.report_request_id, "scrapers", _scrape_ms)
        _source_summary = ', '.join(f'{s.source_type}:{s.status}' for s in sources)
        _log.info(f"[{_rid}] Scrapers done ({t_scrape - t_browser:.1f}s): {_source_summary}")

        # ── HARD STOP: ORSR nenájdené IČO ──────────────────────────────────
        orsr_result = next((s for s in sources if s.source_type == "ORSR"), None)
        if orsr_result and orsr_result.status == "FAILED" and "neexistuje" in (orsr_result.status_message or "").lower():
            _log.error(f"[{_rid}] HARD STOP: IČO {task.ico} neexistuje v ORSR — report zrušený.")
            await update_report_status(task.report_request_id, "FAILED")
            await update_report_ai_status(task.report_request_id, "failed.orsr_not_found")
            if ai_task and not ai_task.done():
                ai_task.cancel()
                try:
                    await ai_task
                except asyncio.CancelledError:
                    pass
            return

        # ── Retry failed scrapers (one pass) ──────────────────────────────
        failed_sources = [s for s in sources if s.status == "FAILED"]
        if failed_sources:
            failed_types = [s.source_type for s in failed_sources]
            _log.info(f"[{_rid}] Retrying {len(failed_types)} failed scrapers: {failed_types}")
            await update_report_ai_status(task.report_request_id, "ai.retrying", 60)
            await asyncio.sleep(3)

            retry_results = await run_scrapers(
                sources=failed_types,
                output_dir=report_dir,
                browser=browser,
                target_type=task.target_type,
                ico=task.ico,
                report_language=task.report_language or "sk",
                orsr_extract_type=task.orsr_extract_type,
                crz_date_from=task.crz_date_from,
                rozhodnutia_date_from=task.rozhodnutia_date_from,
            )

            # Merge retry results back into sources
            retry_map = {r.source_type: r for r in retry_results}
            for i, s in enumerate(sources):
                if s.source_type in retry_map:
                    retry_result = retry_map[s.source_type]
                    if retry_result.status == "SUCCESS":
                        _log.info(f"[{_rid}] Retry succeeded for {s.source_type}")
                        sources[i] = retry_result
                    else:
                        _log.warning(f"[{_rid}] Retry failed again for {s.source_type}: {retry_result.status}")

        await upsert_report_sources(task.report_request_id, sources)

        company_name = _extract_company_name(sources, task.target_type)

        # Počkáme na dokončenie paralelnej AI Forenznej Pipeline pred kompiláciou
        # Súčasne spustíme PDF Reader Agent a ORSR Forensic Agent
        t_ai_wait = time.perf_counter()
        pdf_reader_task = None
        orsr_forensic_task = None
        if task.target_type == "COMPANY" and task.ico and sources:
            from src.pipeline import run_pdf_reader_agent, run_orsr_forensics_agent
            pdf_reader_task = asyncio.create_task(run_pdf_reader_agent(task.ico, sources, report_language=task.report_language or "sk"))
            orsr_forensic_task = asyncio.create_task(run_orsr_forensics_agent(task.ico, sources, report_language=task.report_language or "sk"))
        if ai_task:
            try:
                await ai_task
            except asyncio.CancelledError:
                _log.info(f"[{_rid}] AI Pipeline bola zrušená pre {task.ico}")
            except Exception as ai_err:
                _log.error(f"[{_rid}] AI Pipeline zlyhala pre {task.ico}: {ai_err}", exc_info=True)
        if pdf_reader_task:
            try:
                await pdf_reader_task
            except asyncio.CancelledError:
                _log.info(f"[{_rid}] PDF Reader Agent bol zrušený pre {task.ico}")
            except Exception as pr_err:
                _log.error(f"[{_rid}] PDF Reader Agent zlyhal pre {task.ico}: {pr_err}", exc_info=True)
        if orsr_forensic_task:
            try:
                await orsr_forensic_task
            except asyncio.CancelledError:
                _log.info(f"[{_rid}] ORSR Forensic Agent bol zrušený pre {task.ico}")
            except Exception as orsr_err:
                _log.error(f"[{_rid}] ORSR Forensic Agent zlyhal pre {task.ico}: {orsr_err}", exc_info=True)
        t_ai_done = time.perf_counter()
        _ai_ms = int((t_ai_done - t_ai_wait) * 1000)
        await save_phase_duration(task.report_request_id, "ai", _ai_ms)

        # ETA update: Chief Auditor + kompilácia — phase-aware z historických dát
        hist_auditor = _phase_historical.get('auditor') if _phase_historical else None
        hist_compile = _phase_historical.get('compile') if _phase_historical else None
        auditor_s = int(hist_auditor) if hist_auditor else 30
        compile_s = int(hist_compile) if hist_compile else (20 + int(source_count * 1.5))
        forensic_eta = auditor_s + compile_s
        await update_report_ai_status(task.report_request_id, "ai.forensic_analysis", forensic_eta)

        # Update Company.name ak scraper extrahoval reálny názov (AI pipeline mohla nastaviť placeholder)
        if company_name:
            try:
                await upsert_company_name(task.ico, company_name)
                _log.info(f"[{_rid}] Company name updated to: {company_name}")
            except Exception as e:
                _log.warning(f"[{_rid}] Failed to update company name: {e}")

        # ── Save insolvency finding as CRITICAL VestnikEvent so scorecard picks it up ──
        if task.target_type == "COMPANY" and task.ico:
            insolvency_result = next((s for s in sources if s.source_type == "INSOLVENCY"), None)
            if insolvency_result and insolvency_result.status == "SUCCESS" and insolvency_result.findings and "POZOR" in (insolvency_result.findings or ""):
                try:
                    from prisma import Prisma
                    _db = Prisma()
                    await _db.connect()
                    try:
                        existing = await _db.vestnikevent.find_first(
                            where={"companyIco": task.ico, "eventType": "KONKURZ"}
                        )
                        if not existing:
                            await _db.vestnikevent.create({
                                "companyIco": task.ico,
                                "eventType": "KONKURZ",
                                "severityLevel": "CRITICAL",
                                "summary": "Spoločnosť je v konkurze/reštrukturalizácii — nájdený záznam v registri úpadcov.",
                                "publishedAt": datetime.now(timezone.utc).replace(tzinfo=None),
                                "sourceId": f"INSOLVENCY_{task.ico}",
                            })
                            _log.info(f"[{_rid}] Insolvency finding saved as CRITICAL VestnikEvent for IČO {task.ico}")
                    finally:
                        await _db.disconnect()
                except Exception as ins_err:
                    _log.warning(f"[{_rid}] Failed to save insolvency VestnikEvent: {ins_err}")

        # Chief Auditor (sudca) sa spúšťa PO dokončení scraperov aj AI pipeline,
        # aby mal prístup k PDF súborom z registrov (dlhy, exekúcie, insolvencia)
        # aj k DB dátam (finančné výkazy, naratív, vestník).
        verifa_score_snapshot: Optional[int] = None
        if task.target_type == "COMPANY" and task.ico:
            t_auditor_start = time.perf_counter()
            try:
                await update_report_ai_status(task.report_request_id, "ai.cross_correlation", auditor_s)
                with PhaseTimer("Chief Auditor"):
                    await run_and_save_audit_verdict(task.ico, report_language=task.report_language or "sk")
                # —— Snapshot skóre: prečítame aktuálny AuditVerdict a fixujeme na tento report ——
                verifa_score_snapshot = await get_verifa_score(task.ico)
                if verifa_score_snapshot:
                    _log.info(f"[{_rid}] verifaScore snapshot: {verifa_score_snapshot}")
            except Exception as verdict_err:
                _log.error(f"[{_rid}] Chief Auditor zlyhal pre {task.ico}: {verdict_err}", exc_info=True)
            finally:
                t_auditor_end = time.perf_counter()
                await save_phase_duration(task.report_request_id, "auditor", int((t_auditor_end - t_auditor_start) * 1000))

        # Skip REGISTER_UZ PDF ak obsahuje "Údaje nie sú dostupné" (IFRS firmy)
        # Dáta sú už v cover page (Finančný vývoj a štruktúra) z AI extrakcie
        for s in sources:
            if s.source_type == "REGISTER_UZ" and s.status == "SUCCESS" and s.file_path:
                try:
                    doc = fitz.open(s.file_path)
                    text = "".join(page.get_text() for page in doc)
                    doc.close()
                    if "Údaje nie sú dostupné v štruktúrovanej podobe" in text:
                        _log.info(f"[{_rid}] REGISTER_UZ: údaje nedostupné (IFRS) — dáta extrahované AI")
                        s.status = "SUCCESS"
                        s.status_message = "IFRS závierky analyzované AI — pozri Finančnú analýzu v reporte"
                        s.file_path = None
                        s.page_count = 0
                except Exception as e:
                    _log.warning(f"[{_rid}] REGISTER_UZ skip check zlyhal: {e}")

        # ETA pre kompiláciu: phase-aware z historických dát
        compile_eta = int(hist_compile) if hist_compile else (20 + int(source_count * 1.5))
        await update_report_ai_status(task.report_request_id, "ai.risk_synthesis", compile_eta + 5)
        await asyncio.sleep(2)
        await update_report_ai_status(task.report_request_id, "ai.compiling", compile_eta)

        compiler = PdfCompiler(settings.results_dir)
        t_compile_start = time.perf_counter()
        with PhaseTimer("PDF compile"):
            final_path = await compiler.compile(
                report_request_id=task.report_request_id,
                target_type=task.target_type,
                identifier=_identifier(task),
                sources=sources,
                company_name=company_name,
                report_language=task.report_language or "sk",
                vestnik_date_from=task.vestnik_date_from,
            )
        t_compile = time.perf_counter()
        await save_phase_duration(task.report_request_id, "compile", int((t_compile - t_compile_start) * 1000))
        _log.info(f"[{_rid}] PDF compiled: {final_path.name}")

        # Aktualizujeme pageCount v DB podľa reálnych hodnôt zistených compilerom
        await update_source_page_counts(task.report_request_id, sources)

        # Cleanup medziproduktov — ponechať len evidence_binder.pdf
        try:
            for f in report_dir.glob("*.pdf"):
                if f.name != "evidence_binder.pdf":
                    f.unlink()
            debug_dir = report_dir / "debug"
            if debug_dir.exists():
                shutil.rmtree(debug_dir, ignore_errors=True)
            _log.debug(f"[{_rid}] Cleanup: medziprodukty zmazané")
        except Exception as cleanup_err:
            _log.warning(f"[{_rid}] Cleanup zlyhal: {cleanup_err}")

        final_status = _determine_final_status(sources)
        _log.info(f"[{_rid}] Final status: {final_status}")

        # Automaticky vytvor bug report ak status je FAILED
        if final_status == "FAILED":
            failed_sources = [s for s in sources if s.status != "SUCCESS"]
            error_details = (
                f"Status: FAILED\n"
                f"Zlyhané zdroje: {', '.join(f'{s.source_type}:{s.status}' for s in failed_sources)}\n"
                f"Detaily: {'; '.join(s.status_message or '' for s in failed_sources if s.status_message)}"
            )
            await create_bug_report(task.report_request_id, error_details)

        # ── Kreditná operácia: len ak COMPLETED ─────────────────────────
        if final_status == "COMPLETED":
            await _charge_credit(task.report_request_id)
        else:
            _log.info(f"[{_rid}] Status {final_status} — kredit neodpočítaný")

        await update_report_status(
            task.report_request_id,
            final_status,
            result_file_path=str(final_path),
            company_name=company_name,
            verifa_score=verifa_score_snapshot,
        )

        # Send email notification to user via frontend API
        try:
            frontend_url = os.environ.get("NEXTAUTH_URL", "http://localhost:3000")
            worker_secret = os.environ.get("WORKER_SECRET", "")
            async with httpx.AsyncClient(timeout=10) as client:
                await client.post(
                    f"{frontend_url}/api/reports/{task.report_request_id}/notify",
                    headers={"x-worker-secret": worker_secret},
                )
        except Exception as notify_err:
            _log.warning(f"[{_rid}] Email notification failed: {notify_err}")

        t_end = time.perf_counter()
        log_token_summary()
        _log.info(
            f"[{_rid}] Report completed — total {t_end - t_start:.1f}s "
            f"(browser {t_browser - t_start:.1f}s, scrapers {t_scrape - t_browser:.1f}s, compile {t_compile - t_scrape:.1f}s) "
            f"sources: {_source_summary}"
        )
    except Exception as exc:
        # Ak celý worker zlyhá, report označíme ako FAILED.
        _log.error(f"[{_rid}] Report {task.report_request_id} failed", exc_info=True)
        await update_report_status(task.report_request_id, "FAILED")
        await create_bug_report(
            task.report_request_id,
            f"Výnimka: {type(exc).__name__}: {exc}",
        )
        raise
    finally:
        if browser:
            await browser.close()
        if playwright:
            await playwright.stop()
        # Pool je modulový singleton — nezatvárame ho po každej úlohe.


@app.post("/tasks", dependencies=[Depends(verify_worker_secret)])
async def create_task(task: ReportTask):
    """Prijme úlohu z Next.js API a okamžite vráti task ID."""
    # Pre jednoduchosť použijeme report_request_id ako task ID.
    # Okamžite nastavíme ai.queued, aby user videl aktivitu hneď (pred arq pickup).
    try:
        await update_report_ai_status(task.report_request_id, "ai.queued", 5)
    except Exception:
        pass  # DB update je best-effort — enqueue je dôležitejší
    await app.state.redis.enqueue_job('execute_report_task', task.dict())
    return {"taskId": task.report_request_id, "status": "accepted"}


@app.post("/tasks/{report_request_id}/cancel", dependencies=[Depends(verify_worker_secret)])
async def cancel_report_task(report_request_id: str):
    """Zruší arq job pre daný report (ak ešte beží)."""
    try:
        jobs = await app.state.redis.queued_jobs()
        for job in jobs:
            if job.func_name == "execute_report_task":
                task_dict = job.args[0] if job.args else {}
                if isinstance(task_dict, dict) and task_dict.get("report_request_id") == report_request_id:
                    await app.state.redis.abort_job(job.id)
                    logger.info(f"[{report_request_id}] arq job aborted: {job.id}")
                    return {"taskId": report_request_id, "status": "cancelled"}
        # Skús aj running jobs
        running = await app.state.redis.all_jobs()
        for job in running:
            if job.func_name == "execute_report_task":
                task_dict = job.args[0] if job.args else {}
                if isinstance(task_dict, dict) and task_dict.get("report_request_id") == report_request_id:
                    await app.state.redis.abort_job(job.id)
                    logger.info(f"[{report_request_id}] arq running job aborted: {job.id}")
                    return {"taskId": report_request_id, "status": "cancelled"}
    except Exception as e:
        logger.warning(f"[{report_request_id}] Cancel failed: {e}")
    return {"taskId": report_request_id, "status": "not_found_or_done"}


@app.get("/health")
async def health():
    return {"ok": True, "timestamp": datetime.now(timezone.utc).isoformat()}


@app.post("/reprocess/{report_request_id}", dependencies=[Depends(verify_worker_secret)])
async def reprocess_report(report_request_id: str):
    """Retrigger stuck report — načíte task z DB a spustí znova."""
    from prisma import Prisma
    db = Prisma()
    await db.connect()
    try:
        row = await db.reportrequest.find_unique(
            where={'id': report_request_id},
            include={'user': True},
        )
        if not row:
            raise HTTPException(status_code=404, detail="ReportRequest not found")
        
        task = ReportTask(
            report_request_id=row.id,
            ico=row.ico,
            target_type=row.targetType,
            orsr_extract_type="CURRENT",
            crz_date_from=None,
            vestnik_date_from=getattr(row.user, 'vestnikDateFrom', None).isoformat().split("T")[0] if getattr(row.user, 'vestnikDateFrom', None) else None,
            sources=list(row.selectedSources) if row.selectedSources else [],
            report_language=getattr(row.user, 'reportLanguage', None) or "sk",
        )
    finally:
        await db.disconnect()

    await app.state.redis.enqueue_job('execute_report_task', task.dict())
    return {"taskId": report_request_id, "status": "reprocessing"}


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("src.main:app", host="0.0.0.0", port=8000, reload=settings.app_env == "development")
