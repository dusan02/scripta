"""
Bulk seed ORSR data (shareCapital, signingAuthority, businessActivity, spolocnici + vklady)
into the Company and CompanyPerson tables.

Strategy:
  1. Fetch companies from DB sorted by latestRevenue DESC (top segment first)
  2. Skip companies that already have orsrSyncedAt
  3. For each company: scrape ORSR → parse → write to DB
  4. Checkpoint file for resume capability
  5. Stealth tempo: concurrency 5, delay 300ms between requests

Usage:
  python -m src.bulk_seed_orsr --max 10              # First 10 companies
  python -m src.bulk_seed_orsr --max 100             # First 100 companies
  python -m src.bulk_seed_orsr --ico 36000019        # Single company
  python -m src.bulk_seed_orsr --resume              # Resume from checkpoint
  python -m src.bulk_seed_orsr --concurrency 3       # 3 parallel workers
"""
from __future__ import annotations

import argparse
import asyncio
import json
import logging
import time
from datetime import datetime, timezone
from pathlib import Path

logger = logging.getLogger("bulk_seed_orsr")

_CHECKPOINT_FILE = Path("output/orsr_seed_checkpoint.json")
_DELAY_BETWEEN_REQUESTS = 0.3  # seconds


async def get_companies_batch(batch_size: int = 100, offset: int = 0, ico_filter: str | None = None) -> list[dict]:
    """Fetch a batch of companies sorted by latestRevenue DESC, skipping orsrSyncedAt IS NOT NULL.
    Assumes DB is already connected.
    """
    from src.db_client import get_db

    db = get_db()

    where = {"orsrSyncedAt": None}
    if ico_filter:
        where = {"ico": ico_filter}

    companies = await db.company.find_many(
        where=where,
        take=batch_size,
        skip=offset,
        order={"latestRevenue": "desc"},
    )

    return [{"ico": c.ico, "name": c.name} for c in companies]


async def scrape_and_save_orsr(ico: str, name: str) -> dict:
    """Scrape ORSR for one company and write structured data to DB.
    Assumes DB is already connected (connect_db called by caller).
    """
    from src.scrapers.orsr import OrsrScraper
    from src.db_client import get_db

    scraper = OrsrScraper(browser=None)
    tmp_dir = Path("/tmp/orsr_seed")
    tmp_dir.mkdir(exist_ok=True)

    try:
        result = await scraper.run(ico=ico, output_dir=tmp_dir, orsr_extract_type="CURRENT")

        if result.status != "SUCCESS":
            return {"ico": ico, "status": result.status, "message": result.status_message}

        # Write to DB (connection already open)
        db = get_db()

        # Update Company
        company_update = {
            "orsrSyncedAt": datetime.now(timezone.utc),
        }
        if result.share_capital is not None:
            company_update["shareCapital"] = result.share_capital
        if result.signing_authority:
            company_update["signingAuthority"] = result.signing_authority
        if result.business_activity:
            company_update["businessActivity"] = result.business_activity

        await db.company.update(
            where={"ico": ico},
            data=company_update,
        )

        # Upsert CompanyPerson records — replace ALL ORSR-sourced persons
        if result.persons:
            await db.companyperson.delete_many(
                where={"companyIco": ico},
            )
            for p in result.persons:
                await db.companyperson.create(
                    data={
                        "companyIco": ico,
                        "rawName": p.raw_name,
                        "cleanName": p.clean_name,
                        "role": p.role,
                        "city": p.city,
                        "zipCode": p.zip_code,
                    },
                )

        return {
            "ico": ico,
            "status": "SUCCESS",
            "share_capital": result.share_capital,
            "signing_authority": result.signing_authority[:80] if result.signing_authority else None,
            "persons_count": len(result.persons) if result.persons else 0,
        }

    except Exception as e:
        return {"ico": ico, "status": "ERROR", "message": str(e)[:200]}
    finally:
        await scraper._close()


def load_checkpoint() -> dict:
    """Load checkpoint file for resume."""
    if _CHECKPOINT_FILE.exists():
        with open(_CHECKPOINT_FILE, "r") as f:
            return json.load(f)
    return {"processed": [], "failed": [], "last_run": None}


def save_checkpoint(checkpoint: dict) -> None:
    """Save checkpoint file."""
    _CHECKPOINT_FILE.parent.mkdir(parents=True, exist_ok=True)
    checkpoint["last_run"] = datetime.now().isoformat()
    with open(_CHECKPOINT_FILE, "w") as f:
        json.dump(checkpoint, f, ensure_ascii=False, indent=2)


async def process_batch(companies: list[dict], concurrency: int = 5) -> list[dict]:
    """Process a batch of companies with concurrency limit."""
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
                result = await scrape_and_save_orsr(ico, name)
                if result.get("status") == "SUCCESS":
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

            # Stealth delay
            await asyncio.sleep(_DELAY_BETWEEN_REQUESTS)
            return result

    tasks = [_process(i, c) for i, c in enumerate(companies)]
    results = await asyncio.gather(*tasks, return_exceptions=True)

    # Handle exceptions
    final = []
    for r in results:
        if isinstance(r, Exception):
            final.append({"status": "ERROR", "message": str(r)[:200]})
        else:
            final.append(r)
    return final


async def main(args):
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(message)s",
        datefmt="%H:%M:%S",
    )

    from src.db_client import connect_db, disconnect_db

    # Connect DB once for the entire run
    await connect_db()

    checkpoint = load_checkpoint() if args.resume else {"processed": [], "failed": [], "last_run": None}
    processed_icos = set(checkpoint.get("processed", []))

    # Paginated fetching — process in DB batches of 100, scrape in sub-batches of 10
    db_batch_size = 100
    total_processed = 0
    total_failed = 0
    offset = 0

    if args.ico:
        # Single company mode
        companies = await get_companies_batch(batch_size=1, ico_filter=args.ico)
        if not companies:
            logger.info(f"Company {args.ico} not found or already synced.")
            await disconnect_db()
            return
        results = await process_batch(companies, concurrency=1)
        for r, c in zip(results, companies):
            if r.get("status") == "SUCCESS":
                checkpoint["processed"].append(c["ico"])
                total_processed += 1
            else:
                checkpoint["failed"].append(c["ico"])
                total_failed += 1
        save_checkpoint(checkpoint)
    else:
        # Full paginated mode
        while total_processed + total_failed < args.max:
            remaining = args.max - (total_processed + total_failed)
            fetch_size = min(db_batch_size, remaining)
            if fetch_size <= 0:
                break

            logger.info(f"Fetching batch of {fetch_size} companies (offset={offset})...")
            companies = await get_companies_batch(batch_size=fetch_size, offset=offset)

            if not companies:
                logger.info("No more companies to process.")
                break

            # Filter already processed (for resume)
            if args.resume:
                companies = [c for c in companies if c["ico"] not in processed_icos]
                if not companies:
                    offset += fetch_size
                    continue

            logger.info(f"Processing {len(companies)} companies (total so far: {total_processed + total_failed})")

            # Process in sub-batches of 10
            sub_batch_size = 10
            for i in range(0, len(companies), sub_batch_size):
                sub = companies[i:i + sub_batch_size]
                results = await process_batch(sub, concurrency=args.concurrency)

                for r, c in zip(results, sub):
                    if r.get("status") == "SUCCESS":
                        checkpoint["processed"].append(c["ico"])
                        total_processed += 1
                    else:
                        checkpoint["failed"].append(c["ico"])
                        total_failed += 1
                save_checkpoint(checkpoint)

            offset += fetch_size

    # Summary
    print("\n" + "=" * 60)
    print(f"  ORSR BULK SEED SUMMARY")
    print(f"  Success:   {total_processed}")
    print(f"  Failed:    {total_failed}")
    print(f"  Total:     {total_processed + total_failed}")
    print(f"  Checkpoint: {_CHECKPOINT_FILE}")
    print("=" * 60)

    # Disconnect DB
    await disconnect_db()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Bulk seed ORSR data into DB")
    parser.add_argument("--max", type=int, default=999999, help="Max companies (default: all)")
    parser.add_argument("--ico", type=str, default=None, help="Single IČO")
    parser.add_argument("--concurrency", type=int, default=5, help="Parallel workers (default: 5)")
    parser.add_argument("--resume", action="store_true", help="Resume from checkpoint")
    args = parser.parse_args()

    asyncio.run(main(args))
