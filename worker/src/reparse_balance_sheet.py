#!/usr/bin/env python3
"""Targeted reparse: fix balance-sheet corruption for template 687 FS.

Only reparses FS where:
- totalAssets IS NULL AND equity IS NOT NULL (Pattern A: missing), OR
- totalAssets IS NOT NULL AND currentAssets IS NULL AND shortTermLiabilities IS NULL (Pattern B: corruption)

For each FS:
1. Fetch raw RÚZ JSON via ruzEntityId (bypasses 403 WAF)
2. Confirm idSablony from API
3. If idSablony == 687: use 687 row mapping + data_cols=2
4. If idSablony == 699: use standard mapping (fixes Pattern A only)
5. Idempotent UPDATE: only writes if new value differs from DB

Usage:
  python3 -m src.reparse_balance_sheet --concurrency 5 --dry-run --max 100
  python3 -m src.reparse_balance_sheet --concurrency 5 --resume
"""
import asyncio
import asyncpg
import httpx
import json
import logging
import os
import re
import sys
import time
from pathlib import Path
from typing import Optional

from src.ruz_parser import (
    parse_zavierka_to_metrics,
    _identify_tables,
    _get_activ_value,
    _get_pasiv_value,
    ROW_MICRO_TOTAL_ASSETS,
    ROW_MICRO_CURRENT_ASSETS,
    ROW_MICRO_INVENTORY,
    ROW_MICRO_CASH,
    ROW_MICRO_TRADE_RECEIVABLES,
    ROW_MICRO_FINANCIAL_ASSETS,
    ROW_MICRO_NON_CURRENT_ASSETS,
    ROW_MICRO_TOTAL_EQUITY,
    ROW_MICRO_TOTAL_LIABILITIES,
    ROW_MICRO_LT_LIABILITIES,
    ROW_MICRO_ST_LIABILITIES,
    ROW_MICRO_TRADE_PAYABLES,
    ROW_TOTAL_ASSETS,
    ROW_CURRENT_ASSETS,
    ROW_INVENTORY,
    ROW_CASH,
    ROW_TRADE_RECEIVABLES,
    ROW_TOTAL_EQUITY,
    ROW_TOTAL_LIABILITIES,
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
TIMEOUT = 30.0

CHECKPOINT_FILE = "/app/output/balance_sheet_reparse_checkpoint.json"


async def ruz_get(client, endpoint, params, max_retries=3):
    url = f"{RUZ_API}/{endpoint}"
    for attempt in range(max_retries):
        try:
            resp = await client.get(url, params=params, headers={"User-Agent": UA}, timeout=TIMEOUT)
            if resp.status_code == 200:
                return resp.json()
            if resp.status_code in (429, 502, 503):
                await asyncio.sleep(2 ** attempt)
                continue
            if resp.status_code == 403:
                logger.warning(f"[RUZ_API] 403: {endpoint} params={params}")
                return None
            return None
        except (httpx.TimeoutException, httpx.ConnectError, httpx.ReadError) as e:
            await asyncio.sleep(2 ** attempt)
    return None


def save_checkpoint(cp):
    Path(CHECKPOINT_FILE).parent.mkdir(parents=True, exist_ok=True)
    with open(CHECKPOINT_FILE, "w") as f:
        json.dump(cp, f)


def load_checkpoint():
    if os.path.exists(CHECKPOINT_FILE):
        with open(CHECKPOINT_FILE) as f:
            return json.load(f)
    return {"processed_icos": [], "total_updated": 0, "total_skipped": 0, "total_687": 0, "total_699": 0, "total_other": 0}


async def fetch_and_parse(client, entity_id, target_year):
    """Fetch RÚZ data for one year and parse with correct template.
    Returns (id_sablony, fields_dict) or (None, None)."""
    entity = await ruz_get(client, "uctovna-jednotka", {"id": entity_id})
    if not entity:
        return None, None

    zavierka_ids = entity.get("idUctovnychZavierok", [])
    if not zavierka_ids:
        return None, None

    for zid in zavierka_ids:
        z = await ruz_get(client, "uctovna-zavierka", {"id": zid})
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
            continue

        all_tables = []
        id_sablony = None
        titulna = {}
        for vid in vykaz_ids:
            v = await ruz_get(client, "uctovny-vykaz", {"id": vid})
            if v and v.get("obsah", {}).get("tabulky"):
                tables = v["obsah"]["tabulky"]
                all_tables.extend(tables)
                if id_sablony is None:
                    id_sablony = v.get("idSablony")
                if not titulna:
                    titulna = v["obsah"].get("titulnaStrana", {})

        if not all_tables or id_sablony is None:
            return id_sablony, None

        # Parse with correct template
        tab_map = _identify_tables(all_tables)
        if "aktiv" not in tab_map or "pasiv" not in tab_map:
            return id_sablony, None

        ordered = [all_tables[tab_map["aktiv"]], all_tables[tab_map["pasiv"]]]
        if "income" in tab_map:
            ordered.append(all_tables[tab_map["income"]])

        fields = {}
        if id_sablony == 687:
            # 687 row mapping + data_cols=2
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
            # Standard 699 mapping
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
            # Unknown template — skip
            return id_sablony, None

        # Only return if we got at least totalAssets or equity
        if fields.get("totalAssets") is not None or fields.get("equity") is not None:
            return id_sablony, fields
        return id_sablony, None

    return None, None


async def main(concurrency=5, max_count=0, resume=False, dry_run=False):
    cp = load_checkpoint() if resume else {"processed_icos": [], "total_updated": 0, "total_skipped": 0, "total_687": 0, "total_699": 0, "total_other": 0}
    processed_set = set(cp.get("processed_icos", []))

    conn = await asyncpg.create_pool(DB_DSN, min_size=1, max_size=concurrency + 1)

    # Get FS needing reparse: Pattern A (missing) + Pattern B (corruption)
    async with conn.acquire() as c:
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

    # Group: {ico: {years: set, entity_id: int}}
    ico_data = {}
    for r in rows:
        ico = r["companyIco"]
        if ico not in ico_data:
            ico_data[ico] = {"years": set(), "entity_id": r["ruzEntityId"]}
        ico_data[ico]["years"].add(r["year"])

    all_icos = list(ico_data.keys())
    logger.info(f"Total ICOs needing reparse: {len(all_icos)}")
    logger.info(f"Total FS needing reparse: {len(rows)}")

    if dry_run:
        logger.info("DRY RUN MODE — no DB writes")

    todo = [ico for ico in all_icos if ico not in processed_set]
    if max_count > 0:
        todo = todo[:max_count]
    logger.info(f"To process: {len(todo)} (already done: {len(processed_set)})")

    sem = asyncio.Semaphore(concurrency)
    batch_size = 100
    updated = cp.get("total_updated", 0)
    skipped = cp.get("total_skipped", 0)
    count_687 = cp.get("total_687", 0)
    count_699 = cp.get("total_699", 0)
    count_other = cp.get("total_other", 0)
    processed_list = list(processed_set)

    async with httpx.AsyncClient(verify=False, limits=httpx.Limits(max_connections=concurrency, max_keepalive_connections=concurrency)) as client:
        async def process_ico(ico):
            nonlocal updated, skipped, count_687, count_699, count_other
            async with sem:
                await asyncio.sleep(0.3)
                try:
                    data = ico_data.get(ico, {})
                    target_years = data.get("years", set())
                    entity_id = data.get("entity_id")

                    ico_updated = False
                    ico_687 = 0
                    ico_699 = 0
                    ico_other = 0

                    for year in target_years:
                        id_sablony, fields = await fetch_and_parse(client, entity_id, year)

                        if id_sablony is None:
                            skipped += 1
                            continue

                        if id_sablony == 687:
                            ico_687 += 1
                        elif id_sablony == 699:
                            ico_699 += 1
                        else:
                            ico_other += 1
                            continue  # Skip unknown templates

                        if not fields:
                            skipped += 1
                            continue

                        if dry_run:
                            ta = fields.get("totalAssets")
                            ca = fields.get("currentAssets")
                            logger.info(f"[DRY] {ico} {year} sab={id_sablony} TA={ta} CA={ca}")
                            updated += 1
                            ico_updated = True
                            continue

                        # Idempotent UPDATE: only set non-null fields.
                        # Also recompute dataQualityStatus so it never drifts
                        # from the BS fields being written.
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
                            q = f'UPDATE "FinancialStatement" SET {", ".join(sets)} WHERE "companyIco" = ${idx} AND year = ${idx + 1}'
                            async with conn.acquire() as c:
                                await c.execute(q, *params)
                            updated += 1
                            ico_updated = True

                    count_687 += ico_687
                    count_699 += ico_699
                    count_other += ico_other
                    processed_list.append(ico)
                except Exception as e:
                    logger.warning(f"[{ico}] Error: {type(e).__name__}: {e}")
                    skipped += 1
                    processed_list.append(ico)

        for i in range(0, len(todo), batch_size):
            batch = todo[i:i + batch_size]
            logger.info(f"Batch {i // batch_size + 1}/{(len(todo) + batch_size - 1) // batch_size}: {len(batch)} ICOs (updated={updated}, skipped={skipped}, 687={count_687}, 699={count_699})")

            await asyncio.gather(*[process_ico(ico) for ico in batch])

            if not dry_run:
                cp["processed_icos"] = processed_list[-50000:]
                cp["total_updated"] = updated
                cp["total_skipped"] = skipped
                cp["total_687"] = count_687
                cp["total_699"] = count_699
                cp["total_other"] = count_other
                save_checkpoint(cp)

            await asyncio.sleep(0.5)

    conn.terminate()

    logger.info(f"DONE — updated={updated}, skipped={skipped}, 687={count_687}, 699={count_699}, other={count_other}")


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("--concurrency", type=int, default=5)
    parser.add_argument("--max", type=int, default=0)
    parser.add_argument("--resume", action="store_true")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    asyncio.run(main(concurrency=args.concurrency, max_count=args.max, resume=args.resume, dry_run=args.dry_run))
