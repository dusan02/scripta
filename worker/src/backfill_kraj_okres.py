"""
Targeted backfill: populate Company.kraj and Company.okres from RÚZ API.

Per ARCH-RUZ-001: raw API values only. No transformation, no city→region mapping.
Per frozen contract Task 2: update ONLY kraj/okres. No other Company fields touched.

Enforcement:
  - Update-only: UPDATE Company SET kraj=?, okres=? WHERE ico=? — no upsert, no other fields.
  - Checkpointing: resumable from last processed IČO (HIST-002).
  - Rate limit: max 3 concurrent RÚZ calls, 300ms delay between calls (architecture rules).
  - Retry/backoff: exponential backoff on 429/5xx, max 3 retries.
  - NULL is legitimate: if API doesn't provide kraj/okres, write NULL (DATA-001).
  - Raw values: store exactly what API returns (e.g. "SK010", "SK0105").

Usage:
  python -m src.backfill_kraj_okres                    # Full backfill
  python -m src.backfill_kraj_okres --max 1000         # First 1000 companies only
  python -m src.backfill_kraj_okres --resume           # Resume from checkpoint
  python -m src.backfill_kraj_okres --dry-run          # Fetch API, log, but don't write DB
  python -m src.backfill_kraj_okres --ico 00684881     # Single company (for testing)

Exit codes:
  0 = success (all processed or --max reached)
  1 = error (logged, checkpoint saved for resume)
"""

from __future__ import annotations

import argparse
import asyncio
import json
import logging
import os
import sys
import time
from pathlib import Path
from typing import Optional

import asyncpg
import httpx

# Add worker src to path for imports
sys.path.insert(0, str(Path(__file__).parent))

logger = logging.getLogger(__name__)

RUZ_API = "https://www.registeruz.sk/cruz-public/api"
UA = "Verifa.sk/1.0 (+https://verifa.sk)"
TIMEOUT = 30.0

# Rate limits per architecture rules
MAX_CONCURRENT = 3          # max 3 concurrent RÚZ calls
CALL_DELAY = 0.3            # 300ms delay between calls
MAX_RETRIES = 3             # exponential backoff on 429/5xx

CHECKPOINT_FILE = "backfill_kraj_okres_checkpoint.json"

# Stats
_stats = {
    "processed": 0,
    "updated": 0,
    "kraj_set": 0,
    "okres_set": 0,
    "both_set": 0,
    "null_written": 0,
    "api_errors": 0,
    "retry_count": 0,
    "not_found": 0,
    "skipped_already_set": 0,
}


# ── Checkpoint ──────────────────────────────────────────────────────────────

def load_checkpoint() -> dict:
    p = Path(CHECKPOINT_FILE)
    if p.exists():
        return json.loads(p.read_text())
    return {"last_ico": None, "processed": 0, "updated": 0}


def save_checkpoint(cp: dict) -> None:
    Path(CHECKPOINT_FILE).write_text(json.dumps(cp, indent=2))


# ── RÚZ API ─────────────────────────────────────────────────────────────────

async def ruz_get(
    client: httpx.AsyncClient,
    endpoint: str,
    params: dict,
) -> Optional[dict]:
    """GET with retry/backoff on 429/5xx. Returns None on persistent failure."""
    url = f"{RUZ_API}/{endpoint}"
    for attempt in range(MAX_RETRIES + 1):
        try:
            resp = await client.get(url, params=params, headers={"User-Agent": UA}, timeout=TIMEOUT)
            if resp.status_code == 200:
                return resp.json()
            if resp.status_code in (429, 502, 503, 504):
                _stats["retry_count"] += 1
                wait = 2 ** attempt
                logger.warning(f"RUZ {resp.status_code} for {endpoint}, retry in {wait}s (attempt {attempt+1}/{MAX_RETRIES+1})")
                await asyncio.sleep(wait)
                continue
            # 404, 403, etc. — not retryable
            logger.debug(f"RUZ {resp.status_code} for {endpoint} params={params}")
            return None
        except (httpx.TimeoutException, httpx.ConnectError, httpx.ReadError, httpx.RemoteProtocolError, httpx.PoolTimeout) as e:
            _stats["retry_count"] += 1
            wait = 2 ** attempt
            logger.warning(f"RUZ error for {endpoint}: {e}, retry in {wait}s (attempt {attempt+1}/{MAX_RETRIES+1})")
            await asyncio.sleep(wait)
    _stats["api_errors"] += 1
    return None


async def fetch_kraj_okres(
    client: httpx.AsyncClient,
    ico: str,
    ruz_entity_id: Optional[int],
) -> Optional[tuple[Optional[str], Optional[str]]]:
    """Fetch kraj/okres for a single company from RÚZ API.
    Returns (kraj, okres) tuple, or None if entity not found.
    NULL is a legitimate value — (None, None) means API returned entity but no geo fields.

    Uses stored ruzEntityId when available (94.69% of companies) to fetch the correct
    entity. RÚZ API can return multiple entity IDs for one IČO (a company may have
    multiple accounting records over time). Using ruzEntityId ensures we fetch the
    same entity that was originally seeded. Falls back to IČO lookup only if
    ruzEntityId is NULL.
    """
    if ruz_entity_id is not None:
        # Direct fetch by stored entity ID — correct entity guaranteed
        entity = await ruz_get(client, "uctovna-jednotka", {"id": ruz_entity_id})
        if not entity:
            _stats["api_errors"] += 1
            return None
    else:
        # Fallback: IČO lookup (ruzEntityId was NULL — 5.3% of companies)
        eids = await ruz_get(client, "uctovne-jednotky", {"ico": ico, "zmenene-od": "2000-01-01", "max-zaznamov": 10})
        if not eids or not eids.get("id"):
            _stats["not_found"] += 1
            return None
        entity_id = eids["id"][0]
        entity = await ruz_get(client, "uctovna-jednotka", {"id": entity_id})
        if not entity:
            _stats["api_errors"] += 1
            return None

    # Raw API values — no transformation per ARCH-RUZ-001
    kraj = entity.get("kraj")  # None if absent — legitimate per DATA-001
    okres = entity.get("okres")
    return (kraj, okres)


# ── DB ──────────────────────────────────────────────────────────────────────

async def get_companies_batch(
    pool: asyncpg.Pool,
    resume_ico: Optional[str],
    batch_limit: int,
    target_ico: Optional[str],
) -> list[tuple[str, Optional[int]]]:
    """Get next batch of (ico, ruzEntityId) to process, ordered by ico.
    Only returns companies where kraj IS NULL (not yet backfilled).
    Uses small batch_limit to avoid full-table-scan timeouts."""
    if target_ico:
        rows = await pool.fetch(
            """SELECT ico, "ruzEntityId" FROM "Company" WHERE ico = $1""",
            target_ico,
        )
        return [(r["ico"], r["ruzEntityId"]) for r in rows]

    if resume_ico:
        rows = await pool.fetch(
            """SELECT ico, "ruzEntityId" FROM "Company"
               WHERE "kraj" IS NULL AND ico > $1
               ORDER BY ico
               LIMIT $2""",
            resume_ico,
            batch_limit,
        )
    else:
        rows = await pool.fetch(
            """SELECT ico, "ruzEntityId" FROM "Company"
               WHERE "kraj" IS NULL
               ORDER BY ico
               LIMIT $1""",
            batch_limit,
        )
    return [(r["ico"], r["ruzEntityId"]) for r in rows]


async def update_kraj_okres(
    pool: asyncpg.Pool,
    ico: str,
    kraj: Optional[str],
    okres: Optional[str],
) -> None:
    """UPDATE ONLY kraj/okres. No other fields touched. No upsert."""
    await pool.execute(
        """UPDATE "Company" SET "kraj" = $1, "okres" = $2 WHERE ico = $3""",
        kraj, okres, ico,
    )


# ── Main backfill ───────────────────────────────────────────────────────────

async def process_one(
    client: httpx.AsyncClient,
    pool: asyncpg.Pool,
    ico: str,
    ruz_entity_id: Optional[int],
    dry_run: bool,
    sem: asyncio.Semaphore,
) -> None:
    async with sem:
        result = await fetch_kraj_okres(client, ico, ruz_entity_id)
        _stats["processed"] += 1

        if result is None:
            # Not found or API error — already counted in fetch_kraj_okres
            if not dry_run:
                # Write NULL to mark as processed (avoid re-processing on resume)
                await update_kraj_okres(pool, ico, None, None)
                _stats["null_written"] += 1
            return

        kraj, okres = result

        if dry_run:
            logger.info(f"[DRY-RUN] {ico}: kraj={kraj!r}, okres={okres!r}")
            return

        await update_kraj_okres(pool, ico, kraj, okres)
        _stats["updated"] += 1
        if kraj is not None:
            _stats["kraj_set"] += 1
        if okres is not None:
            _stats["okres_set"] += 1
        if kraj is not None and okres is not None:
            _stats["both_set"] += 1
        if kraj is None and okres is None:
            _stats["null_written"] += 1

        # Rate limit: 300ms delay between calls
        await asyncio.sleep(CALL_DELAY)


async def main(args: argparse.Namespace):
    logging.basicConfig(
        level=logging.INFO if not args.verbose else logging.DEBUG,
        format="%(asctime)s [%(levelname)s] %(message)s",
        handlers=[logging.StreamHandler()],
    )

    db_url = os.environ.get("DATABASE_URL")
    if not db_url:
        logger.error("DATABASE_URL not set")
        sys.exit(1)

    # Convert postgresql:// to asyncpg-compatible (asyncpg handles standard URL)
    pool = await asyncpg.create_pool(
        dsn=db_url,
        min_size=2,
        max_size=5,
        command_timeout=120,
    )
    logger.info("DB pool connected")

    cp = load_checkpoint() if args.resume else {"last_ico": None, "processed": 0, "updated": 0}
    if args.resume:
        logger.info(f"Resuming from checkpoint: last_ico={cp['last_ico']}, processed={cp['processed']}, updated={cp['updated']}")

    # Process in fetch batches — fetch small batch from DB, process, fetch next.
    # This avoids full-table-scan timeouts on the initial query.
    FETCH_BATCH = 5000       # rows fetched from DB per round
    PROCESS_BATCH = 500      # rows processed concurrently per round
    total_target = args.max  # None = process all

    sem = asyncio.Semaphore(MAX_CONCURRENT)
    limits = httpx.Limits(max_connections=MAX_CONCURRENT, max_keepalive_connections=MAX_CONCURRENT)

    start_time = time.perf_counter()

    async with httpx.AsyncClient(limits=limits) as client:
        while True:
            if total_target and _stats["processed"] >= total_target:
                logger.info(f"Reached --max limit ({total_target})")
                break

            # Fetch next batch from DB
            fetch_limit = FETCH_BATCH
            if total_target:
                fetch_limit = min(FETCH_BATCH, total_target - _stats["processed"])

            companies = await get_companies_batch(pool, cp["last_ico"], fetch_limit, args.ico)
            if not companies:
                logger.info("No more companies to process — all done.")
                break

            total_in_batch = len(companies)
            logger.info(f"Fetched {total_in_batch} companies (last_ico={cp['last_ico']})")

            # Process in sub-batches for concurrency control
            for i in range(0, total_in_batch, PROCESS_BATCH):
                sub = companies[i:i + PROCESS_BATCH]
                tasks = [process_one(client, pool, ico, eid, args.dry_run, sem) for ico, eid in sub]
                await asyncio.gather(*tasks)

                # Update checkpoint after each sub-batch
                cp["last_ico"] = sub[-1][0]
                cp["processed"] = _stats["processed"]
                cp["updated"] = _stats["updated"]
                save_checkpoint(cp)

                elapsed = time.perf_counter() - start_time
                rate = _stats["processed"] / max(elapsed, 1)
                logger.info(
                    f"Progress: processed={_stats['processed']} "
                    f"updated={_stats['updated']} "
                    f"kraj_set={_stats['kraj_set']} "
                    f"okres_set={_stats['okres_set']} "
                    f"nulls={_stats['null_written']} "
                    f"not_found={_stats['not_found']} "
                    f"errors={_stats['api_errors']} "
                    f"retries={_stats['retry_count']} "
                    f"rate={rate:.1f}/s "
                    f"last_ico={cp['last_ico']}"
                )

    await pool.close()

    # Final stats
    logger.info("=" * 60)
    logger.info("BACKFILL COMPLETE — Final Stats")
    logger.info("=" * 60)
    logger.info(f"  companies_total_processed: {_stats['processed']}")
    logger.info(f"  updated: {_stats['updated']}")
    logger.info(f"  kraj_set: {_stats['kraj_set']}")
    logger.info(f"  okres_set: {_stats['okres_set']}")
    logger.info(f"  both_present: {_stats['both_set']}")
    logger.info(f"  null_written: {_stats['null_written']}")
    logger.info(f"  not_found: {_stats['not_found']}")
    logger.info(f"  api_errors: {_stats['api_errors']}")
    logger.info(f"  retry_count: {_stats['retry_count']}")
    logger.info(f"  elapsed: {time.perf_counter() - start_time:.1f}s")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Backfill Company.kraj/okres from RÚZ API")
    parser.add_argument("--max", type=int, help="Max companies to process")
    parser.add_argument("--resume", action="store_true", help="Resume from checkpoint")
    parser.add_argument("--dry-run", action="store_true", help="Fetch API but don't write DB")
    parser.add_argument("--ico", type=str, help="Process single IČO (for testing)")
    parser.add_argument("--verbose", action="store_true", help="Debug logging")
    args = parser.parse_args()
    asyncio.run(main(args))
