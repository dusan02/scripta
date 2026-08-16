"""Bulk re-seed incomeTax (riadok 57) for existing FinancialStatements.

Only fetches the income statement table from RÚZ API and updates incomeTax.
Much faster than full re-seed — no balance sheet, no company upsert.

Usage:
    python3 -m src.reseed_income_tax [--concurrency 10] [--max N] [--resume]
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
            return None
        except (httpx.TimeoutException, httpx.ConnectError, httpx.ReadError):
            await asyncio.sleep(2 ** attempt)
    return None


# ── Income tax extraction ────────────────────────────────────────────────────

def _identify_income_table(tables: list) -> int:
    for i, tab in enumerate(tables):
        nazov = tab.get("nazov", {}).get("sk", "").lower()
        if "zisk" in nazov or "profit" in nazov or "vysledovka" in nazov:
            return i
    return -1


def _to_float(val) -> Optional[float]:
    if val is None or val == "" or val == " ":
        return None
    if isinstance(val, bool):
        return None
    if isinstance(val, (int, float)):
        return float(val)
    if isinstance(val, str):
        cleaned = re.sub(r'[\s\xa0]', '', val.strip())
        if not cleaned:
            return None
        is_neg = False
        if cleaned.startswith('(') and cleaned.endswith(')'):
            is_neg = True
            cleaned = cleaned[1:-1]
        cleaned = cleaned.replace(',', '.')
        try:
            result = float(cleaned)
            return -result if is_neg else result
        except ValueError:
            return None
    return None


def extract_fields_from_data(data: list) -> dict:
    """Extract incomeTax (r.57), profitBeforeTax (r.56), operatingCosts/COGS (r.10) from income table.
    Stride=2, offset=1: start = (row - 1) * 2, current = data[start]."""
    result = {}
    if not data:
        return result
    # incomeTax: row 57, idx = 56*2 = 112
    if len(data) >= 114:
        result["incomeTax"] = _to_float(data[112])
    # profitBeforeTax: row 56, idx = 55*2 = 110
    if len(data) >= 112:
        result["profitBeforeTax"] = _to_float(data[110])
    # operatingCosts (COGS): row 10, idx = 9*2 = 18
    if len(data) >= 20:
        result["operatingCosts"] = _to_float(data[18])
    return result


async def fetch_fields_for_ico(client: httpx.AsyncClient, ico: str) -> dict[int, dict]:
    """Fetch incomeTax, profitBeforeTax, operatingCosts for all years of a company.
    Returns {year: {incomeTax: float, profitBeforeTax: float, operatingCosts: float}}."""
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
        if len(year_fields) >= 5:
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
        seen_years.add(year)

        all_tables = []
        for vid in z.get("idUctovnychVykazov", []):
            v = await ruz_get(client, "uctovny-vykaz", {"id": vid})
            if v and v.get("obsah", {}).get("tabulky"):
                all_tables.extend(v["obsah"]["tabulky"])

        if not all_tables:
            continue

        income_idx = _identify_income_table(all_tables)
        if income_idx < 0:
            continue

        data = all_tables[income_idx].get("data", [])
        fields = extract_fields_from_data(data)
        if fields:
            year_fields[year] = fields

    return year_fields


# ── Main ─────────────────────────────────────────────────────────────────────

DB_DSN = "postgresql://verifa:verifa@postgres:5432/verifa"


async def main(concurrency: int = 3, max_count: int = 0, resume: bool = False):
    cp = load_checkpoint() if resume else {"processed_icos": [], "total_updated": 0, "total_skipped": 0}
    processed_set = set(cp.get("processed_icos", []))

    conn = await asyncpg.connect(DB_DSN)

    # Get ICOs that need any of: incomeTax, profitBeforeTax, operatingCosts update
    rows = await conn.fetch(
        'SELECT DISTINCT "companyIco" FROM "FinancialStatement" WHERE ("incomeTax" IS NULL OR "profitBeforeTax" IS NULL OR "operatingCosts" IS NULL) AND "netProfitLoss" IS NOT NULL AND "companyIco" IS NOT NULL AND "companyIco" != $1 AND "companyIco" != $2 ORDER BY "companyIco"',
        '', '00000000'
    )
    all_icos = [r["companyIco"] for r in rows]

    logger.info(f"Total ICOs needing incomeTax update: {len(all_icos)}")

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

    async with httpx.AsyncClient(verify=False, limits=httpx.Limits(max_connections=concurrency, max_keepalive_connections=concurrency)) as client:
        async def process_ico(ico: str):
            nonlocal updated, skipped
            async with sem:
                await asyncio.sleep(0.3)  # rate limit RÚZ API
                try:
                    year_fields = await fetch_fields_for_ico(client, ico)
                    if not year_fields:
                        skipped += 1
                        processed_list.append(ico)
                        return

                    count = 0
                    for year, fields in year_fields.items():
                        # Build SET clause for non-null fields only
                        set_parts = []
                        params = []
                        for field_name in ["incomeTax", "profitBeforeTax", "operatingCosts"]:
                            val = fields.get(field_name)
                            if val is not None:
                                set_parts.append(f'"{field_name}" = ${len(params) + 1}')
                                params.append(val)
                        if not set_parts:
                            continue
                        # Add WHERE params
                        params.append(ico)
                        params.append(year)
                        where_ico = f'"companyIco" = ${len(params) - 1}'
                        where_year = f'year = ${len(params)}'
                        # Only update fields that are currently NULL
                        null_checks = [f'"{f}" IS NULL' for f in ["incomeTax", "profitBeforeTax", "operatingCosts"] if fields.get(f) is not None]
                        where_sql = ' AND '.join([where_ico, where_year] + null_checks)
                        sql = f'UPDATE "FinancialStatement" SET {", ".join(set_parts)} WHERE {where_sql}'
                        result = await conn.execute(sql, *params)
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

            # Checkpoint
            cp["processed_icos"] = processed_list[-50000:]
            cp["total_updated"] = updated
            cp["total_skipped"] = skipped
            save_checkpoint(cp)

            await asyncio.sleep(0.5)

    await conn.close()
    logger.info(f"Done. Updated: {updated}, Skipped: {skipped}, Total processed: {len(processed_list)}")


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("--concurrency", type=int, default=3)
    parser.add_argument("--max", type=int, default=0, help="Max ICOs to process (0 = all)")
    parser.add_argument("--resume", action="store_true")
    args = parser.parse_args()

    asyncio.run(main(concurrency=args.concurrency, max_count=args.max, resume=args.resume))
