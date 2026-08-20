"""Bulk re-seed incomeTax (riadok 57) for existing FinancialStatements.

Uses the canonical ruz_parser.py for extraction — handles both standard (699)
and micro-firm (687) income statement formats correctly.

Only fetches the income statement table from RÚZ API and updates incomeTax,
profitBeforeTax, operatingCosts. Much faster than full re-seed — no balance
sheet, no company upsert.

Usage:
    python3 -m src.reseed_income_tax [--concurrency 10] [--max N] [--resume] [--dry-run]
"""
import asyncio
import asyncpg
import httpx
import json
import logging
import re
import sys
from pathlib import Path
from typing import Optional

from src.ruz_parser import parse_zavierka_to_metrics

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger(__name__)

RUZ_API = "https://www.registeruz.sk/cruz-public/api"
UA = "Verifa.sk/1.0 (+https://verifa.sk)"
TIMEOUT = 30.0
CHECKPOINT_FILE = Path("output/income_tax_checkpoint.json")


# ── Checkpoint ──────────────────────────────────────────────────────────────

def load_checkpoint() -> dict:
    if CHECKPOINT_FILE.exists():
        return json.loads(CHECKPOINT_FILE.read_text())
    return {"processed_icos": [], "total_updated": 0, "total_skipped": 0}

def save_checkpoint(cp: dict) -> None:
    CHECKPOINT_FILE.parent.mkdir(parents=True, exist_ok=True)
    CHECKPOINT_FILE.write_text(json.dumps(cp, indent=2))


# ── RÚZ API ──────────────────────────────────────────────────────────────────

async def ruz_get(client: httpx.AsyncClient, endpoint: str, params: dict, max_retries: int = 3) -> Optional[dict]:
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
                # RÚZ WAF blocks ico-based lookups — log once per endpoint
                logger.warning(f"[RUZ_API] 403 Forbidden: {endpoint} params={params}")
                return None
            logger.warning(f"[RUZ_API] HTTP {resp.status_code}: {endpoint} params={params}")
            return None
        except (httpx.TimeoutException, httpx.ConnectError, httpx.ReadError):
            await asyncio.sleep(2 ** attempt)
    return None


# ── Field extraction via canonical ruz_parser ────────────────────────────────

async def fetch_fields_for_ico(client: httpx.AsyncClient, ico: str, target_years: set[int] | None = None, entity_id: int | None = None) -> dict[int, dict]:
    """Fetch incomeTax, profitBeforeTax, operatingCosts for years of a company.
    Uses canonical ruz_parser.parse_zavierka_to_metrics() for correct micro/standard handling.
    If target_years is provided, only fetches zavierky for those years (optimization).
    If entity_id is provided, skips the ico→entity_id lookup (which is 403-blocked by RÚZ WAF).
    Returns {year: {incomeTax: float, profitBeforeTax: float, operatingCosts: float}}."""
    if entity_id is None:
        # Fallback: ico→entity_id lookup (may be 403-blocked by RÚZ WAF)
        r = await ruz_get(client, "uctovne-jednotky", {"ico": ico, "zmenene-od": "2000-01-01"})
        if not r or not r.get("id"):
            return {}
        entity_id = r["id"][0]

    entity = await ruz_get(client, "uctovna-jednotka", {"id": entity_id})
    if not entity:
        return {}

    zavierka_ids = entity.get("idUctovnychZavierok", [])
    if not zavierka_ids:
        return {}

    year_fields: dict[int, dict] = {}
    seen_years: set[int] = set()

    for zid in zavierka_ids:
        # If we have target years, stop once we've covered them all
        if target_years is not None and year_fields.keys() >= target_years:
            break

        z = await ruz_get(client, "uctovna-zavierka", {"id": zid})
        if not z:
            continue

        year_match = re.search(r'20\d{2}', str(z.get("obdobieDo", "")))
        if not year_match:
            continue
        year = int(year_match.group())
        if year in seen_years:
            continue
        # Skip years not in target set (optimization — avoid unnecessary výkaz fetches)
        if target_years is not None and year not in target_years:
            seen_years.add(year)
            continue
        seen_years.add(year)

        # Fetch all výkazy for this závierka
        vykazy = []
        for vid in z.get("idUctovnychVykazov", []):
            v = await ruz_get(client, "uctovny-vykaz", {"id": vid})
            if v:
                vykazy.append(v)

        if not vykazy:
            continue

        # Use canonical parser — handles micro (687) and standard (699) formats
        metrics = parse_zavierka_to_metrics(vykazy, ico)
        if metrics is None:
            continue

        fields = {}
        if metrics.dan_z_prijmu is not None:
            fields["incomeTax"] = metrics.dan_z_prijmu
        if metrics.zisk_pred_zdanenim is not None:
            fields["profitBeforeTax"] = metrics.zisk_pred_zdanenim
        if metrics.naklady_na_hosp_cinnost is not None:
            fields["operatingCosts"] = metrics.naklady_na_hosp_cinnost

        if fields:
            year_fields[year] = fields

    return year_fields


# ── Main ─────────────────────────────────────────────────────────────────────

import os
DB_DSN = os.environ.get("DATABASE_URL", "postgresql://verifa:verifa@postgres:5432/verifa")


async def main(concurrency: int = 3, max_count: int = 0, resume: bool = False, dry_run: bool = False):
    cp = load_checkpoint() if resume else {"processed_icos": [], "total_updated": 0, "total_skipped": 0}
    processed_set = set(cp.get("processed_icos", []))

    conn = await asyncpg.create_pool(DB_DSN, min_size=1, max_size=concurrency + 1)

    # Get ICOs + target years + ruzEntityId that need incomeTax/PBT/operatingCosts update.
    # ruzEntityId allows us to skip the ico→entity_id lookup (403-blocked by RÚZ WAF).
    async with conn.acquire() as c:
        rows = await c.fetch(
            'SELECT fs."companyIco", fs.year, c."ruzEntityId" '
            'FROM "FinancialStatement" fs '
            'JOIN "Company" c ON c.ico = fs."companyIco" '
            'WHERE (fs."incomeTax" IS NULL OR fs."profitBeforeTax" IS NULL OR fs."operatingCosts" IS NULL) '
            'AND fs."netProfitLoss" IS NOT NULL '
            'AND fs."companyIco" IS NOT NULL '
            'AND fs."companyIco" != $1 AND fs."companyIco" != $2 '
            'ORDER BY fs."companyIco"',
            '', '00000000'
        )
    # Group: {ico: {years: set, entity_id: int|None}}
    ico_data: dict[str, dict] = {}
    for r in rows:
        ico = r["companyIco"]
        if ico not in ico_data:
            ico_data[ico] = {"years": set(), "entity_id": r["ruzEntityId"]}
        ico_data[ico]["years"].add(r["year"])
    all_icos = list(ico_data.keys())

    logger.info(f"Total ICOs needing reseed: {len(all_icos)}")
    if dry_run:
        logger.info("DRY RUN MODE — no DB writes")

    # Filter already processed
    todo = [ico for ico in all_icos if ico not in processed_set]
    if max_count > 0:
        todo = todo[:max_count]
    logger.info(f"To process: {len(todo)} (already done: {len(processed_set)})")

    sem = asyncio.Semaphore(concurrency)
    batch_size = 100
    updated = cp.get("total_updated", 0)
    skipped = cp.get("total_skipped", 0)
    processed_list = list(processed_set)

    # Dry-run stats
    dry_uplifts = {"incomeTax": 0, "profitBeforeTax": 0, "operatingCosts": 0}
    dry_no_change = 0
    dry_total_fs = 0

    async with httpx.AsyncClient(verify=False, limits=httpx.Limits(max_connections=concurrency, max_keepalive_connections=concurrency)) as client:
        async def process_ico(ico: str):
            nonlocal updated, skipped, dry_no_change, dry_total_fs
            async with sem:
                await asyncio.sleep(0.3)  # rate limit RÚZ API
                try:
                    data = ico_data.get(ico, {})
                    target_years = data.get("years", set())
                    entity_id = data.get("entity_id")
                    year_fields = await fetch_fields_for_ico(client, ico, target_years=target_years, entity_id=entity_id)
                    if not year_fields:
                        skipped += 1
                        processed_list.append(ico)
                        if dry_run:
                            dry_no_change += 1
                        return

                    if dry_run:
                        # Dry-run: just count uplifts, no DB writes
                        for year, fields in year_fields.items():
                            dry_total_fs += 1
                            for f in ["incomeTax", "profitBeforeTax", "operatingCosts"]:
                                if fields.get(f) is not None:
                                    dry_uplifts[f] += 1
                        logger.info(f"[DRY] {ico}: {len(year_fields)} years — {year_fields}")
                    else:
                        count = 0
                        async with conn.acquire() as c:
                            for year, fields in year_fields.items():
                                # Build SET clause using COALESCE — only overwrites NULL fields.
                                # This avoids the bug where WHERE required ALL fields to be NULL
                                # simultaneously (if PBT was set but incomeTax was NULL, no update happened).
                                set_parts = []
                                params = []
                                for field_name in ["incomeTax", "profitBeforeTax", "operatingCosts"]:
                                    val = fields.get(field_name)
                                    if val is not None:
                                        set_parts.append(f'"{field_name}" = COALESCE("{field_name}", ${len(params) + 1})')
                                        params.append(val)
                                if not set_parts:
                                    continue
                                # WHERE: match by ICO + year only — COALESCE handles NULL guard
                                params.append(ico)
                                params.append(year)
                                where_sql = f'"companyIco" = ${len(params) - 1} AND year = ${len(params)}'
                                sql = f'UPDATE "FinancialStatement" SET {", ".join(set_parts)} WHERE {where_sql}'
                                result = await c.execute(sql, *params)
                                count += int(result.split()[-1]) if result else 0
                                logger.info(f"[{ico}] year={year} fields={fields} rows_updated={result}")

                        if count > 0:
                            updated += count
                        else:
                            skipped += 1

                    processed_list.append(ico)
                except Exception as e:
                    logger.warning(f"[{ico}] Error: {type(e).__name__}: {e}")
                    skipped += 1
                    processed_list.append(ico)

        for i in range(0, len(todo), batch_size):
            batch = todo[i:i + batch_size]
            logger.info(f"Batch {i // batch_size + 1}/{(len(todo) + batch_size - 1) // batch_size}: {len(batch)} ICOs (updated={updated}, skipped={skipped}) first={batch[0] if batch else 'N/A'}")

            await asyncio.gather(*[process_ico(ico) for ico in batch])

            # Checkpoint (skip in dry-run)
            if not dry_run:
                cp["processed_icos"] = processed_list[-50000:]
                cp["total_updated"] = updated
                cp["total_skipped"] = skipped
                save_checkpoint(cp)

            await asyncio.sleep(0.5)

    conn.terminate()

    if dry_run:
        logger.info(f"DRY RUN COMPLETE — {len(processed_list)} ICOs processed")
        logger.info(f"  FS with fields fetched:    {dry_total_fs}")
        logger.info(f"  incomeTax uplifts:          {dry_uplifts['incomeTax']}")
        logger.info(f"  profitBeforeTax uplifts:    {dry_uplifts['profitBeforeTax']}")
        logger.info(f"  operatingCosts uplifts:     {dry_uplifts['operatingCosts']}")
        logger.info(f"  ICOs with no data:          {dry_no_change}")
    else:
        logger.info(f"Done. Updated: {updated}, Skipped: {skipped}, Total processed: {len(processed_list)}")


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("--concurrency", type=int, default=3)
    parser.add_argument("--max", type=int, default=0, help="Max ICOs to process (0 = all)")
    parser.add_argument("--resume", action="store_true")
    parser.add_argument("--dry-run", action="store_true", help="Fetch from RÚZ but don't write to DB")
    args = parser.parse_args()

    asyncio.run(main(concurrency=args.concurrency, max_count=args.max, resume=args.resume, dry_run=args.dry_run))
