"""
ORSR Read-Only Performance Benchmark — concurrency 5/6/8.

Tests HTTP fetch + HTML parse throughput WITHOUT any DB writes.
Safe to run alongside the full backfill (no lock, no checkpoint, no DB mutations).

Usage:
  python -m src.benchmark_orsr_readonly                    # Default: 30 companies per level
  python -m src.benchmark_orsr_readonly --count 50         # 50 companies per level
  python -m src.benchmark_orsr_readonly --levels 5,8,10    # Custom concurrency levels
  python -m src.benchmark_orsr_readonly --skip-fetch       # Use hardcoded ICOs (no DB read)

Output:
  Per-level: success/error/throughput/avg_time/p50/p95
  Comparison table at the end
"""
from __future__ import annotations

import argparse
import asyncio
import logging
import statistics
import time
from pathlib import Path

logger = logging.getLogger("benchmark_orsr")

# Hardcoded sample ICOs for --skip-fetch mode (s.r.o. companies from ORSR)
_SAMPLE_ICOS = [
    "31351328", "31351336", "31351344", "31351352", "31351361",
    "31351379", "31351387", "31351395", "31351409", "31351417",
    "31351425", "31351433", "31351441", "31351450", "31355153",
    "31355161", "31355170", "31355188", "31355196", "31355200",
    "31355218", "31355226", "31355234", "31355242", "31358357",
    "31358365", "31358373", "31358381", "31358390", "31358471",
    "31364471", "31364489", "31364497", "31364519", "31364535",
    "31364543", "31364551", "31364560", "31364578", "31364594",
    "31364632", "31364659", "31364667", "31364675", "31364683",
    "31364691", "31364705", "31364713", "31364721", "31364730",
]


async def fetch_icos_from_db(count: int) -> list[str]:
    """Read unsynced ICOs from DB (read-only, no writes)."""
    from src.db_client import connect_db, disconnect_db, get_db

    await connect_db()
    db = get_db()
    rows = await db.query_raw(
        """
        SELECT ico FROM "Company"
        WHERE "orsrSyncedAt" IS NULL
          AND "legalForm" = ANY($1)
        ORDER BY ico ASC
        LIMIT $2
        """,
        ["s.r.o.", "a.s.", "v.o.s.", "k.s."],
        count,
    )
    await disconnect_db()
    return [r["ico"] for r in rows]


async def scrape_one_ico(scraper, ico: str) -> dict:
    """Scrape one ICO — NO DB write. Returns timing + result metadata."""
    t0 = time.perf_counter()
    try:
        result = await scraper.run(
            ico=ico,
            output_dir=Path("/tmp/orsr_benchmark"),
            orsr_extract_type="CURRENT",
            skip_pdf=True,
            skip_full_extract=True,
            shared_client=True,
        )
        elapsed = time.perf_counter() - t0
        return {
            "ico": ico,
            "status": result.status,
            "elapsed": elapsed,
            "persons": len(result.persons) if result.persons else 0,
            "share_capital": result.share_capital,
            "findings": (result.findings or "")[:60],
        }
    except Exception as e:
        elapsed = time.perf_counter() - t0
        return {"ico": ico, "status": "ERROR", "elapsed": elapsed, "error": str(e)[:100]}


async def benchmark_concurrency(scraper, icos: list[str], concurrency: int) -> dict:
    """Run benchmark at given concurrency level. NO DB writes."""
    sem = asyncio.Semaphore(concurrency)
    times: list[float] = []
    success = 0
    errors = 0
    not_found = 0

    async def _run(ico: str):
        nonlocal success, errors, not_found
        async with sem:
            r = await scrape_one_ico(scraper, ico)
            if r["status"] == "SUCCESS":
                success += 1
            elif r["status"] == "FAILED" and "neexistuje" in r.get("findings", "").lower():
                not_found += 1
            else:
                errors += 1
            times.append(r["elapsed"])
            return r

    t_start = time.perf_counter()
    tasks = [_run(ico) for ico in icos]
    await asyncio.gather(*tasks, return_exceptions=True)
    total_elapsed = time.perf_counter() - t_start

    times.sort()
    n = len(times)
    p50 = times[n // 2] if n > 0 else 0
    p95 = times[int(n * 0.95)] if n > 0 else 0
    avg = statistics.mean(times) if times else 0
    throughput = (len(icos) / total_elapsed * 60) if total_elapsed > 0 else 0

    return {
        "concurrency": concurrency,
        "total": len(icos),
        "success": success,
        "not_found": not_found,
        "errors": errors,
        "total_elapsed": total_elapsed,
        "throughput": throughput,
        "avg_time": avg,
        "p50": p50,
        "p95": p95,
    }


async def main(args):
    logging.basicConfig(
        level=logging.WARNING,  # Suppress per-company INFO logs during benchmark
        format="%(asctime)s [%(levelname)s] %(message)s",
        datefmt="%H:%M:%S",
    )

    from src.scrapers.orsr import OrsrScraper

    # Get ICOs
    if args.skip_fetch:
        icos = _SAMPLE_ICOS[:args.count]
        logger.warning(f"Using {len(icos)} hardcoded ICOs (no DB read)")
    else:
        logger.warning(f"Fetching {args.count} unsynced ICOs from DB (read-only)...")
        icos = await fetch_icos_from_db(args.count)
        if not icos:
            print("No unsynced ICOs found in DB.")
            return

    levels = [int(x) for x in args.levels.split(",")]
    results = []

    print(f"\n{'='*70}")
    print(f"  ORSR READ-ONLY BENCHMARK")
    print(f"  Companies per level: {len(icos)}")
    print(f"  Concurrency levels:  {levels}")
    print(f"  DB writes:           NONE (read-only)")
    print(f"  skip_pdf:            True")
    print(f"  skip_full_extract:   True")
    print(f"  shared_client:       True")
    print(f"{'='*70}\n")

    for conc in levels:
        print(f"  → Testing concurrency={conc}...")
        scraper = OrsrScraper(browser=None)
        try:
            r = await benchmark_concurrency(scraper, icos, conc)
            results.append(r)
            print(f"    success={r['success']}  errors={r['errors']}  not_found={r['not_found']}")
            print(f"    throughput={r['throughput']:.1f}/min  avg={r['avg_time']:.2f}s  "
                  f"p50={r['p50']:.2f}s  p95={r['p95']:.2f}s  total={r['total_elapsed']:.1f}s\n")
        finally:
            await OrsrScraper.close_shared_client()
            await scraper._close()

    # Summary table
    print(f"\n{'='*70}")
    print(f"  SUMMARY — ORSR Read-Only Benchmark")
    print(f"{'='*70}")
    print(f"  {'Conc':>4}  {'Total':>5}  {'OK':>4}  {'Err':>4}  {'NF':>4}  "
          f"{'/min':>7}  {'avg':>6}  {'p50':>6}  {'p95':>6}  {'total':>7}")
    print(f"  {'-'*4}  {'-'*5}  {'-'*4}  {'-'*4}  {'-'*4}  {'-'*7}  {'-'*6}  {'-'*6}  {'-'*6}  {'-'*7}")
    for r in results:
        print(f"  {r['concurrency']:>4}  {r['total']:>5}  {r['success']:>4}  {r['errors']:>4}  "
              f"{r['not_found']:>4}  {r['throughput']:>7.1f}  {r['avg_time']:>5.2f}s  "
              f"{r['p50']:>5.2f}s  {r['p95']:>5.2f}s  {r['total_elapsed']:>6.1f}s")
    print(f"{'='*70}")

    # Recommendation
    best = max(results, key=lambda r: r["throughput"])
    print(f"\n  Best throughput: concurrency={best['concurrency']} at {best['throughput']:.1f}/min")
    print(f"  (0 DB writes — safe to run alongside production backfill)")
    print(f"{'='*70}\n")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="ORSR Read-Only Performance Benchmark")
    parser.add_argument("--count", type=int, default=30, help="Companies per concurrency level (default: 30)")
    parser.add_argument("--levels", type=str, default="5,6,8", help="Concurrency levels (default: 5,6,8)")
    parser.add_argument("--skip-fetch", action="store_true", help="Use hardcoded ICOs (no DB read)")
    args = parser.parse_args()
    asyncio.run(main(args))
