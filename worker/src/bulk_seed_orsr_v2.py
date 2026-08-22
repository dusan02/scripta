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

Usage:
  python -m src.bulk_seed_orsr_v2 --max 500              # Pilot: 500 companies
  python -m src.bulk_seed_orsr_v2 --resume               # Resume from checkpoint
  python -m src.bulk_seed_orsr_v2 --ico 36000019          # Single company
  python -m src.bulk_seed_orsr_v2 --concurrency 5         # 5 parallel workers
  python -m src.bulk_seed_orsr_v2 --max 500 --resume      # Resume, cap at 500 more

Checkpoint format (output/orsr_v2_checkpoint.json):
  {
    "last_ico": "00689785",       # Cursor: last successfully processed ICO
    "processed_count": 500,       # Cumulative successful in this run
    "failed_count": 3,            # Cumulative failed in this run
    "not_found_count": 1,         # Cumulative not-found in this run
    "last_run": "2026-08-22T...",
    "failed_icos": [...],         # ICOs that failed (for retry)
    "not_found_icos": [...]       # ICOs not found in ORSR
  }
"""
from __future__ import annotations

import argparse
import asyncio
import json
import logging
import re
import time
from datetime import datetime, timezone
from pathlib import Path

logger = logging.getLogger("bulk_seed_orsr_v2")

_CHECKPOINT_FILE = Path("output/orsr_v2_checkpoint.json")
_LEGAL_FORMS = ["s.r.o.", "a.s.", "v.o.s.", "k.s."]
_DELAY_BETWEEN_REQUESTS = 0.3  # seconds — stealth tempo
_ICO_PATTERN = re.compile(r"^\d{8}$")


# ── Checkpoint ────────────────────────────────────────────────────────

def load_checkpoint() -> dict:
    """Load V2 checkpoint. Returns empty checkpoint if file doesn't exist."""
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
    """Save checkpoint atomically (write to temp, then rename)."""
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
) -> list[dict]:
    """Fetch next batch of companies using cursor-based pagination.

    Uses: WHERE orsrSyncedAt IS NULL AND ico > :last_ico ORDER BY ico ASC LIMIT :batch_size
    No OFFSET — immune to mutating result set.
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


# ── Scrape + Save ─────────────────────────────────────────────────────

async def scrape_and_save_orsr_v2(
    ico: str,
    name: str,
    scraper,
) -> dict:
    """Scrape ORSR for one company and write structured data to DB.

    Uses the provided OrsrScraper instance (reusable, no per-company instantiation).
    Skips PDF generation for bulk mode (data extraction only).
    """
    from src.db_client import get_db

    tmp_dir = Path("/tmp/orsr_seed_v2")
    tmp_dir.mkdir(exist_ok=True)

    try:
        result = await scraper.run(
            ico=ico,
            output_dir=tmp_dir,
            orsr_extract_type="CURRENT",
            skip_pdf=True,  # V2: skip PDF for bulk
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

        # Parameterized UPDATE — no string concatenation
        # Cast timestamp params explicitly (Prisma passes as text by default)
        await db.execute_raw(
            """
            UPDATE "Company" SET
                "orsrSyncedAt" = $1::timestamp,
                "legalStatus" = $2,
                "legalStatusSource" = 'ORSR',
                "legalStatusObservedAt" = $3::timestamp,
                "shareCapital" = COALESCE($4::numeric, "shareCapital"),
                "signingAuthority" = COALESCE($5, "signingAuthority"),
                "businessActivity" = COALESCE($6, "businessActivity"),
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
        )

        # Update CompanyPerson records — NON-DESTRUCTIVE with isActive tracking
        if result.persons:
            seen_keys = set()
            for p in result.persons:
                key = (p.clean_name, p.role)
                seen_keys.add(key)
                existing = await db.companyperson.find_first(
                    where={"companyIco": ico, "cleanName": p.clean_name, "role": p.role},
                )
                if existing:
                    await db.companyperson.update(
                        where={"id": existing.id},
                        data={
                            "city": p.city or existing.city,
                            "zipCode": p.zip_code or existing.zipCode,
                            "functionStart": p.function_start or existing.functionStart,
                            "functionEnd": p.function_end,
                            "isActive": p.is_active,
                        },
                    )
                else:
                    await db.companyperson.create(
                        data={
                            "companyIco": ico,
                            "rawName": p.raw_name,
                            "cleanName": p.clean_name,
                            "role": p.role,
                            "city": p.city,
                            "zipCode": p.zip_code,
                            "functionStart": p.function_start,
                            "functionEnd": p.function_end,
                            "isActive": p.is_active,
                        },
                    )

            # Mark persons NOT in ORSR extract as inactive
            roles_in_extract = {p.role for p in result.persons}
            for role in roles_in_extract:
                existing_persons = await db.companyperson.find_many(
                    where={"companyIco": ico, "role": role, "isActive": True},
                )
                for ep in existing_persons:
                    if (ep.cleanName, role) not in seen_keys:
                        await db.companyperson.update(
                            where={"id": ep.id},
                            data={"isActive": False},
                        )

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

    await connect_db()

    # Load checkpoint
    checkpoint = load_checkpoint() if args.resume else {
        "last_ico": "",
        "processed_count": 0,
        "failed_count": 0,
        "not_found_count": 0,
        "last_run": None,
        "failed_icos": [],
        "not_found_icos": [],
    }

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
            companies = await get_companies_batch_cursor(last_ico, batch_size=fetch_size)

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
        await scraper._close()
        await disconnect_db()

    elapsed = time.perf_counter() - start_time
    total = checkpoint["processed_count"] + checkpoint["failed_count"] + checkpoint["not_found_count"]
    throughput = (total / elapsed * 60) if elapsed > 0 else 0
    logger.info(f"Throughput: {throughput:.1f} companies/min ({total} in {elapsed:.0f}s)")

    _print_summary(checkpoint)


def _print_summary(checkpoint: dict):
    print("\n" + "=" * 60)
    print("  ORSR BULK SEED V2 — SUMMARY")
    print(f"  Processed:    {checkpoint['processed_count']}")
    print(f"  Not found:    {checkpoint['not_found_count']}")
    print(f"  Failed:       {checkpoint['failed_count']}")
    print(f"  Total:        {checkpoint['processed_count'] + checkpoint['failed_count'] + checkpoint['not_found_count']}")
    print(f"  Last ICO:     {checkpoint['last_ico']}")
    print(f"  Checkpoint:   {_CHECKPOINT_FILE}")
    print("=" * 60)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="ORSR Bulk Seed V2 — cursor-based pagination")
    parser.add_argument("--max", type=int, default=999999, help="Max companies (default: all)")
    parser.add_argument("--ico", type=str, default=None, help="Single IČO (8 digits)")
    parser.add_argument("--concurrency", type=int, default=5, help="Parallel workers (default: 5)")
    parser.add_argument("--resume", action="store_true", help="Resume from V2 checkpoint")
    args = parser.parse_args()

    asyncio.run(main(args))
