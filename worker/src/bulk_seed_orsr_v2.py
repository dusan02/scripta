"""
ORSR Bulk Seed V2 — Cursor-based pagination (no OFFSET).

Key improvements over V1 (bulk_seed_orsr.py):
  1. Cursor-based: WHERE ico > :last_ico (no OFFSET drift on mutating result set)
  2. Reusable OrsrScraper instance (no per-company instantiation)
  3. No PDF generation for bulk (skip_playwright=True — data extraction only)
  4. Parameterized SQL (no string concatenation)
  5. Idempotent checkpoint with last_ico cursor
  6. Bounded concurrency with asyncio.Semaphore
  7. DB is the final idempotency guard: orsrSyncedAt IS NOT NULL
  8. Single-worker lock via flock (prevents concurrent V2 instances)
  9. Atomic Company + CompanyPerson writes via DB transaction

Usage:
  python -m src.bulk_seed_orsr_v2 --max 500              # Pilot: 500 companies
  python -m src.bulk_seed_orsr_v2 --resume               # Resume from checkpoint
  python -m src.bulk_seed_orsr_v2 --ico 36000019          # Single company
  python -m src.bulk_seed_orsr_v2 --concurrency 15        # 15 parallel workers
  python -m src.bulk_seed_orsr_v2 --max 500 --resume      # Resume, cap at 500 more
  python -m src.bulk_seed_orsr_v2 --retry-failed          # Retry failed ICOs from checkpoint
  python -m src.bulk_seed_orsr_v2 --only-with-financials  # Skip firms without FinancialStatement

Checkpoint format (results/orsr_v2_checkpoint.json):
  {
    "last_ico": "00689785",       # Cursor: last successfully processed ICO
    "processed_count": 500,       # Cumulative successful in this run
    "failed_count": 3,            # Cumulative failed in this run
    "not_found_count": 1,         # Cumulative not-found in this run
    "last_run": "2026-08-22T...",
    "failed_icos": [...],         # ICOs that failed (for retry)
    "not_found_icos": [...]       # ICOs not found in ORSR
  }

Checkpoint persistence:
  Checkpoint and lock files are stored in /app/results/ (Docker bind mount),
  NOT in /app/output/ (ephemeral container filesystem). This ensures
  checkpoint survives container recreation/deploy.

  Backward compatibility: if results/ checkpoint doesn't exist but output/
  checkpoint does (old location), it is automatically migrated.

--only-with-financials:
  Screener optimization mode. Skips companies without any FinancialStatement
  record. These firms have no score in the screener, so ORSR enrichment
  has limited value (only legalStatus + persons). Default is OFF —
  full ORSR population seed is the default and must remain available.
"""
from __future__ import annotations

import argparse
import asyncio
import fcntl
import json
import logging
import re
import time
from datetime import datetime, timezone
from pathlib import Path

logger = logging.getLogger("bulk_seed_orsr_v2")

# Checkpoint and lock in /app/results/ (Docker bind mount — survives recreation).
# Fallback to output/ for backward compatibility with pre-hardening checkpoints.
_RESULTS_DIR = Path("results")
_OUTPUT_DIR = Path("output")
_CHECKPOINT_FILE = _RESULTS_DIR / "orsr_v2_checkpoint.json"
_LOCK_FILE = _RESULTS_DIR / "orsr_v2.lock"
_LEGAL_FORMS = ["s.r.o.", "a.s.", "v.o.s.", "k.s."]
_DELAY_BETWEEN_REQUESTS = 0.3  # seconds — stealth tempo
_ICO_PATTERN = re.compile(r"^\d{8}$")


# ── Single-worker lock ────────────────────────────────────────────────

class WorkerLock:
    """flock-based lock to ensure only one V2 instance runs at a time.

    Acquires an exclusive lock on _LOCK_FILE. If another V2 process
    holds the lock, this process exits immediately with an error.
    The lock is automatically released when the file descriptor is closed
    (process exit, crash, kill — all release the lock).
    """

    def __init__(self):
        self._fd = None

    def acquire(self) -> bool:
        """Try to acquire exclusive lock. Returns True if acquired."""
        _LOCK_FILE.parent.mkdir(parents=True, exist_ok=True)
        self._fd = open(_LOCK_FILE, "w")
        try:
            fcntl.flock(self._fd.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
            self._fd.write(str(__import__("os").getpid()))
            self._fd.flush()
            return True
        except (IOError, OSError):
            # Another process holds the lock
            self._fd.close()
            self._fd = None
            return False

    def release(self):
        """Release the lock."""
        if self._fd:
            try:
                fcntl.flock(self._fd.fileno(), fcntl.LOCK_UN)
            except (IOError, OSError):
                pass
            self._fd.close()
            self._fd = None


# ── Checkpoint ────────────────────────────────────────────────────────

# Old checkpoint location (ephemeral /app/output/) — for backward compatibility migration
_OLD_CHECKPOINT_FILE = _OUTPUT_DIR / "orsr_v2_checkpoint.json"


def load_checkpoint() -> dict:
    """Load V2 checkpoint from persistent results/ directory.

    Backward compatibility: if results/ checkpoint doesn't exist but
    output/ checkpoint does (old ephemeral location), migrate it first.
    """
    # Migrate from old location if new doesn't exist
    if not _CHECKPOINT_FILE.exists() and _OLD_CHECKPOINT_FILE.exists():
        _CHECKPOINT_FILE.parent.mkdir(parents=True, exist_ok=True)
        import shutil
        shutil.copy2(_OLD_CHECKPOINT_FILE, _CHECKPOINT_FILE)
        logger.info(f"Migrated checkpoint from {_OLD_CHECKPOINT_FILE} → {_CHECKPOINT_FILE}")

    if _CHECKPOINT_FILE.exists():
        with open(_CHECKPOINT_FILE, "r") as f:
            return json.load(f)
    return {
        "last_ico": "",
        "processed_count": 0,
        "failed_count": 0,
        "not_found_count": 0,
        "last_run": None,
        "failed_icos": [],
        "not_found_icos": [],
    }


def save_checkpoint(checkpoint: dict) -> None:
    """Save checkpoint atomically (write to temp, then rename).

    Checkpoint is written to /app/results/ (Docker bind mount) which
    survives container recreation and deploy.
    """
    _CHECKPOINT_FILE.parent.mkdir(parents=True, exist_ok=True)
    checkpoint["last_run"] = datetime.now(timezone.utc).isoformat()
    tmp = _CHECKPOINT_FILE.with_suffix(".json.tmp")
    with open(tmp, "w") as f:
        json.dump(checkpoint, f, ensure_ascii=False, indent=2)
    tmp.rename(_CHECKPOINT_FILE)


# ── Cursor-based batch fetch ──────────────────────────────────────────

async def get_companies_batch_cursor(
    last_ico: str,
    batch_size: int = 100,
    ico_filter: str | None = None,
    only_with_financials: bool = False,
) -> list[dict]:
    """Fetch next batch of companies using cursor-based pagination.

    Uses: WHERE orsrSyncedAt IS NULL AND ico > :last_ico ORDER BY ico ASC LIMIT :batch_size
    No OFFSET — immune to mutating result set.

    If only_with_financials=True, adds EXISTS check for FinancialStatement.
    This is a screener optimization — firms without financials have no score.
    """
    from src.db_client import get_db

    db = get_db()

    if ico_filter:
        # Single-company mode — bypass cursor
        companies = await db.company.find_many(
            where={"ico": ico_filter, "orsrSyncedAt": None, "legalForm": {"in": _LEGAL_FORMS}},
            take=1,
            order={"ico": "asc"},
        )
        return [{"ico": c.ico, "name": c.name} for c in companies]

    # Cursor-based: use raw SQL for precise control over the cursor condition
    # query_raw returns actual rows (execute_raw returns row count)
    if only_with_financials:
        rows = await db.query_raw(
            """
            SELECT ico, name FROM "Company"
            WHERE "orsrSyncedAt" IS NULL
              AND "legalForm" = ANY($1)
              AND ico > $2
              AND EXISTS (SELECT 1 FROM "FinancialStatement" WHERE "companyIco" = "Company".ico)
            ORDER BY ico ASC
            LIMIT $3
            """,
            _LEGAL_FORMS,
            last_ico,
            batch_size,
        )
    else:
        rows = await db.query_raw(
            """
            SELECT ico, name FROM "Company"
            WHERE "orsrSyncedAt" IS NULL
              AND "legalForm" = ANY($1)
              AND ico > $2
            ORDER BY ico ASC
            LIMIT $3
            """,
            _LEGAL_FORMS,
            last_ico,
            batch_size,
        )

    if not rows:
        return []

    # Prisma query_raw returns list of dicts (not tuples)
    return [{"ico": r["ico"], "name": r["name"]} for r in rows]


async def bootstrap_checkpoint_from_db() -> dict:
    """Create a checkpoint from DB state by finding the max ICO already synced.

    This is NOT the sole correctness mechanism — DB orsrSyncedAt IS NULL
    is the idempotency guard. This just avoids re-scanning from ICO 00000003
    when we know 77k firms are already synced.

    The checkpoint cursor is set to max(ico) WHERE orsrSyncedAt IS NOT NULL.
    The DB query in get_companies_batch_cursor filters orsrSyncedAt IS NULL,
    so even if the cursor is wrong, no synced firm will be re-processed.
    """
    from src.db_client import get_db

    db = get_db()
    rows = await db.query_raw(
        """
        SELECT MAX(ico) as max_ico, COUNT(*) as synced_count
        FROM "Company"
        WHERE "orsrSyncedAt" IS NOT NULL
          AND "legalForm" = ANY($1)
        """,
        _LEGAL_FORMS,
    )
    if not rows or not rows[0]["max_ico"]:
        logger.info("Bootstrap: no synced companies found, starting from scratch.")
        return {
            "last_ico": "",
            "processed_count": 0,
            "failed_count": 0,
            "not_found_count": 0,
            "last_run": None,
            "failed_icos": [],
            "not_found_icos": [],
        }

    max_ico = rows[0]["max_ico"]
    synced_count = rows[0]["synced_count"]
    logger.info(f"Bootstrap: {synced_count} companies already synced, max ICO = {max_ico}")
    return {
        "last_ico": max_ico,
        "processed_count": 0,  # Reset for this run — counts only new processing
        "failed_count": 0,
        "not_found_count": 0,
        "last_run": None,
        "failed_icos": [],
        "not_found_icos": [],
    }


# ── Scrape + Save ─────────────────────────────────────────────────────

async def scrape_and_save_orsr_v2(
    ico: str,
    name: str,
    scraper,
) -> dict:
    """Scrape ORSR for one company and write structured data to DB.

    Uses the provided OrsrScraper instance (reusable, no per-company instantiation).
    Skips PDF generation for bulk mode (data extraction only).

    Company + CompanyPerson writes are wrapped in a single DB transaction
    (db.tx()) — if CompanyPerson fails, Company UPDATE is rolled back too.
    This prevents partial records (orsrSyncedAt set without persons).
    """
    from src.db_client import get_db

    tmp_dir = Path("/tmp/orsr_seed_v2")
    tmp_dir.mkdir(exist_ok=True)

    try:
        result = await scraper.run(
            ico=ico,
            output_dir=tmp_dir,
            orsr_extract_type="CURRENT",
            skip_pdf=True,          # V2: skip PDF for bulk
            skip_full_extract=True,  # V2: skip Úplný výpis (saves 1 HTTP request per company)
            shared_client=True,      # V2: reuse TCP/TLS connection across companies
        )

        db = get_db()

        # Classify result
        if result.status == "FAILED" and "neexistuje" in (result.status_message or "").lower():
            return {"ico": ico, "status": "NOT_FOUND", "message": result.status_message}
        if result.status != "SUCCESS":
            return {"ico": ico, "status": "FAILED", "message": result.status_message}

        # Derive legalStatus from ORSR findings (frozen contract: ORSR > Vestník > RÚZ)
        legal_status = "ACTIVE"
        findings_lower = (result.findings or "").lower()
        if "likvidácii" in findings_lower:
            legal_status = "LIQUIDATION"
        elif "vymazaná" in findings_lower:
            legal_status = "DISSOLVED"

        now_iso = datetime.now(timezone.utc).isoformat()

        # ── Atomic transaction: Company + CompanyPerson ──
        # If any CompanyPerson write fails, the entire transaction rolls back,
        # including the Company UPDATE. This prevents partial records.
        async with db.tx() as tx:
            # 1. Update Company
            #    name: ORSR aktuálny výpis obsahuje platné obchodné meno (najnovšie).
            #    Updatujeme len ak sa líši od súčasného — nemažeme historické informácie,
            #    len synchronizujeme na aktuálny stav z ORSR.
            await tx.execute_raw(
                """
                UPDATE "Company" SET
                    "orsrSyncedAt" = $1::timestamp,
                    "legalStatus" = $2,
                    "legalStatusSource" = 'ORSR',
                    "legalStatusObservedAt" = $3::timestamp,
                    "shareCapital" = COALESCE($4::numeric, "shareCapital"),
                    "signingAuthority" = COALESCE($5, "signingAuthority"),
                    "businessActivity" = COALESCE($6, "businessActivity"),
                    "name" = COALESCE(NULLIF($9, ''), "name"),
                    "updatedAt" = $7::timestamp
                WHERE ico = $8
                """,
                now_iso,
                legal_status,
                now_iso,
                result.share_capital,
                result.signing_authority,
                result.business_activity,
                now_iso,
                ico,
                result.company_name,
            )

            # 2. Update CompanyPerson records — NON-DESTRUCTIVE with isActive tracking.
            #    Use raw SQL because the container's Prisma client may be outdated
            #    (missing functionEnd, isActive, street fields in generated types).
            if result.persons:
                seen_keys = set()
                for p in result.persons:
                    key = (p.clean_name, p.role)
                    seen_keys.add(key)

                    # Check if person already exists
                    existing_rows = await tx.query_raw(
                        'SELECT id, city, "zipCode", "functionStart" FROM "CompanyPerson" WHERE "companyIco" = $1 AND "cleanName" = $2 AND role = $3',
                        ico, p.clean_name, p.role,
                    )

                    fs_iso = p.function_start.isoformat() if p.function_start else None
                    fe_iso = p.function_end.isoformat() if p.function_end else None

                    if existing_rows:
                        existing = existing_rows[0]
                        await tx.execute_raw(
                            """
                            UPDATE "CompanyPerson" SET
                                city = COALESCE($1, city),
                                "zipCode" = COALESCE($2, "zipCode"),
                                "functionStart" = COALESCE($3::timestamp, "functionStart"),
                                "functionEnd" = $4::timestamp,
                                "isActive" = $5,
                                "updatedAt" = NOW()
                            WHERE id = $6
                            """,
                            p.city,
                            p.zip_code,
                            fs_iso,
                            fe_iso,
                            p.is_active,
                            existing["id"],
                        )
                    else:
                        await tx.execute_raw(
                            """
                            INSERT INTO "CompanyPerson" ("id", "companyIco", "rawName", "cleanName", "role", "city", "zipCode", "functionStart", "functionEnd", "isActive", "createdAt", "updatedAt")
                            VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7::timestamp, $8::timestamp, $9, NOW(), NOW())
                            """,
                            ico,
                            p.raw_name,
                            p.clean_name,
                            p.role,
                            p.city,
                            p.zip_code,
                            fs_iso,
                            fe_iso,
                            p.is_active,
                        )

                # 3. Mark persons NOT in ORSR extract as inactive
                roles_in_extract = {p.role for p in result.persons}
                for role in roles_in_extract:
                    existing_persons = await tx.query_raw(
                        'SELECT id, "cleanName" FROM "CompanyPerson" WHERE "companyIco" = $1 AND role = $2 AND "isActive" = TRUE',
                        ico, role,
                    )
                    for ep in existing_persons:
                        if (ep["cleanName"], role) not in seen_keys:
                            await tx.execute_raw(
                                'UPDATE "CompanyPerson" SET "isActive" = FALSE, "updatedAt" = NOW() WHERE id = $1',
                                ep["id"],
                            )
        # ── Transaction committed atomically ──

        return {
            "ico": ico,
            "status": "SUCCESS",
            "share_capital": result.share_capital,
            "signing_authority": result.signing_authority[:80] if result.signing_authority else None,
            "persons_count": len(result.persons) if result.persons else 0,
            "legal_status": legal_status,
        }

    except Exception as e:
        return {"ico": ico, "status": "ERROR", "message": str(e)[:200]}


# ── Batch processing ──────────────────────────────────────────────────

async def process_batch(
    companies: list[dict],
    concurrency: int,
    scraper,
) -> list[dict]:
    """Process a batch of companies with bounded concurrency."""
    sem = asyncio.Semaphore(concurrency)
    results = []

    async def _process(idx: int, company: dict):
        async with sem:
            ico = company["ico"]
            name = company.get("name") or ico
            _t = time.perf_counter()
            logger.info(f"[{idx+1}/{len(companies)}] {name} ({ico})")

            result = None
            for attempt in range(1, 4):
                result = await scrape_and_save_orsr_v2(ico, name, scraper)
                if result.get("status") in ("SUCCESS", "NOT_FOUND"):
                    break
                if attempt < 3:
                    logger.warning(f"[{idx+1}/{len(companies)}] {ico} — attempt {attempt} failed, retrying...")
                    await asyncio.sleep(2.0 * attempt)

            elapsed = time.perf_counter() - _t
            status = result.get("status", "?")
            capital = result.get("share_capital")
            persons = result.get("persons_count", 0)
            logger.info(
                f"[{idx+1}/{len(companies)}] {ico} — {status} "
                f"capital={capital} persons={persons} ({elapsed:.1f}s)"
            )

            await asyncio.sleep(_DELAY_BETWEEN_REQUESTS)
            return result

    tasks = [_process(i, c) for i, c in enumerate(companies)]
    raw_results = await asyncio.gather(*tasks, return_exceptions=True)

    for r in raw_results:
        if isinstance(r, Exception):
            results.append({"status": "ERROR", "message": str(r)[:200]})
        else:
            results.append(r)
    return results


# ── Main ──────────────────────────────────────────────────────────────

async def main(args):
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(message)s",
        datefmt="%H:%M:%S",
    )

    from src.db_client import connect_db, disconnect_db
    from src.scrapers.orsr import OrsrScraper

    # ── Single-worker lock ──
    # Prevents two V2 instances from running concurrently and overwriting
    # each other's checkpoint. The lock is released on process exit/crash.
    lock = WorkerLock()
    if not lock.acquire():
        logger.error(
            f"Another ORSR V2 process is already running "
            f"(lock file: {_LOCK_FILE}). Only one instance allowed at a time."
        )
        logger.error("If no process is running, remove the lock file manually: rm output/orsr_v2.lock")
        return

    logger.info(f"Lock acquired (PID {__import__('os').getpid()})")

    try:
        await connect_db()

        # Load checkpoint
        # --resume: load from file (with old-location migration)
        # --bootstrap-from-db: create checkpoint from DB state (max synced ICO)
        # Neither: start fresh
        if args.bootstrap_from_db:
            checkpoint = await bootstrap_checkpoint_from_db()
            save_checkpoint(checkpoint)
            logger.info(f"Bootstrap checkpoint saved to {_CHECKPOINT_FILE}")
        elif args.resume:
            checkpoint = load_checkpoint()
        else:
            checkpoint = {
                "last_ico": "",
                "processed_count": 0,
                "failed_count": 0,
                "not_found_count": 0,
                "last_run": None,
                "failed_icos": [],
                "not_found_icos": [],
            }

        # ── Retry-failed mode ──
        # Re-process ICOs that failed in the previous run.
        # Does NOT advance the cursor — only retries failed_icos.
        if args.retry_failed:
            failed_icos = checkpoint.get("failed_icos", [])
            if not failed_icos:
                logger.info("No failed ICOs to retry.")
                await disconnect_db()
                return

            logger.info(f"Retrying {len(failed_icos)} failed ICOs...")
            # Reset failed counters for this retry pass
            retry_checkpoint = {
                "last_ico": checkpoint.get("last_ico", ""),
                "processed_count": 0,
                "failed_count": 0,
                "not_found_count": 0,
                "last_run": None,
                "failed_icos": [],
                "not_found_icos": [],
            }

            # Fetch company names for failed ICOs
            from src.db_client import get_db
            db = get_db()
            companies = []
            for ico in failed_icos:
                rows = await db.query_raw(
                    'SELECT ico, name FROM "Company" WHERE ico = $1',
                    ico,
                )
                if rows:
                    companies.append({"ico": rows[0]["ico"], "name": rows[0]["name"]})
                else:
                    companies.append({"ico": ico, "name": ico})

            scraper = OrsrScraper(browser=None)
            try:
                results = await process_batch(companies, concurrency=args.concurrency, scraper=scraper)
                for r, c in zip(results, companies):
                    status = r.get("status")
                    if status == "SUCCESS":
                        retry_checkpoint["processed_count"] += 1
                    elif status == "NOT_FOUND":
                        retry_checkpoint["not_found_count"] += 1
                        retry_checkpoint["not_found_icos"].append(c["ico"])
                    else:
                        retry_checkpoint["failed_count"] += 1
                        retry_checkpoint["failed_icos"].append(c["ico"])

                # Merge retry results back into checkpoint
                checkpoint["failed_icos"] = retry_checkpoint["failed_icos"]
                checkpoint["not_found_icos"] = checkpoint.get("not_found_icos", []) + retry_checkpoint["not_found_icos"]
                save_checkpoint(checkpoint)
            finally:
                await OrsrScraper.close_shared_client()
                await scraper._close()
                await disconnect_db()

            _print_summary(retry_checkpoint, title="RETRY FAILED")
            return

        # Single-company mode
        if args.ico:
            if not _ICO_PATTERN.match(args.ico):
                logger.error(f"Invalid IČO format: {args.ico}")
                await disconnect_db()
                return

            scraper = OrsrScraper(browser=None)
            companies = await get_companies_batch_cursor("", ico_filter=args.ico)
            if not companies:
                logger.info(f"Company {args.ico} not found or already synced.")
                await OrsrScraper.close_shared_client()
                await scraper._close()
                await disconnect_db()
                return

            results = await process_batch(companies, concurrency=1, scraper=scraper)
            for r, c in zip(results, companies):
                status = r.get("status")
                if status == "SUCCESS":
                    checkpoint["processed_count"] += 1
                    checkpoint["last_ico"] = max(checkpoint["last_ico"], c["ico"])
                elif status == "NOT_FOUND":
                    checkpoint["not_found_count"] += 1
                    checkpoint["not_found_icos"].append(c["ico"])
                else:
                    checkpoint["failed_count"] += 1
                    checkpoint["failed_icos"].append(c["ico"])
            save_checkpoint(checkpoint)
            await OrsrScraper.close_shared_client()
            await scraper._close()
            await disconnect_db()
            _print_summary(checkpoint)
            return

        # Cursor-based bulk mode
        last_ico = checkpoint.get("last_ico", "")
        total_target = args.max
        batch_size = 100
        start_time = time.perf_counter()

        # Single reusable scraper instance
        scraper = OrsrScraper(browser=None)

        try:
            while checkpoint["processed_count"] + checkpoint["failed_count"] + checkpoint["not_found_count"] < total_target:
                remaining = total_target - (
                    checkpoint["processed_count"]
                    + checkpoint["failed_count"]
                    + checkpoint["not_found_count"]
                )
                fetch_size = min(batch_size, remaining)
                if fetch_size <= 0:
                    break

                logger.info(
                    f"Fetching batch of {fetch_size} companies (cursor: ico > {last_ico or 'START'})..."
                )
                companies = await get_companies_batch_cursor(
                    last_ico,
                    batch_size=fetch_size,
                    only_with_financials=args.only_with_financials,
                )

                if not companies:
                    logger.info("No more companies to process.")
                    break

                logger.info(
                    f"Processing {len(companies)} companies "
                    f"(total so far: {checkpoint['processed_count'] + checkpoint['failed_count'] + checkpoint['not_found_count']})"
                )

                # Process in sub-batches of 10 for checkpoint granularity
                sub_batch_size = 10
                for i in range(0, len(companies), sub_batch_size):
                    sub = companies[i:i + sub_batch_size]
                    results = await process_batch(sub, concurrency=args.concurrency, scraper=scraper)

                    for r, c in zip(results, sub):
                        status = r.get("status")
                        if status == "SUCCESS":
                            checkpoint["processed_count"] += 1
                            checkpoint["last_ico"] = max(checkpoint["last_ico"], c["ico"])
                        elif status == "NOT_FOUND":
                            checkpoint["not_found_count"] += 1
                            checkpoint["not_found_icos"].append(c["ico"])
                            # Advance cursor even for not-found (they were processed)
                            checkpoint["last_ico"] = max(checkpoint["last_ico"], c["ico"])
                        else:
                            checkpoint["failed_count"] += 1
                            checkpoint["failed_icos"].append(c["ico"])
                            # Advance cursor even for failed (retry separately later)
                            checkpoint["last_ico"] = max(checkpoint["last_ico"], c["ico"])

                    save_checkpoint(checkpoint)

                # Update cursor for next batch
                last_ico = checkpoint["last_ico"]

        finally:
            await OrsrScraper.close_shared_client()
            await scraper._close()
            await disconnect_db()

        elapsed = time.perf_counter() - start_time
        total = checkpoint["processed_count"] + checkpoint["failed_count"] + checkpoint["not_found_count"]
        throughput = (total / elapsed * 60) if elapsed > 0 else 0
        logger.info(f"Throughput: {throughput:.1f} companies/min ({total} in {elapsed:.0f}s)")

        _print_summary(checkpoint)

    finally:
        lock.release()
        logger.info("Lock released")


def _print_summary(checkpoint: dict, title: str = "SUMMARY"):
    print("\n" + "=" * 60)
    print(f"  ORSR BULK SEED V2 — {title}")
    print(f"  Processed:    {checkpoint['processed_count']}")
    print(f"  Not found:    {checkpoint['not_found_count']}")
    print(f"  Failed:       {checkpoint['failed_count']}")
    print(f"  Total:        {checkpoint['processed_count'] + checkpoint['failed_count'] + checkpoint['not_found_count']}")
    print(f"  Last ICO:     {checkpoint.get('last_ico', '')}")
    print(f"  Checkpoint:   {_CHECKPOINT_FILE}")
    print("=" * 60)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="ORSR Bulk Seed V2 — cursor-based pagination")
    parser.add_argument("--max", type=int, default=999999, help="Max companies (default: all)")
    parser.add_argument("--ico", type=str, default=None, help="Single IČO (8 digits)")
    parser.add_argument("--concurrency", type=int, default=5, help="Parallel workers (default: 5)")
    parser.add_argument("--resume", action="store_true", help="Resume from V2 checkpoint")
    parser.add_argument("--retry-failed", action="store_true", help="Retry failed ICOs from checkpoint")
    parser.add_argument(
        "--bootstrap-from-db",
        action="store_true",
        help="Create checkpoint from DB state (max synced ICO). "
             "Useful after checkpoint loss — DB idempotency guard still protects.",
    )
    parser.add_argument(
        "--only-with-financials",
        action="store_true",
        help="Screener optimization: skip companies without FinancialStatement. "
             "These firms have no screener score. Default is OFF (full population seed).",
    )
    args = parser.parse_args()

    asyncio.run(main(args))

    asyncio.run(main(args))
