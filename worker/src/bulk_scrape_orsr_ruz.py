"""
Bulk scrape ORSR + RÚZ data for first N companies from DB.

Usage:
  python -m src.bulk_scrape_orsr_ruz                    # First 100 companies
  python -m src.bulk_scrape_orsr_ruz --max 50           # First 50 companies
  python -m src.bulk_scrape_orsr_ruz --ico 00684881     # Single company
  python -m src.bulk_scrape_orsr_ruz --concurrency 5    # 5 parallel workers

What it does:
  1. Fetches first N companies from DB (sorted by employee count DESC)
  2. For each company, runs ORSR scraper (httpx, no Playwright) + RÚZ API download
  3. Saves ORSR PDFs to output_dir/orsr/{ico}.pdf
  4. Saves RÚZ financial statements to output_dir/ruz/{ico}/
  5. Prints summary report

Output:
  output/orsr_ruz_scrape_{timestamp}/
    orsr/{ico}.pdf
    ruz/{ico}/...
    report.json
"""

from __future__ import annotations

import argparse
import asyncio
import json
import logging
import sys
import time
from datetime import datetime
from pathlib import Path

logger = logging.getLogger("bulk_scrape")

# ── DB ───────────────────────────────────────────────────────────────────────

async def get_companies(limit: int, ico_filter: str | None = None) -> list[dict]:
    """Fetch companies from DB, sorted by employee count DESC."""
    from src.db_client import get_db, connect_db, disconnect_db

    await connect_db()
    db = get_db()

    where = {}
    if ico_filter:
        where["ico"] = ico_filter

    companies = await db.company.find_many(
        where=where,
        take=limit,
    )

    # Sort in Python — Prisma 0.15.0 doesn't support order in find_many
    companies_sorted = sorted(companies, key=lambda c: (getattr(c, "employeeCount", 0) or 0, c.ico), reverse=True)
    result = [{"ico": c.ico, "name": c.name, "city": getattr(c, "city", None)} for c in companies_sorted]
    await disconnect_db()
    return result


# ── ORSR ─────────────────────────────────────────────────────────────────────

async def scrape_orsr(ico: str, output_dir: Path) -> dict:
    """Run ORSR scraper for a single company. Returns status dict."""
    from src.scrapers.orsr import OrsrScraper

    scraper = OrsrScraper(browser=None)
    try:
        result = await scraper.run(
            ico=ico,
            output_dir=output_dir,
            orsr_extract_type="CURRENT",
        )
        return {
            "status": result.status,
            "company_name": result.company_name,
            "file_path": result.file_path,
            "message": result.status_message,
            "findings": (result.findings or "")[:200],
        }
    except Exception as e:
        return {"status": "FAILED", "message": str(e)[:200]}
    finally:
        await scraper._close()


# ── RÚZ ──────────────────────────────────────────────────────────────────────

async def scrape_ruz(ico: str, output_dir: Path) -> dict:
    """Download financial statements from RÚZ API for a single company."""
    from src.ruz_api import download_ifrs_reports

    ruz_dir = str(output_dir / ico)
    try:
        files = await download_ifrs_reports(ico, max_years=5, output_dir=ruz_dir)

        if files == ["__ENTITY_NOT_FOUND__"]:
            return {"status": "NOT_FOUND", "files": [], "message": "Subjekt nie je v RÚZ"}
        if files == ["__DATA_NOT_PUBLIC__"]:
            return {"status": "NOT_PUBLIC", "files": [], "message": "Údaje nie sú verejné"}
        if not files:
            return {"status": "NO_DATA", "files": [], "message": "Žiadne závierky"}

        return {
            "status": "SUCCESS",
            "files": [str(f) for f in files],
            "count": len(files),
            "message": f"Stiahnutých {len(files)} súborov",
        }
    except Exception as e:
        return {"status": "FAILED", "files": [], "message": str(e)[:200]}


# ── Main ─────────────────────────────────────────────────────────────────────

async def process_company(idx: int, total: int, company: dict, base_dir: Path, sem: asyncio.Semaphore):
    """Process one company: ORSR + RÚZ in parallel."""
    ico = company["ico"]
    name = company.get("name") or ico
    async with sem:
        _t = time.perf_counter()
        logger.info(f"[{idx+1}/{total}] {name} ({ico}) — starting")

        orsr_dir = base_dir / "orsr"
        ruz_dir = base_dir / "ruz"
        orsr_dir.mkdir(parents=True, exist_ok=True)
        ruz_dir.mkdir(parents=True, exist_ok=True)

        # Run ORSR + RÚZ in parallel
        orsr_result, ruz_result = await asyncio.gather(
            scrape_orsr(ico, orsr_dir),
            scrape_ruz(ico, ruz_dir),
            return_exceptions=True,
        )

        # Handle exceptions
        if isinstance(orsr_result, Exception):
            orsr_result = {"status": "ERROR", "message": str(orsr_result)[:200]}
        if isinstance(ruz_result, Exception):
            ruz_result = {"status": "ERROR", "message": str(ruz_result)[:200]}

        elapsed = time.perf_counter() - _t
        orsr_status = orsr_result.get("status", "?")
        ruz_status = ruz_result.get("status", "?")
        ruz_count = ruz_result.get("count", 0)

        logger.info(
            f"[{idx+1}/{total}] {name} ({ico}) — "
            f"ORSR:{orsr_status} RÚZ:{ruz_status}({ruz_count} files) "
            f"in {elapsed:.1f}s"
        )

        return {
            "ico": ico,
            "name": name,
            "orsr": orsr_result,
            "ruz": ruz_result,
            "elapsed_s": round(elapsed, 1),
        }


async def main(args):
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(message)s",
        datefmt="%H:%M:%S",
    )

    # Create output directory
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    base_dir = Path(f"output/orsr_ruz_scrape_{timestamp}")
    base_dir.mkdir(parents=True, exist_ok=True)
    logger.info(f"Output directory: {base_dir}")

    # Get companies
    logger.info(f"Fetching {args.max} companies from DB...")
    companies = await get_companies(args.max, args.ico)
    logger.info(f"Found {len(companies)} companies")

    if not companies:
        logger.info("No companies found — nothing to do.")
        return

    # Process with concurrency limit
    sem = asyncio.Semaphore(args.concurrency)
    total = len(companies)

    tasks = [
        process_company(idx, total, company, base_dir, sem)
        for idx, company in enumerate(companies)
    ]

    results = await asyncio.gather(*tasks, return_exceptions=True)

    # Build summary
    summary = {
        "timestamp": timestamp,
        "total_companies": total,
        "output_dir": str(base_dir),
        "orsr_success": 0,
        "orsr_failed": 0,
        "ruz_success": 0,
        "ruz_failed": 0,
        "ruz_no_data": 0,
        "total_ruz_files": 0,
        "total_elapsed_s": 0,
        "companies": [],
    }

    for r in results:
        if isinstance(r, Exception):
            summary["orsr_failed"] += 1
            summary["ruz_failed"] += 1
            continue

        orsr_status = r["orsr"].get("status", "?")
        ruz_status = r["ruz"].get("status", "?")

        if orsr_status == "SUCCESS":
            summary["orsr_success"] += 1
        else:
            summary["orsr_failed"] += 1

        if ruz_status == "SUCCESS":
            summary["ruz_success"] += 1
            summary["total_ruz_files"] += r["ruz"].get("count", 0)
        elif ruz_status in ("NOT_FOUND", "NOT_PUBLIC", "NO_DATA"):
            summary["ruz_no_data"] += 1
        else:
            summary["ruz_failed"] += 1

        summary["total_elapsed_s"] += r.get("elapsed_s", 0)
        summary["companies"].append(r)

    # Save report
    report_path = base_dir / "report.json"
    with open(report_path, "w", encoding="utf-8") as f:
        json.dump(summary, f, ensure_ascii=False, indent=2)

    # Print summary
    print("\n" + "=" * 60)
    print(f"  BULK SCRAPE SUMMARY")
    print(f"  Companies: {summary['total_companies']}")
    print(f"  ORSR:      {summary['orsr_success']} OK, {summary['orsr_failed']} failed")
    print(f"  RÚZ:       {summary['ruz_success']} OK, {summary['ruz_no_data']} no data, {summary['ruz_failed']} failed")
    print(f"  RÚZ files: {summary['total_ruz_files']}")
    print(f"  Time:      {summary['total_elapsed_s']:.0f}s total")
    print(f"  Output:    {base_dir}")
    print(f"  Report:    {report_path}")
    print("=" * 60)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Bulk scrape ORSR + RÚZ for first N companies")
    parser.add_argument("--max", type=int, default=100, help="Max companies to process (default: 100)")
    parser.add_argument("--ico", type=str, default=None, help="Single IČO to process")
    parser.add_argument("--concurrency", type=int, default=5, help="Parallel workers (default: 5)")
    args = parser.parse_args()

    asyncio.run(main(args))
