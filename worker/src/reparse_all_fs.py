"""Mass re-parse: Re-fetch RÚZ data and re-parse ALL FS with fixed parser.

Phase 1: FS WITHOUT netProfitLoss (946K FS, 227K ICOs) — highest ROI
Phase 2: FS WITH netProfitLoss (405K FS, 72K ICOs) — verify other fields

Strategy:
  - Batch by ICO (not FS) to minimize API calls
  - For each ICO: fetch entity → all zavierky → all vykazy → parse → update DB
  - Concurrency: 10
  - Checkpoint every ~2K ICOs (~10K FS)
  - After checkpoint: coverage comparison + log
  - Resume capability (checkpoint file)

Usage:
  python -m src.reparse_all_fs --phase 1          # Phase 1 only
  python -m src.reparse_all_fs --phase 2          # Phase 2 only
  python -m src.reparse_all_fs --phase 1 --max 5000  # Dry-run: first 5000 ICOs
  python -m src.reparse_all_fs --phase 1 --resume    # Resume from checkpoint
"""
from __future__ import annotations

import argparse
import asyncio
import json
import logging
import os
import re
import sys
import time
from pathlib import Path
from typing import Optional

import asyncpg
import httpx

# Add worker src to path for imports
sys.path.insert(0, str(Path(__file__).parent))

from ruz_parser import parse_tables_to_metrics, _identify_tables

logger = logging.getLogger(__name__)

RUZ_API = "https://www.registeruz.sk/cruz-public/api"
UA = "Verifa.sk/1.0 (+https://verifa.sk)"
TIMEOUT = 30.0
MAX_CONCURRENT = 8
BATCH_DELAY = 0.05  # 50ms between requests within semaphore
CHECKPOINT_INTERVAL = 2000  # ICOs per checkpoint
CHECKPOINT_FILE = "/app/reparse_checkpoint.json"

# Fields to update (all 14 P&L fields that the parser fix affects)
UPDATE_FIELDS = [
    "netProfitLoss", "profitBeforeTax", "incomeTax", "profitTransfer",
    "operatingCosts", "materialConsumption", "servicesCosts",
    "staffCosts", "depreciation", "interestExpense",
    "financialResult", "grossProfit",
    "taxesFees", "wageCosts",
]

# Map parser field names → DB column names
PARSER_TO_DB = {
    "zisk_alebo_strata_po_zdaneni": "netProfitLoss",
    "zisk_pred_zdanenim": "profitBeforeTax",
    "dan_z_prijmu": "incomeTax",
    "prevod_podielov_spolocnikom": "profitTransfer",
    "naklady_na_hosp_cinnost": "operatingCosts",
    "spotreba_materialu": "materialConsumption",
    "sluzby": "servicesCosts",
    "osobne_naklady": "staffCosts",
    "odpisy": "depreciation",
    "uroky": "interestExpense",
    "vysledok_z_fin_cinnosti": "financialResult",
    "hruba_marza": "grossProfit",
    "dane_a_poplatky": "taxesFees",
    "mzdove_naklady": "wageCosts",
}


async def ruz_get(client, endpoint, params, max_retries=3):
    url = f"{RUZ_API}/{endpoint}"
    for attempt in range(max_retries):
        try:
            resp = await client.get(url, params=params, headers={"User-Agent": UA}, timeout=TIMEOUT)
            if resp.status_code == 200:
                return resp.json()
            if resp.status_code in (429, 502, 503):
                await asyncio.sleep(2 ** attempt)
            else:
                return None
        except Exception:
            await asyncio.sleep(2 ** attempt)
    return None


def _year_from_zavierka(z: dict) -> Optional[int]:
    year_match = re.search(r'20\d{2}', str(z.get("obdobieDo", "")))
    return int(year_match.group()) if year_match else None


async def reparse_ico(client: httpx.AsyncClient, pool: asyncpg.Pool, ico: str) -> dict:
    """Re-parse all FS for a single ICO. Returns stats dict."""
    stats = {"ico": ico, "fetched": 0, "parsed": 0, "updated": 0, "errors": 0, "micro": 0, "standard": 0}

    # 1. Get entity ID
    r = await ruz_get(client, "uctovne-jednotky", {"ico": ico, "zmenene-od": "2000-01-01"})
    if not r or not r.get("id"):
        stats["errors"] += 1
        return stats
    entity_id = r["id"][0]

    # 2. Get entity details (zavierka IDs)
    entity = await ruz_get(client, "uctovna-jednotka", {"id": entity_id})
    if not entity:
        stats["errors"] += 1
        return stats

    zavierka_ids = entity.get("idUctovnychZavierok", [])
    if not zavierka_ids:
        return stats

    # 3. Get existing FS years for this ICO from DB (to know which years to update)
    async with pool.acquire() as conn:
        existing_years = await conn.fetch(
            'SELECT year FROM "FinancialStatement" WHERE "companyIco" = $1', ico
        )
    existing_year_set = {r["year"] for r in existing_years}
    if not existing_year_set:
        return stats

    # 4. Fetch all zavierky
    zavierky = []
    for zid in zavierka_ids:
        z = await ruz_get(client, "uctovna-zavierka", {"id": zid})
        if z:
            zavierky.append(z)

    # 5. Process each zavierka matching existing FS years
    updates = []
    for z in zavierky:
        year = _year_from_zavierka(z)
        if year is None or year not in existing_year_set:
            continue

        # Fetch all výkazy for this závierka
        all_tables = []
        titulna = {}
        for vid in z.get("idUctovnychVykazov", []):
            v = await ruz_get(client, "uctovny-vykaz", {"id": vid})
            if v:
                if v.get("obsah", {}).get("titulnaStrana"):
                    titulna = v["obsah"]["titulnaStrana"]
                if v.get("obsah", {}).get("tabulky"):
                    all_tables.extend(v["obsah"]["tabulky"])

        if not all_tables:
            continue

        stats["fetched"] += 1

        # Parse with fixed parser
        try:
            metrics = parse_tables_to_metrics(all_tables, titulna, ico)
            if metrics is None:
                stats["errors"] += 1
                continue
        except Exception as e:
            logger.warning(f"[REPARSE] IČO {ico} rok {year}: parse error: {e}")
            stats["errors"] += 1
            continue

        stats["parsed"] += 1

        # Detect format for stats
        tab_map = _identify_tables(all_tables)
        income_idx = tab_map.get("income", -1)
        if income_idx >= 0:
            from ruz_parser import _is_micro_income_format
            if _is_micro_income_format(all_tables, income_idx):
                stats["micro"] += 1
            else:
                stats["standard"] += 1

        # Build update dict
        metrics_dict = metrics.model_dump()
        update_values = {}
        for parser_field, db_col in PARSER_TO_DB.items():
            val = metrics_dict.get(parser_field)
            if val is not None:
                try:
                    update_values[db_col] = float(val)
                except (TypeError, ValueError):
                    pass

        if update_values:
            updates.append((year, update_values))

    # 6. Batch update DB (use connection from pool)
    if updates:
        async with pool.acquire() as conn:
            for year, vals in updates:
                try:
                    set_clauses = ", ".join(f'"{k}" = ${i+2}' for i, k in enumerate(vals.keys()))
                    params = [ico] + list(vals.values()) + [year]
                    query = f'''
                        UPDATE "FinancialStatement"
                        SET {set_clauses}
                        WHERE "companyIco" = $1 AND year = ${len(params)}
                    '''
                    result = await conn.execute(query, *params)
                    if result and "UPDATE" in result:
                        stats["updated"] += 1
                except Exception as e:
                    logger.warning(f"[REPARSE] IČO {ico} rok {year}: DB update error: {e}")
                    stats["errors"] += 1

    return stats


async def get_coverage_stats(pool: asyncpg.Pool) -> dict:
    """Get current coverage stats for key fields."""
    async with pool.acquire() as conn:
        total = await conn.fetchval('SELECT COUNT(*) FROM "FinancialStatement"')
        stats = {"total": total}
        for field in ["netProfitLoss", "profitBeforeTax", "incomeTax",
                      "operatingCosts", "materialConsumption", "servicesCosts",
                      "financialResult", "profitTransfer"]:
            count = await conn.fetchval(f'SELECT COUNT(*) FROM "FinancialStatement" WHERE "{field}" IS NOT NULL')
            stats[field] = count
            stats[f"{field}_pct"] = count / total * 100 if total else 0
    return stats


def log_coverage(label: str, stats: dict):
    logger.info(f"\n{'=' * 60}")
    logger.info(f"COVERAGE {label}")
    logger.info(f"{'=' * 60}")
    logger.info(f"Total FS: {stats['total']:,}")
    for field in ["netProfitLoss", "profitBeforeTax", "incomeTax",
                  "operatingCosts", "materialConsumption", "servicesCosts",
                  "financialResult", "profitTransfer"]:
        pct = stats[f"{field}_pct"]
        logger.info(f"  {field:25s}: {stats[field]:>10,} ({pct:5.1f}%)")
    logger.info("")


def load_checkpoint() -> dict:
    p = Path(CHECKPOINT_FILE)
    if p.exists():
        return json.loads(p.read_text())
    return {"processed": 0, "total_updated": 0, "total_errors": 0, "total_micro": 0, "total_standard": 0, "last_ico": None}


def save_checkpoint(cp: dict):
    Path(CHECKPOINT_FILE).write_text(json.dumps(cp, indent=2))


async def main():
    parser = argparse.ArgumentParser(description="Mass re-parse FS with fixed parser")
    parser.add_argument("--phase", type=int, default=1, choices=[1, 2], help="Phase 1 (no netProfitLoss) or Phase 2 (has netProfitLoss)")
    parser.add_argument("--max", type=int, default=None, help="Max ICOs to process (dry-run)")
    parser.add_argument("--resume", action="store_true", help="Resume from checkpoint")
    args = parser.parse_args()

    logging.basicConfig(
        level=logging.WARNING,
        format="%(asctime)s [%(levelname)s] %(message)s",
        stream=sys.stdout,
    )
    # Re-enable INFO for our module only
    logging.getLogger(__name__).setLevel(logging.INFO)
    logging.getLogger("src.ruz_parser").setLevel(logging.WARNING)

    url = os.environ["DATABASE_URL"].replace("postgresql://", "postgres://")
    pool = await asyncpg.create_pool(url, min_size=2, max_size=10)

    # Get ICOs for this phase
    if args.phase == 1:
        where = '"netProfitLoss" IS NULL'
    else:
        where = '"netProfitLoss" IS NOT NULL'

    async with pool.acquire() as conn:
        icos = await conn.fetch(f'''
            SELECT DISTINCT "companyIco" FROM "FinancialStatement"
            WHERE {where}
            AND "companyIco" IS NOT NULL AND "companyIco" != '' AND "companyIco" != '00000000'
            ORDER BY "companyIco"
        ''')
    ico_list = [r["companyIco"] for r in icos]
    logger.info(f"Phase {args.phase}: {len(ico_list):,} ICOs to process")

    if args.max:
        ico_list = ico_list[:args.max]
        logger.info(f"Limited to first {args.max} ICOs (dry-run)")

    # Resume from checkpoint
    cp = load_checkpoint() if args.resume else {"processed": 0, "total_updated": 0, "total_errors": 0, "total_micro": 0, "total_standard": 0, "last_ico": None}
    if args.resume and cp["last_ico"]:
        start_idx = 0
        for i, ico in enumerate(ico_list):
            if ico == cp["last_ico"]:
                start_idx = i + 1
                break
        logger.info(f"Resuming from ICO #{start_idx} ({cp['last_ico']})")
        ico_list = ico_list[start_idx:]

    # Initial coverage
    initial_coverage = await get_coverage_stats(pool)
    log_coverage("BEFORE RE-PARSE", initial_coverage)

    # Process
    sem = asyncio.Semaphore(MAX_CONCURRENT)
    start_time = time.time()

    async with httpx.AsyncClient(verify=False, limits=httpx.Limits(max_connections=MAX_CONCURRENT, max_keepalive_connections=MAX_CONCURRENT)) as client:
        batch_start = 0
        while batch_start < len(ico_list):
            batch_end = min(batch_start + CHECKPOINT_INTERVAL, len(ico_list))
            batch = ico_list[batch_start:batch_end]

            async def process_ico(ico: str) -> dict:
                async with sem:
                    await asyncio.sleep(BATCH_DELAY)
                    return await reparse_ico(client, pool, ico)

            results = await asyncio.gather(*[process_ico(ico) for ico in batch])

            # Aggregate stats
            batch_updated = sum(r["updated"] for r in results)
            batch_errors = sum(r["errors"] for r in results)
            batch_micro = sum(r["micro"] for r in results)
            batch_standard = sum(r["standard"] for r in results)
            batch_fetched = sum(r["fetched"] for r in results)
            batch_parsed = sum(r["parsed"] for r in results)

            cp["processed"] += len(batch)
            cp["total_updated"] += batch_updated
            cp["total_errors"] += batch_errors
            cp["total_micro"] += batch_micro
            cp["total_standard"] += batch_standard
            cp["last_ico"] = batch[-1]

            elapsed = time.time() - start_time
            rate = cp["processed"] / elapsed if elapsed > 0 else 0
            remaining = (len(ico_list) - cp["processed"]) / rate if rate > 0 else 0

            logger.info(
                f"Progress: {cp['processed']:,}/{len(ico_list):,} ICOs "
                f"({cp['processed']/len(ico_list)*100:.1f}%) | "
                f"Updated: {cp['total_updated']:,} | "
                f"Micro: {cp['total_micro']:,} | "
                f"Standard: {cp['total_standard']:,} | "
                f"Errors: {cp['total_errors']:,} | "
                f"Rate: {rate:.1f} ICO/s | "
                f"ETA: {remaining/3600:.1f}h"
            )

            # Always save checkpoint + coverage comparison at every batch
            save_checkpoint(cp)
            current_coverage = await get_coverage_stats(pool)
            log_coverage(f"AFTER {cp['processed']:,} ICOs", current_coverage)

            # Show delta
            logger.info(f"DELTA (before → after {cp['processed']:,} ICOs):")
            for field in ["netProfitLoss", "profitBeforeTax", "incomeTax",
                          "operatingCosts", "materialConsumption", "servicesCosts",
                          "financialResult", "profitTransfer"]:
                before = initial_coverage[field]
                after = current_coverage[field]
                delta = after - before
                logger.info(f"  {field:25s}: {before:>10,} → {after:>10,} ({'+' if delta >= 0 else ''}{delta:,})")
            logger.info("")

            batch_start = batch_end

    # Final coverage
    final_coverage = await get_coverage_stats(pool)
    log_coverage("FINAL", final_coverage)

    logger.info(f"\nDONE: {cp['processed']:,} ICOs processed, {cp['total_updated']:,} FS updated, {cp['total_errors']:,} errors")
    logger.info(f"Total time: {(time.time() - start_time)/3600:.1f} hours")

    await pool.close()


if __name__ == "__main__":
    asyncio.run(main())
