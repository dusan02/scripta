import asyncio
import logging
import os
from contextlib import suppress
from aiohttp import web
from arq.connections import RedisSettings
from arq import Worker
import sentry_sdk

# Nastavenie loggingu
logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(name)s - %(levelname)s - %(message)s")
logger = logging.getLogger("arq_worker")

# Sentry DSN init
sentry_dsn = os.getenv("SENTRY_DSN")
if sentry_dsn:
    sentry_sdk.init(
        dsn=sentry_dsn,
        traces_sample_rate=1.0,
    )
    logger.info("Sentry inicializované pre arq worker.")

redis_url = os.getenv("REDIS_URL", "redis://localhost:6379/0")

# HTTP server pre Healthcheck na port 8011
async def health_handler(request):
    return web.Response(text="OK", status=200)

async def start_healthcheck_server(ctx):
    app = web.Application()
    app.router.add_get('/health', health_handler)
    runner = web.AppRunner(app)
    await runner.setup()
    site = web.TCPSite(runner, '0.0.0.0', 8011)
    await site.start()
    ctx['http_runner'] = runner
    logger.info("Healthcheck HTTP server beží na porte 8011")

async def stop_healthcheck_server(ctx):
    if 'http_runner' in ctx:
        await ctx['http_runner'].cleanup()
        logger.info("Healthcheck HTTP server bol zastavený")

# Startup a Shutdown hooky
async def startup(ctx):
    logger.info("Spúšťam ARQ Workera...")
    from src.db_client import connect_db
    await connect_db()
    await start_healthcheck_server(ctx)

async def shutdown(ctx):
    logger.info("Vypínam ARQ Workera (Graceful Shutdown)...")
    await stop_healthcheck_server(ctx)
    from src.db_client import disconnect_db
    await disconnect_db()

# Hlavná funkcia na spracovanie
async def execute_report_task(ctx, task_dict: dict):
    from src.models import ReportTask
    from src.main import _execute_report_inner
    from arq import Retry

    task = ReportTask(**task_dict)
    ico = task.ico
    report_request_id = task.report_request_id
    job_try = ctx.get('job_try', 1)
    
    logger.info(f"Spracovávam IČO: {ico} (Pokus {job_try}/3)")

    try:
        # Volanie skutočnej orchestration funkcie
        await _execute_report_inner(task)
        logger.info(f"Úloha pre IČO {ico} bola úspešne dokončená.")
    except Exception as e:
        logger.error(f"Chyba pri spracovaní IČO {ico}: {e}", exc_info=True)
        if sentry_dsn:
            sentry_sdk.capture_exception(e)
            
        if job_try < 3:
            # Exponential backoff: 2s, 8s
            delay = 2 if job_try == 1 else 8
            logger.warning(f"Plánujem retry pre {ico} o {delay} sekúnd...")
            raise Retry(defer=delay)
        else:
            logger.error(f"Úloha pre IČO {ico} definitívne zlyhala po {job_try} pokusoch.")
            # V reálnom nasadení by sme tu aktualizovali DB status na ERROR
            raise

class WorkerSettings:
    functions = [execute_report_task]
    redis_settings = RedisSettings.from_dsn(redis_url)
    on_startup = startup
    on_shutdown = shutdown
    max_jobs = 2  # Concurrency limit vo workerovi
    job_timeout = 600  # 10 min
    keep_result = 3600
    allow_abort_jobs = True
