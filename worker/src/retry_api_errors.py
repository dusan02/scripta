#!/usr/bin/env python3
"""Retry API errors from balance-sheet reparse.

Targets remaining Pattern A + B FS that still have gaps after the main reparse.
Classifies each FS into:
  - REPARSED: API returned data, parser extracted fields, DB updated
  - SOURCE_GAP: API returned vykaz but tables are empty (0 rows)
  - API_ERROR: API request failed (timeout, 403, JSON decode)
  - UNKNOWN_TEMPLATE: API returned vykaz with unsupported idSablony

Runs with concurrency=2 and 1s delay between requests to avoid rate limiting.

Usage:
  python3 -m src.retry_api_errors --concurrency 2
  python3 -m src.retry_api_errors --concurrency 2 --max 100 --dry-run
"""
import asyncio
import asyncpg
import httpx
import json
import logging
import os
import re
import time
from pathlib import Path
from typing import Optional

from src.ruz_parser import (
    _identify_tables,
    _get_activ_value,
    _get_pasiv_value,
    ROW_MICRO_TOTAL_ASSETS,
    ROW_MICRO_CURRENT_ASSETS,
    ROW_MICRO_INVENTORY,
    ROW_MICRO_CASH,
    ROW_MICRO_TRADE_RECEIVABLES,
    ROW_MICRO_NON_CURRENT_ASSETS,
    ROW_MICRO_TOTAL_EQUITY,
    ROW_MICRO_LT_LIABILITIES,
    ROW_MICRO_ST_LIABILITIES,
    ROW_MICRO_TRADE_PAYABLES,
    ROW_TOTAL_ASSETS,
    ROW_CURRENT_ASSETS,
    ROW_INVENTORY,
    ROW_CASH,
    ROW_TRADE_RECEIVABLES,
    ROW_TOTAL_EQUITY,
    ROW_LT_LIABILITIES,
    ROW_ST_LIABILITIES,
    ROW_TRADE_PAYABLES,
)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
)
logger = logging.getLogger(__name__)

DB_DSN = os.environ.get("DATABASE_URL", "postgresql://verifa:verifa@localhost:5432/verifa")
RUZ_API = "https://www.registeruz.sk/cruz-public/api"
UA = "Verifa.sk/1.0 (+https://verifa.sk)"
TIMEOUT = 45.0  # Longer timeout for retry

CHECKPOINT_FILE = "/app/output/retry_api_errors_checkpoint.json"


async def ruz_get(client, endpoint, params, max_retries=5):
    """Fetch from RÚZ API with extended retries for error recovery."""
    url = f"{RUZ_API}/{endpoint}"
    for attempt in range(max_retries):
        try:
            resp = await client.get(url, params=params, headers={"User-Agent": UA}, timeout=TIMEOUT)
            if resp.status_code == 200:
                return resp.json()
            if resp.status_code in (429, 502, 503):
                await asyncio.sleep(3 ** attempt)  # Longer backoff
                continue
            if resp.status_code == 403:
                logger.warning(f"[RUZ_API] 403: {endpoint} params={params}")
                return None
            return None
        except (httpx.TimeoutException, httpx.ConnectError, httpx.ReadError) as e:
            await asyncio.sleep(3 ** attempt)
        except json.JSONDecodeError as e:
            # Empty response body — retry once more after delay
            if attempt < max_retries - 1:
                await asyncio.sleep(5)
                continue
            logger.warning(f"[RUZ_API] JSONDecodeError after {max_retries} retries: {endpoint} params={params}")
            return "JSON_ERROR"
    return None


def save_checkpoint(cp):
    Path(CHECKPOINT_FILE).parent.mkdir(parents=True, exist_ok=True)
    with open(CHECKPOINT_FILE, "w") as f:
        json.dump(cp, f)


def load_checkpoint():
    if os.path.exists(CHECKPOINT_FILE):
        with open(CHECKPOINT_FILE) as f:
            return json.load(f)
    return {"processed_icos": [], "reparsed": 0, "source_gap": 0, "api_error": 0, "unknown_template": 0}


async def classify_and_parse(client, entity_id, target_year):
    """Fetch RÚZ data for one year and classify the result.

    Returns (classification, id_sablony, fields_dict)
    classification: 'REPARSED', 'SOURCE_GAP', 'API_ERROR', 'UNKNOWN_TEMPLATE'
    """
    entity = await ruz_get(client, "uctovna-jednotka", {"id": entity_id})
    if entity is None or entity == "JSON_ERROR":
        return "API_ERROR", None, None
    if not entity:
        return "API_ERROR", None, None

    zavierka_ids = entity.get("idUctovnychZavierok", [])
    if not zavierka_ids:
        return "SOURCE_GAP", None, None  # No zavierky = no data

    for zid in zavierka_ids:
        z = await ruz_get(client, "uctovna-zavierka", {"id": zid})
        if z is None or z == "JSON_ERROR":
            continue
        if not z:
            continue

        obdobie_do = z.get("obdobieDo", "")
        m = re.search(r'(20\d{2})', str(obdobie_do))
        if not m:
            continue
        year = int(m.group(1))
        if year != target_year:
            continue

        vykaz_ids = z.get("idUctovnychVykazov", [])
        if not vykaz_ids:
            return "SOURCE_GAP", None, None  # Zavierka exists but no vykazy

        all_tables = []
        id_sablony = None
        for vid in vykaz_ids:
            v = await ruz_get(client, "uctovny-vykaz", {"id": vid})
            if v is None or v == "JSON_ERROR":
                continue
            if not v:
                continue
            if v.get("obsah", {}).get("tabulky"):
                tables = v["obsah"]["tabulky"]
                all_tables.extend(tables)
                if id_sablony is None:
                    id_sablony = v.get("idSablony")

        if id_sablony is None:
            return "API_ERROR", None, None  # All vykazy failed

        # Check if tables have any data
        total_rows = sum(len(t.get("riadky", [])) for t in all_tables)
        if total_rows == 0:
            return "SOURCE_GAP", id_sablony, None  # Empty tables = source gap

        # Parse with correct template
        tab_map = _identify_tables(all_tables)
        if "aktiv" not in tab_map or "pasiv" not in tab_map:
            return "SOURCE_GAP", id_sablony, None  # No balance sheet tables

        ordered = [all_tables[tab_map["aktiv"]], all_tables[tab_map["pasiv"]]]
        if "income" in tab_map:
            ordered.append(all_tables[tab_map["income"]])

        fields = {}
        if id_sablony == 687:
            fields["totalAssets"] = _get_activ_value(ordered, ROW_MICRO_TOTAL_ASSETS, id_sablony=687)
            fields["currentAssets"] = _get_activ_value(ordered, ROW_MICRO_CURRENT_ASSETS, id_sablony=687)
            fields["nonCurrentAssets"] = _get_activ_value(ordered, ROW_MICRO_NON_CURRENT_ASSETS, id_sablony=687)
            fields["inventory"] = _get_activ_value(ordered, ROW_MICRO_INVENTORY, id_sablony=687)
            fields["cashAndEquivalents"] = _get_activ_value(ordered, ROW_MICRO_CASH, id_sablony=687)
            fields["tradeReceivables"] = _get_activ_value(ordered, ROW_MICRO_TRADE_RECEIVABLES, id_sablony=687)
            fields["equity"] = _get_pasiv_value(ordered, ROW_MICRO_TOTAL_EQUITY, id_sablony=687)
            fields["longTermLiabilities"] = _get_pasiv_value(ordered, ROW_MICRO_LT_LIABILITIES, id_sablony=687)
            fields["shortTermLiabilities"] = _get_pasiv_value(ordered, ROW_MICRO_ST_LIABILITIES, id_sablony=687)
            fields["tradePayables"] = _get_pasiv_value(ordered, ROW_MICRO_TRADE_PAYABLES, id_sablony=687)
        elif id_sablony == 699:
            fields["totalAssets"] = _get_activ_value(ordered, ROW_TOTAL_ASSETS, id_sablony=699)
            fields["currentAssets"] = _get_activ_value(ordered, ROW_CURRENT_ASSETS, id_sablony=699)
            fields["inventory"] = _get_activ_value(ordered, ROW_INVENTORY, id_sablony=699)
            fields["cashAndEquivalents"] = _get_activ_value(ordered, ROW_CASH, id_sablony=699)
            fields["tradeReceivables"] = _get_activ_value(ordered, ROW_TRADE_RECEIVABLES, id_sablony=699)
            fields["equity"] = _get_pasiv_value(ordered, ROW_TOTAL_EQUITY, id_sablony=699)
            fields["longTermLiabilities"] = _get_pasiv_value(ordered, ROW_LT_LIABILITIES, id_sablony=699)
            fields["shortTermLiabilities"] = _get_pasiv_value(ordered, ROW_ST_LIABILITIES, id_sablony=699)
            fields["tradePayables"] = _get_pasiv_value(ordered, ROW_TRADE_PAYABLES, id_sablony=699)
        else:
            return "UNKNOWN_TEMPLATE", id_sablony, None

        # Only return if we got at least totalAssets or currentAssets
        if fields.get("totalAssets") is not None or fields.get("currentAssets") is not None:
            return "REPARSED", id_sablony, fields
        return "SOURCE_GAP", id_sablony, None  # Tables had rows but parser found nothing

    return "API_ERROR", None, None  # No matching zavierka found


async def main(concurrency=2, max_count=0, resume=False, dry_run=False):
    cp = load_checkpoint() if resume else {
        "processed_icos": [], "reparsed": 0, "source_gap": 0,
        "api_error": 0, "unknown_template": 0,
    }
    processed_set = set(cp.get("processed_icos", []))

    pool = await asyncpg.create_pool(DB_DSN, min_size=1, max_size=concurrency + 1)

    # Get remaining Pattern A + B FS with ruzEntityId
    async with pool.acquire() as c:
        rows = await c.fetch(
            'SELECT fs."companyIco", fs.year, c."ruzEntityId" '
            'FROM "FinancialStatement" fs '
            'JOIN "Company" c ON c.ico = fs."companyIco" '
            'WHERE c."ruzEntityId" IS NOT NULL '
            'AND fs."companyIco" IS NOT NULL '
            'AND ('
            '  (fs."totalAssets" IS NULL AND fs."equity" IS NOT NULL)'
            '  OR '
            '  (fs."totalAssets" IS NOT NULL AND fs."currentAssets" IS NULL AND fs."shortTermLiabilities" IS NULL)'
            ') '
            'ORDER BY fs."companyIco"',
        )

    # Group by ICO
    ico_data = {}
    for r in rows:
        ico = r["companyIco"]
        if ico not in ico_data:
            ico_data[ico] = {"years": set(), "entity_id": r["ruzEntityId"]}
        ico_data[ico]["years"].add(r["year"])

    all_icos = list(ico_data.keys())
    logger.info(f"Total ICOs to retry: {len(all_icos)}")
    logger.info(f"Total FS to retry: {len(rows)}")

    if dry_run:
        logger.info("DRY RUN MODE — no DB writes, classification only")

    todo = [ico for ico in all_icos if ico not in processed_set]
    if max_count > 0:
        todo = todo[:max_count]
    logger.info(f"To process: {len(todo)} (already done: {len(processed_set)})")

    sem = asyncio.Semaphore(concurrency)
    batch_size = 50
    reparsed = cp.get("reparsed", 0)
    source_gap = cp.get("source_gap", 0)
    api_error = cp.get("api_error", 0)
    unknown_template = cp.get("unknown_template", 0)
    processed_list = list(processed_set)

    async with httpx.AsyncClient(
        verify=False,
        limits=httpx.Limits(max_connections=concurrency, max_keepalive_connections=concurrency),
    ) as client:
        async def process_ico(ico):
            nonlocal reparsed, source_gap, api_error, unknown_template
            async with sem:
                await asyncio.sleep(1.0)  # 1s delay between requests
                try:
                    data = ico_data.get(ico, {})
                    target_years = data.get("years", set())
                    entity_id = data.get("entity_id")

                    ico_reparsed = 0
                    ico_source_gap = 0
                    ico_api_error = 0
                    ico_unknown = 0

                    for year in target_years:
                        classification, id_sablony, fields = await classify_and_parse(client, entity_id, year)

                        if classification == "REPARSED" and fields:
                            if not dry_run:
                                # Idempotent UPDATE — also recompute dataQualityStatus
                                # so it never drifts from the BS fields being written.
                                dq_status = (
                                    "AVAILABLE"
                                    if fields.get("totalAssets") is not None
                                    and fields.get("currentAssets") is not None
                                    else "SOURCE_GAP"
                                )
                                sets = []
                                params = []
                                idx = 1
                                for k, v in fields.items():
                                    if v is not None:
                                        sets.append(f'"{k}" = ${idx}')
                                        params.append(v)
                                        idx += 1
                                sets.append(f'"dataQualityStatus" = ${idx}')
                                params.append(dq_status)
                                idx += 1
                                if sets:
                                    params.extend([ico, year])
                                    async with pool.acquire() as c:
                                        await c.execute(
                                            f'UPDATE "FinancialStatement" SET {", ".join(sets)} '
                                            f'WHERE "companyIco" = ${idx} AND year = ${idx + 1}',
                                            *params,
                                        )
                            ico_reparsed += 1
                        elif classification == "SOURCE_GAP":
                            ico_source_gap += 1
                        elif classification == "API_ERROR":
                            ico_api_error += 1
                        elif classification == "UNKNOWN_TEMPLATE":
                            ico_unknown += 1

                    reparsed += ico_reparsed
                    source_gap += ico_source_gap
                    api_error += ico_api_error
                    unknown_template += ico_unknown

                    processed_list.append(ico)

                except Exception as e:
                    logger.error(f"[{ico}] Error: {e}", exc_info=True)
                    api_error += len(target_years)
                    processed_list.append(ico)

        # Process in batches
        batch_start = 0
        total_todo = len(todo)
        while batch_start < total_todo:
            batch = todo[batch_start:batch_start + batch_size]
            await asyncio.gather(*[process_ico(ico) for ico in batch])
            batch_start += batch_size

            if batch_start % 500 == 0 or batch_start >= total_todo:
                logger.info(
                    f"Batch {batch_start}/{total_todo} ({100*batch_start/total_todo:.1f}%): "
                    f"reparsed={reparsed} source_gap={source_gap} "
                    f"api_error={api_error} unknown={unknown_template}"
                )
                # Save checkpoint
                cp = {
                    "processed_icos": processed_list,
                    "reparsed": reparsed,
                    "source_gap": source_gap,
                    "api_error": api_error,
                    "unknown_template": unknown_template,
                }
                save_checkpoint(cp)

    logger.info(
        f"DONE — reparsed={reparsed}, source_gap={source_gap}, "
        f"api_error={api_error}, unknown_template={unknown_template}"
    )

    await pool.close()


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("--concurrency", type=int, default=2)
    parser.add_argument("--max", type=int, default=0)
    parser.add_argument("--resume", action="store_true")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    asyncio.run(main(
        concurrency=args.concurrency,
        max_count=args.max,
        resume=args.resume,
        dry_run=args.dry_run,
    ))
