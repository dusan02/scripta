from __future__ import annotations
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional
import asyncio
import logging
import time
import random
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
from .db_client import connect_db, disconnect_db
from .s3_client import upload_report_file, is_s3_enabled
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
    get_verifa_score,
    save_company_persons,
    check_report_cancelled,
    ReportCancelledError,
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

# Scraper lock — garantuje že len 1 report súbežne používa browserless (8 contextov).
# AI/Auditor/Compile fázy môžu bežať paralelne bez tohto locku.
_scraper_lock: Optional[asyncio.Lock] = None

# PDF compile lock — garantuje že len 1 report súbežne spúšťa lokálny Chromium pre cover page.
# Zabraňuje RAM špičkám pri 2+ súbežných PDF kompiláciách (~300MB na proces).
_pdf_lock: Optional[asyncio.Lock] = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    if settings.app_env == "production" and not settings.worker_secret:
        raise RuntimeError("WORKER_SECRET must be set in production")

    global _report_semaphore, _scraper_lock, _pdf_lock
    _report_semaphore = asyncio.Semaphore(2)
    _scraper_lock = asyncio.Lock()
    _pdf_lock = asyncio.Lock()

    await connect_db()

    redis_url = os.getenv("REDIS_URL", "redis://localhost:6379/0")
    app.state.redis = await create_pool(RedisSettings.from_dsn(redis_url))
    
    cleanup_task = asyncio.create_task(_cleanup_loop())
    yield
    cleanup_task.cancel()
    await app.state.redis.close()
    await disconnect_db()


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


async def _extract_company_name(sources, target_type: str, ico: str = None) -> Optional[str]:
    """Extract company name from first successful scraper that has it.

    Fallback: ak žiadny scraper neextrahoval company_name (napr. ORSR zlyhal
    na F5 anti-bot), skús načítať z Company tabuľky (z ORSR bulk seed).
    """
    if target_type != "COMPANY":
        return None
    # 1. Skús scraper výsledky
    for s in sources:
        if s.status == "SUCCESS" and getattr(s, "company_name", None):
            return s.company_name
    # 2. Fallback: DB (z ORSR bulk seed — 515k+ firiem)
    if ico:
        try:
            from .db_repository import get_company_name_from_db
            db_name = await get_company_name_from_db(ico)
            if db_name:
                logger.info(f"Company name z DB fallback (ORSR scraper zlyhal): {db_name}")
                return db_name
        except Exception as e:
            logger.warning(f"DB fallback pre company_name zlyhal: {e}")
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
            if not getattr(source, "checked_at", None):
                source.checked_at = datetime.now(timezone.utc).isoformat()
            logger.debug(f"[WORKER] Source done: {source.source_type}:{source.status} ({_sources_done_count}/{_sources_total})")
            try:
                loop = asyncio.get_running_loop()
                t1 = loop.create_task(
                    upsert_single_report_source(task.report_request_id, source)
                )
                _background_tasks.add(t1)
                t1.add_done_callback(_background_tasks.discard)

                if source.source_type == "ORSR" and source.status == "SUCCESS":
                    if getattr(source, "company_name", None):
                        t2 = loop.create_task(
                            upsert_company_name(task.ico, source.company_name)
                        )
                        _background_tasks.add(t2)
                        t2.add_done_callback(_background_tasks.discard)
                    if getattr(source, "persons", None):
                        t2b = loop.create_task(
                            save_company_persons(task.ico, source.persons)
                        )
                        _background_tasks.add(t2b)
                        t2b.add_done_callback(_background_tasks.discard)

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

        _log.info(f"[{_rid}] Spúšťam {len(task.sources)} scraperov pre IČO: {task.ico}")

        async with _scraper_lock:
            _log.info(f"[{_rid}] Scraper lock acquired")

            # 3b: Globálny timeout 180s ako safety net. run_scrapers teraz:
            #   - má per-scraper timeout 90s (jeden pomalý register nezrúši batch)
            #   - pri CancelledError vráti už dokončené čiastičné výsledky
            # Ak globálny timeout vyprší, scraper_task sa zruší, ale run_scrapers
            # vráti results_by_source s dokončenými scrapermi + FAILED pre nedokončené.
            scraper_task = asyncio.ensure_future(
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
                    disable_circuit_breaker=True,  # Single-report mode: skús každý scraper
                )
            )
            try:
                sources = await asyncio.wait_for(scraper_task, timeout=300)
            except asyncio.TimeoutError:
                _log.warning(f"[{_rid}] Scraperi prekročili 300s limit — ruším bežiace scrapery, zachovávam dostupné výsledky.")
                scraper_task.cancel()
                try:
                    # run_scrapers pri CancelledError vráti čiastočné výsledky
                    sources = await scraper_task
                except asyncio.CancelledError:
                    # Ak sa aj run_scrapers zrušilo pred návratom, vytvoríme placeholdery
                    from src.models import ScrapedSource as _SS
                    sources = [
                        _SS(source_type=st, status="FAILED", status_message="Scraper timeout (180s)")
                        for st in task.sources
                    ]
                    _log.warning(f"[{_rid}] Timeout — {len(sources)} zdrojov označených ako FAILED.")

            if _background_tasks:
                await asyncio.gather(*_background_tasks, return_exceptions=True)

            t_scrape = time.perf_counter()
            _scrape_ms = int((t_scrape - t_browser) * 1000)
            await save_phase_duration(task.report_request_id, "scrapers", _scrape_ms)
            _source_summary = ', '.join(f'{s.source_type}:{s.status}' for s in sources)
            _log.info(f"[{_rid}] Scrapers done ({t_scrape - t_browser:.1f}s): {_source_summary}")

            # ── HARD STOP: ORSR nenájdené IČO or invalid IČO format ─────────────
            orsr_result = next((s for s in sources if s.source_type == "ORSR"), None)
            if orsr_result and orsr_result.status == "FAILED":
                msg = (orsr_result.status_message or "").lower()
                if "neexistuje" in msg or "neplatné ičo" in msg:
                    _log.error(f"[{_rid}] HARD STOP: IČO {task.ico} — {orsr_result.status_message}")
                    await update_report_status(task.report_request_id, "FAILED")
                    await update_report_ai_status(task.report_request_id, "failed.orsr_not_found", 0)
                    return

        _log.info(f"[{_rid}] Scraper lock released (initial scrape done)")

        # ── Retry failed/unavailable scrapers (exponential backoff with jitter) ──
        # Retry loop runs OUTSIDE _scraper_lock — sleeps don't block other reports.
        # Lock is acquired only for the duration of each run_scrapers call.
        # 3c: Retry aj UNAVAILABLE (register bol nedostupný — presne to čo retry rieši)
        # 3a: Exponential backoff: ~2s, ~5s, ~15s, ~30s, ~60s (with ±30% jitter) — max 5 pokusov
        # 3b: Total retry budget 600s — skip ďalšie passy ak sme nad limit
        # 3d: Retry len UNAVAILABLE a TIMEOUT (network issues) — nie FAILED z interných chýb
        # 3h: Browser health check pred každým retry passom
        # 5. pass (60s delay) — pre veľmi pomalé registre ktoré sa zotavujú pomaly
        _RETRY_DELAYS = [2, 5, 15, 30, 60]
        _RETRY_TOTAL_BUDGET = 600  # sekundy — max čas na všetky retry passy (vrátane scraper execution)
        # Snapshot pre-retry failure count — post-retry merge by tento údaj prekazil
        _initial_failed = sum(1 for s in sources if s.status in ("FAILED", "UNAVAILABLE"))
        _retry_elapsed = 0.0
        retry_pass = 0
        for retry_pass, base_delay in enumerate(_RETRY_DELAYS):
            # 3d: Retry len network-related stavy, nie interné chyby (bugy sa nepotvrdia znova)
            retryable_sources = [
                s for s in sources
                if s.status == "UNAVAILABLE"
                or (s.status == "FAILED" and ("timeout" in (s.status_message or "").lower() or "unreachable" in (s.status_message or "").lower()))
            ]
            if not retryable_sources:
                break

            # 3b: Total budget check — skip ďalšie passy
            if _retry_elapsed >= _RETRY_TOTAL_BUDGET:
                _log.info(f"[{_rid}] Retry budget exhausted ({_retry_elapsed:.0f}s) — skipping pass {retry_pass + 1}")
                break

            # 3a: Jitter ±30% na base delay (anti-thundering-herd)
            delay = base_delay * random.uniform(0.7, 1.3)
            retryable_types = [s.source_type for s in retryable_sources]
            _log.info(f"[{_rid}] Retry pass {retry_pass + 1}/{len(_RETRY_DELAYS)}: {len(retryable_types)} scrapers: {retryable_types} (delay {delay:.1f}s, elapsed {_retry_elapsed:.0f}s)")
            await update_report_ai_status(task.report_request_id, "ai.retrying", 60)
            _retry_delay_start = time.perf_counter()
            await asyncio.sleep(delay)  # ← Sleep OUTSIDE lock — other reports can scrape
            _retry_elapsed += time.perf_counter() - _retry_delay_start
            _retry_run_start = time.perf_counter()

            # 3h: Browser health check pred retry — ak browser spadol, re-launch
            if browser:
                try:
                    _ = browser.contexts
                    if not browser.contexts:
                        raise RuntimeError("Browser has no contexts")
                except Exception as browser_err:
                    _log.warning(f"[{_rid}] Browser unhealthy before retry pass {retry_pass + 1}: {browser_err} — re-launching.")
                    try:
                        await browser.close()
                    except Exception:
                        pass
                    from src.browser_manager import browser_manager
                    browser = await browser_manager.get_browser(playwright)
                    _log.info(f"[{_rid}] Browser re-launched for retry pass {retry_pass + 1}.")

            # Acquire lock only for the scraper run, not for the sleep
            async with _scraper_lock:
                _log.info(f"[{_rid}] Scraper lock re-acquired for retry pass {retry_pass + 1}")
                retry_results = await run_scrapers(
                    sources=retryable_types,
                    output_dir=report_dir,
                    browser=browser,
                    target_type=task.target_type,
                    ico=task.ico,
                    report_language=task.report_language or "sk",
                    orsr_extract_type=task.orsr_extract_type,
                    crz_date_from=task.crz_date_from,
                    rozhodnutia_date_from=task.rozhodnutia_date_from,
                    disable_circuit_breaker=True,  # Retry pass: skús aj circuit-open scrapery
                )
            _log.info(f"[{_rid}] Scraper lock released after retry pass {retry_pass + 1}")
            # Počítaj aj execution čas scraperov, nie len sleep delays — inak budget nikdy nevyprší
            _retry_elapsed += time.perf_counter() - _retry_run_start

            # Merge retry results back into sources
            retry_map = {r.source_type: r for r in retry_results}
            for i, s in enumerate(sources):
                if s.source_type in retry_map:
                    retry_result = retry_map[s.source_type]
                    if retry_result.status == "SUCCESS":
                        _log.info(f"[{_rid}] Retry pass {retry_pass + 1} succeeded for {s.source_type}")
                        if not getattr(retry_result, "checked_at", None):
                            retry_result.checked_at = datetime.now(timezone.utc).isoformat()
                        sources[i] = retry_result
                    else:
                        _log.warning(f"[{_rid}] Retry pass {retry_pass + 1} failed again for {s.source_type}: {retry_result.status}")

        # Log final retry outcome
        still_failed = [s.source_type for s in sources if s.status in ("FAILED", "UNAVAILABLE")]
        if still_failed:
            _log.warning(f"[{_rid}] Scrapery stále zlyhané po {retry_pass + 1} retry passoch ({_retry_elapsed:.0f}s): {still_failed}")

        # Pipeline-level retry metrics summary
        # _initial_failed = snapshot pred retry loopom (computed above, before first pass)
        _final_success = sum(1 for s in sources if s.status == "SUCCESS")
        if retry_pass > 0 or _initial_failed > 0:
            _recovered = _final_success - (len(sources) - _initial_failed)
            _log.info(
                f"[{_rid}] Pipeline retry summary: passes={retry_pass + 1}, "
                f"initial_failed={_initial_failed}, recovered={max(0, _recovered)}, "
                f"still_failed={len(still_failed)}, elapsed={_retry_elapsed:.0f}s"
            )

        await upsert_report_sources(task.report_request_id, sources)

        # Reset retry metrics pre ďalší report
        from src.scrapers.base import reset_retry_metrics
        reset_retry_metrics()

        # ── Cancellation check #1: before AI pipeline (most expensive phase) ──
        await check_report_cancelled(task.report_request_id)

        company_name = await _extract_company_name(sources, task.target_type, task.ico)

        # 3h: Browser health check — ak browser spadol počas scrapovania, re-launch
        if browser:
            try:
                pages = browser.contexts
                if not pages:
                    raise RuntimeError("Browser has no contexts")
            except Exception as browser_err:
                _log.warning(f"[{_rid}] Browser unhealthy after scrapers: {browser_err} — re-launching.")
                try:
                    if browser:
                        await browser.close()
                except Exception:
                    pass
                from src.browser_manager import browser_manager
                browser = await browser_manager.get_browser(playwright)
                _log.info(f"[{_rid}] Browser re-launched for AI pipeline phase.")

        # Spustíme AI pipeline, PDF Reader Agent a ORSR Forensic Agent paralelne
        # process_company dostáva ruz_files a ov_events zo scraper fázy — bez duplikátneho stiahnutia
        t_ai_wait = time.perf_counter()
        parallel_tasks = []
        if task.target_type == "COMPANY" and task.ico:
            ruz_source = next((s for s in sources if s.source_type == "REGISTER_UZ" and s.status == "SUCCESS"), None)
            ruz_files = (ruz_source.raw_data or []) if ruz_source else None

            # CRITICAL: Ak RÚZ scraper zlyhal (UNAVAILABLE/FAILED po retryoch), pipeline sa pokúsi o vlastný download,
            # ale ak aj ten zlyhá, report bude bez finančných údajov — toto je slepá škvrna.
            if not ruz_source:
                ruz_failed = next((s for s in sources if s.source_type == "REGISTER_UZ"), None)
                if ruz_failed and ruz_failed.status in ("UNAVAILABLE", "FAILED"):
                    _log.error(f"[{_rid}] CRITICAL: RÚZ scraper {ruz_failed.status} po retryoch — finančné údaje môžu chýbať! IČO={task.ico}")
                else:
                    _log.warning(f"[{_rid}] RÚZ scraper nevrátil žiadne súbory pre IČO {task.ico} — pipeline skúsi vlastný download")

            ov_source = next((s for s in sources if s.source_type == "OBCHODNY_VESTNIK" and s.status == "SUCCESS"), None)
            ov_events: Optional[list] = None
            if ov_source and ov_source.findings:
                try:
                    import json as _json
                    ov_events = _json.loads(ov_source.findings)
                except Exception:
                    ov_events = None

            parallel_tasks.append(asyncio.create_task(
                process_company(
                    task.ico, task.report_request_id,
                    report_language=task.report_language or "sk",
                    ruz_files=ruz_files,
                    ov_events=ov_events,
                )
            ))
        if sources:
            from src.pipeline import run_pdf_reader_agent, run_orsr_forensics_agent
            parallel_tasks.append(asyncio.create_task(
                run_pdf_reader_agent(task.ico, sources, report_language=task.report_language or "sk")
            ))
            parallel_tasks.append(asyncio.create_task(
                run_orsr_forensics_agent(task.ico, sources, report_language=task.report_language or "sk")
            ))
        _failed_agents: list[str] = []
        _agent_names = []
        if task.target_type == "COMPANY" and task.ico:
            _agent_names.append("Financial Pipeline")
        if sources:
            _agent_names.append("PDF Reader")
            _agent_names.append("ORSR Forensic")

        if parallel_tasks:
            results_ai = await asyncio.gather(*parallel_tasks, return_exceptions=True)
            for name, res in zip(_agent_names, results_ai):
                if isinstance(res, asyncio.CancelledError):
                    _log.info(f"[{_rid}] AI task zrušený: {name}")
                    _failed_agents.append(name)
                elif isinstance(res, Exception):
                    _log.error(f"[{_rid}] AI task zlyhal ({name}): {res}", exc_info=True)
                    _failed_agents.append(name)
                elif res is False:
                    _log.warning(f"[{_rid}] Agent zlyhal (vrátil False): {name}")
                    _failed_agents.append(name)
            if _failed_agents:
                _log.warning(f"[{_rid}] Zlyhané agenty: {_failed_agents} — Chief Auditor dostane varovanie")
        t_ai_done = time.perf_counter()
        _ai_ms = int((t_ai_done - t_ai_wait) * 1000)
        await save_phase_duration(task.report_request_id, "ai", _ai_ms)

        # ── Cancellation check #2: before Chief Auditor + compile ──
        await check_report_cancelled(task.report_request_id)

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
                    from src.db_client import get_db
                    _db = get_db()
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
                    await run_and_save_audit_verdict(task.ico, report_language=task.report_language or "sk", failed_agents=_failed_agents or None, registry_sources=sources, report_request_id=task.report_request_id)
                # —— Snapshot skóre: prečítame aktuálny AuditVerdict a fixujeme na tento report ——
                verifa_score_snapshot = await get_verifa_score(task.ico)
                if verifa_score_snapshot:
                    _log.info(f"[{_rid}] verifaScore snapshot: {verifa_score_snapshot}")
            except Exception as verdict_err:
                _log.error(f"[{_rid}] Chief Auditor zlyhal pre {task.ico}: {verdict_err}", exc_info=True)
            finally:
                t_auditor_end = time.perf_counter()
                await save_phase_duration(task.report_request_id, "auditor", int((t_auditor_end - t_auditor_start) * 1000))

        # ETA pre kompiláciu: phase-aware z historických dát
        compile_eta = int(hist_compile) if hist_compile else (20 + int(source_count * 1.5))
        await update_report_ai_status(task.report_request_id, "ai.risk_synthesis", compile_eta + 5)
        await update_report_ai_status(task.report_request_id, "ai.compiling", compile_eta)

        # ── Cancellation check #3: before PDF compile + S3 upload ──
        await check_report_cancelled(task.report_request_id)

        compiler = PdfCompiler(settings.results_dir)
        t_compile_start = time.perf_counter()
        async with _pdf_lock:
            _log.info(f"[{_rid}] PDF compile lock acquired")
            with PhaseTimer("PDF compile"):
                final_path = await compiler.compile(
                    report_request_id=task.report_request_id,
                    target_type=task.target_type,
                    identifier=_identifier(task),
                    sources=sources,
                    company_name=company_name,
                    report_language=task.report_language or "sk",
                    vestnik_date_from=task.vestnik_date_from,
                    attachments_config=task.attachments_config,
                )
            _log.info(f"[{_rid}] PDF compile lock released")
        t_compile = time.perf_counter()
        await save_phase_duration(task.report_request_id, "compile", int((t_compile - t_compile_start) * 1000))
        _log.info(f"[{_rid}] PDF compiled: {final_path.name}")

        # Aktualizujeme pageCount v DB podľa reálnych hodnôt zistených compilerom
        await update_source_page_counts(task.report_request_id, sources)

        # Upload the final PDF to S3 (or fall back to local path in dev mode).
        # The returned value is the S3 object key (e.g. "reports/{id}/evidence_binder.pdf")
        # or a "local://" prefixed path when S3 is not configured.
        # upload_report_file has built-in retry with exponential backoff (3 attempts).
        # If all retries fail, mark the report as FAILED so it doesn't stay stuck in PROCESSING.
        try:
            s3_key = upload_report_file(final_path, task.report_request_id, ico=task.ico)
            _log.info(f"[{_rid}] Report file stored: {s3_key}")
        except Exception as upload_err:
            _log.error(f"[{_rid}] S3 upload failed after all retries: {upload_err}")
            await update_report_status(
                task.report_request_id,
                "FAILED",
                result_file_path=None,
                company_name=company_name,
                verifa_score=verifa_score_snapshot,
            )
            await create_bug_report(
                task.report_request_id,
                f"S3 upload failed after retries: {upload_err}",
            )
            raise

        # Cleanup medziproduktov — ponechať len evidence_binder.pdf
        # (In S3 mode, the local copy is also cleaned up after upload.)
        try:
            for f in report_dir.glob("*.pdf"):
                if f.name != "evidence_binder.pdf":
                    f.unlink()
            debug_dir = report_dir / "debug"
            if debug_dir.exists():
                shutil.rmtree(debug_dir, ignore_errors=True)
            # In S3 mode, remove the local evidence_binder.pdf too — it's
            # safely in the cloud. In local mode, keep it for download.
            if is_s3_enabled():
                final_path.unlink(missing_ok=True)
                _log.debug(f"[{_rid}] Cleanup: local PDF removed (uploaded to S3)")
            else:
                _log.debug(f"[{_rid}] Cleanup: medziprodukty zmazané (local mode)")
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

        # Credits are deducted on the frontend before enqueuing.
        # If the report FAILED, request a refund from the frontend Wallet system.
        if final_status == "FAILED":
            _log.info(f"[{_rid}] Status FAILED — requesting credit refund")
        elif final_status != "COMPLETED":
            _log.info(f"[{_rid}] Status {final_status} — no credit operation (deducted on frontend)")

        await update_report_status(
            task.report_request_id,
            final_status,
            result_file_path=s3_key,
            company_name=company_name,
            verifa_score=verifa_score_snapshot,
        )

        # BUG 4: Update aiStatus to "completed" after successful compile
        # Previously, aiStatus stayed at "ai.compiling" even after the report finished
        if final_status in ("COMPLETED", "PARTIAL"):
            try:
                await update_report_ai_status(task.report_request_id, "completed", 0)
            except Exception:
                pass  # best-effort

        # Request credit refund from frontend if report FAILED
        if final_status == "FAILED":
            try:
                frontend_url = os.environ.get("NEXTAUTH_URL", "http://localhost:3000")
                worker_secret = os.environ.get("WORKER_SECRET", "")
                async with httpx.AsyncClient(timeout=10) as client:
                    await client.post(
                        f"{frontend_url}/api/reports/{task.report_request_id}/refund",
                        headers={"x-worker-secret": worker_secret},
                    )
                _log.info(f"[{_rid}] Credit refund requested")
            except Exception as refund_err:
                _log.warning(f"[{_rid}] Credit refund request failed: {refund_err}")

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
        # Request credit refund from frontend
        try:
            frontend_url = os.environ.get("NEXTAUTH_URL", "http://localhost:3000")
            worker_secret = os.environ.get("WORKER_SECRET", "")
            async with httpx.AsyncClient(timeout=10) as client:
                await client.post(
                    f"{frontend_url}/api/reports/{task.report_request_id}/refund",
                    headers={"x-worker-secret": worker_secret},
                )
            _log.info(f"[{_rid}] Credit refund requested (exception path)")
        except Exception as refund_err:
            _log.warning(f"[{_rid}] Credit refund request failed (exception path): {refund_err}")
        raise
    finally:
        # browser.close() môže vyhodiť výnimku (browser už crashol, connection
        # timeout) — musíme ju zachytiť, inak sa playwright.stop() nevykoná
        # a playwright proces zostane bežať (memory/process leak).
        if browser:
            try:
                await browser.close()
            except Exception as close_err:
                _log.warning(f"[{_rid}] Browser close error in finally: {close_err}")
        if playwright:
            try:
                await playwright.stop()
            except Exception as stop_err:
                _log.warning(f"[{_rid}] Playwright stop error in finally: {stop_err}")
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
    """Zruší arq job pre daný report (ak ešte beží alebo je v queue).

    arq 0.28 nepoužíva abort_job() — namiesto toho worker periodicke kontroluje
    sorted set 'arq:abort' a volá task.cancel() na nájdené joby.
    Pozri arq.Worker._cancel_aborted_jobs().
    """
    from arq.constants import abort_jobs_ss
    from arq.utils import timestamp_ms

    try:
        redis = app.state.redis
        aborted_ids = []

        # 1. queued jobs — majú job_id, pridáme do abort setu
        jobs = await redis.queued_jobs()
        for job in jobs:
            if job.function == "execute_report_task":
                task_dict = job.args[0] if job.args else {}
                if isinstance(task_dict, dict) and task_dict.get("report_request_id") == report_request_id:
                    await redis.zadd(abort_jobs_ss, {job.job_id: timestamp_ms()})
                    aborted_ids.append(job.job_id)
                    logger.info(f"[{report_request_id}] arq queued job marked for abort: {job.job_id}")

        # 2. running jobs — arq neexponuje zoznam bežiacich jobov cez API,
        #    ale job_id je v logoch. Ako fallback skúsime abort set s report_id
        #    ako kľúčom — arq worker ignoruje neznáme job_id v abort sete.
        #    Frontend už nastaví status=CANCELLED v DB, takže aj keď task
        #    beží ďalej, výsledok sa nepoužije (report už nie je PROCESSING).

        if aborted_ids:
            return {"taskId": report_request_id, "status": "cancelled", "abortedJobs": aborted_ids}

        # 3. Žiadny queued job — buď už beží, alebo už skončil.
        #    Frontend oznámi userovi "cancelled" aj tak (DB status = CANCELLED).
        logger.info(f"[{report_request_id}] No queued arq job found — already running or done")
        return {"taskId": report_request_id, "status": "not_found_or_done"}
    except Exception as e:
        logger.warning(f"[{report_request_id}] Cancel failed: {e}")
        return {"taskId": report_request_id, "status": "error", "error": str(e)}


@app.get("/health")
async def health():
    return {"ok": True, "timestamp": datetime.now(timezone.utc).isoformat()}


@app.post("/reprocess/{report_request_id}", dependencies=[Depends(verify_worker_secret)])
async def reprocess_report(report_request_id: str):
    """Retrigger stuck report — načíte task z DB a spustí znova."""
    from src.db_client import get_db
    db = get_db()
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
        attachments_config=row.attachmentsConfig if hasattr(row, 'attachmentsConfig') else None,
    )

    # Reset status na PROCESSING pred enqueue — inak check_report_cancelled
    # zistí starý FAILED/COMPLETED status a zruší reprocess hneď na začiatku.
    # Reset aj createdAt — frontend recover-stuck cron označí PROCESSING reporty
    # staršie ako 30 min (podľa createdAt) ako FAILED, čo by zabil reprocess.
    # Pozor: musí byť UTC (datetime.utcnow), nie datetime.now() — Prisma/DB
    # ukladá timestamp bez timezone, frontend interpretuje ako UTC→local.
    # datetime.now() v CEST containeri by posunulo createdAt o +2h do budúcnosti.
    await db.reportrequest.update(
        where={'id': report_request_id},
        data={'status': 'PROCESSING', 'completedAt': None, 'createdAt': datetime.now(timezone.utc)},
    )

    await app.state.redis.enqueue_job('execute_report_task', task.dict())
    return {"taskId": report_request_id, "status": "reprocessing"}


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("src.main:app", host="0.0.0.0", port=8000, reload=settings.app_env == "development")
