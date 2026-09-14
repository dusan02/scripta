"""
Audit: find companies whose latest financial statement in DB is older than a
target year, then verify against RÚZ whether a newer závierka actually exists.

Context (2026-09): firms seeded only from SK GAAP JSON tables show stale years
(e.g. Marelli 36751758 → 2013-2015) because IFRS/FRSR statements are PDF-only
in RÚZ and are skipped by the deterministic parsers. This script produces the
authoritative split between:
  - GAP_OURS          RÚZ has a newer závierka (>= min-year) that our DB lacks
  - GAP_OURS_PREV     RÚZ latest == min-year-1 and --include-prev-year was set
  - OK_NOT_FILED      RÚZ latest year matches our DB (firm has not filed newer)
  - RUZ_NO_STATEMENTS firm has no public závierky at all in RÚZ
  - RUZ_ENTITY_NOT_FOUND / RUZ_DELETED / RUZ_API_ERROR

Usage (run inside the worker container on the server):
  python -m src.audit_missing_recent_financials --min-year 2025            # full run
  python -m src.audit_missing_recent_financials --max 100                  # smoke test
  python -m src.audit_missing_recent_financials --resume                   # resume
  python -m src.audit_missing_recent_financials --summary                  # aggregate only

Per company: 1-2 RÚZ API calls (entity detail + latest závierka detail).
Results append to results/audit_missing_financials_<min-year>.jsonl.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import logging
import sys
import time
from pathlib import Path
from typing import Optional

import httpx

sys.path.insert(0, str(Path(__file__).parent))

from db_client import connect_db, disconnect_db, get_db

logger = logging.getLogger(__name__)

RUZ_API = "https://www.registeruz.sk/cruz-public/api"
UA = "Verifa.sk/1.0 (+https://verifa.sk)"
TIMEOUT = 30.0


# ── RÚZ API ──────────────────────────────────────────────────────────────────

async def ruz_get(
    client: httpx.AsyncClient,
    endpoint: str,
    params: dict,
    max_retries: int = 3,
) -> Optional[dict]:
    url = f"{RUZ_API}/{endpoint}"
    for attempt in range(max_retries):
        try:
            resp = await client.get(url, params=params, headers={"User-Agent": UA}, timeout=TIMEOUT)
            if resp.status_code == 200:
                return resp.json()
            if resp.status_code in (429, 502, 503):
                wait = 2 ** attempt
                logger.warning(f"RUZ {resp.status_code} for {endpoint}, retrying in {wait}s")
                await asyncio.sleep(wait)
                continue
            return None
        except (httpx.TimeoutException, httpx.ConnectError) as e:
            wait = 2 ** attempt
            logger.warning(f"RUZ error for {endpoint}: {e}, retrying in {wait}s")
            await asyncio.sleep(wait)
    return None


def _year_from_obdobie(obdobie_do: str) -> int:
    try:
        return int((obdobie_do or "")[:4])
    except ValueError:
        return 0


# ── Per-company check ────────────────────────────────────────────────────────

async def check_company(
    client: httpx.AsyncClient,
    c,
    min_year: int,
    include_prev: bool,
) -> dict:
    rec: dict = {
        "ico": c.ico,
        "name": c.name,
        "dbLatestYear": c.latestYear,
        "ruzEntityId": c.ruzEntityId,
    }

    if not c.ruzEntityId:
        rec["classification"] = "NO_RUZ_ENTITY_ID"
        return rec

    entity = await ruz_get(client, "uctovna-jednotka", {"id": c.ruzEntityId})
    if not entity:
        rec["classification"] = "RUZ_API_ERROR"
        return rec
    if entity.get("stav") == "ZMAZANÉ":
        rec["classification"] = "RUZ_DELETED"
        return rec

    zavierka_ids = entity.get("idUctovnychZavierok") or []
    if not zavierka_ids:
        rec["classification"] = "RUZ_NO_STATEMENTS"
        return rec

    latest = await ruz_get(client, "uctovna-zavierka", {"id": max(zavierka_ids)})
    if not latest:
        rec["classification"] = "RUZ_API_ERROR"
        return rec

    ruz_year = _year(latest.get("obdobieDo", ""))
    rec["ruzLatestYear"] = ruz_year
    rec["ruzLatestZavierkaId"] = latest.get("id")
    rec["ruzKonsolidovana"] = bool(latest.get("konsolidovana", False))
    rec["ruzTyp"] = latest.get("typ")

    if ruz_year >= min_year:
        rec["classification"] = "GAP_OURS"
    elif include_prev and ruz_year == min_year - 1:
        rec["classification"] = "GAP_OURS_PREV_YEAR"
    else:
        rec["classification"] = "OK_NOT_FILED"
    return rec


# ── Main ─────────────────────────────────────────────────────────────────────

async def run_audit(args: argparse.Namespace) -> None:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(message)s",
        handlers=[logging.StreamHandler()],
    )

    await connect_db()
    db = get_db()

    # Phase 1: DB-only — companies without any FinancialStatement for year >= min_year
    companies = await db.company.find_many(
        where={"financialStatements": {"none": {"year": {"gte": args.min_year}}}},
        select={"ico": True, "name": True, "latestYear": True, "ruzEntityId": True},
    )
    logger.info(f"Phase 1 (DB): {len(companies)} companies without year>={args.min_year} statement")

    if args.summary:
        summarize(Path("results") / f"audit_missing_financials_{args.min_year}.jsonl")
        await disconnect_db()
        return

    if args.max:
        companies = companies[: args.max]

    results_file = Path("results") / f"audit_missing_financials_{args.min_year}.jsonl"
    results_file.parent.mkdir(parents=True, exist_ok=True)

    done: set[str] = set()
    if args.resume and results_file.exists():
        with results_file.open(encoding="utf-8") as f:
            for line in f:
                try:
                    done.add(json.loads(line)["ico"])
                except Exception:
                    continue
        logger.info(f"Resume: {len(done)} ICOs already audited")

    todo = [c for c in companies if c.ico not in done]
    logger.info(f"Phase 2 (RÚZ): auditing {len(todo)} companies (concurrency={args.concurrency})")

    counts: dict[str, int] = {}
    sem = asyncio.Semaphore(args.concurrency)
    t0 = time.perf_counter()
    processed = 0

    out = results_file.open("a", encoding="utf-8")

    async def audit_one(c) -> None:
        nonlocal processed
        async with sem:
            rec = await check_company(client, c, args.min_year, args.include_prev_year)
            out.write(json.dumps(rec, ensure_ascii=False) + "\n")
            processed += 1
            cls = rec["classification"]
            counts[cls] = counts.get(cls, 0) + 1
            if processed % 500 == 0:
                out.flush()
                rate = processed / max(time.perf_counter() - t0, 1)
                eta_h = (len(todo) - processed) / max(rate, 0.01) / 3600
                logger.info(
                    f"Progress {processed}/{len(todo)} ({rate:.1f}/s, ETA {eta_h:.1f}h): {counts}"
                )

    async with httpx.AsyncClient(limits=httpx.Limits(
        max_connections=args.concurrency, max_keepalive_connections=args.concurrency,
    )) as client:
        await asyncio.gather(*[audit_one(c) for c in todo])

    out.flush()
    out.close()

    logger.info(f"Audit complete: {counts}")
    logger.info(f"Results: {results_file}")
    await disconnect_db()


def summarize(path: Path) -> None:
    if not path.exists():
        print(f"No results file: {path}")
        return
    counts: dict[str, int] = {}
    gap_by_year: dict[int, int] = {}
    gap_kons: dict[str, int] = {}
    total = 0
    with path.open(encoding="utf-8") as f:
        for line in f:
            try:
                rec = json.loads(line)
            except Exception:
                continue
            total += 1
            cls = rec.get("classification", "?")
            counts[cls] = counts.get(cls, 0) + 1
            if cls.startswith("GAP"):
                y = rec.get("ruzLatestYear") or 0
                gap_by_year[y] = gap_by_year.get(y, 0) + 1
                key = "ifrs" if rec.get("ruzKonsolidovana") else "sk_gaap_or_unknown"
                gap_kons[key] = gap_kons.get(key, 0) + 1
    print(f"File: {path}")
    print(f"Total audited: {total}")
    for k in sorted(counts):
        print(f"  {k}: {counts[k]}")
    print("GAP firms by RÚZ latest year:")
    for y in sorted(gap_by_year, reverse=True):
        print(f"  {y}: {gap_by_year[y]}")
    print("GAP firms by statement type:")
    for k in sorted(gap_kons):
        print(f"  {k}: {gap_kons[k]}")


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Audit firms missing recent financial statements")
    p.add_argument("--min-year", type=int, default=2025, help="Target latest year (default 2025)")
    p.add_argument("--include-prev-year", action="store_true",
                   help="Also flag firms whose RÚZ latest == min-year-1 (e.g. 2024)")
    p.add_argument("--max", type=int, default=0, help="Limit companies (0 = all)")
    p.add_argument("--concurrency", type=int, default=10)
    p.add_argument("--resume", action="store_true", help="Skip ICOs already present in results file")
    p.add_argument("--summary", action="store_true", help="Aggregate existing results and exit")
    return p.parse_args()


if __name__ == "__main__":
    asyncio.run(run_audit(parse_args()))
