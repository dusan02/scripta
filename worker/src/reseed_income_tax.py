"""Bulk re-seed incomeTax (riadok 57) for existing FinancialStatements.

Only fetches the income statement table from RÚZ API and updates incomeTax.
Much faster than full re-seed — no balance sheet, no company upsert.

Usage:
    python3 -m src.reseed_income_tax [--concurrency 10] [--max N] [--resume]
"""
import asyncio
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
        except (httpx.TimeoutException, httpx.ConnectError):
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


def extract_tax_from_data(data: list) -> Optional[float]:
    """Extract incomeTax from income table data (riadok 57, offset 1, 2 cols)."""
    if not data or len(data) < 114:
        return None
    start = 56 * 2  # (57 - 1) * 2
    if start + 2 <= len(data):
        return _to_float(data[start])
    return None


async def fetch_tax_for_ico(client: httpx.AsyncClient, ico: str) -> dict[int, float]:
    """Fetch incomeTax values for all years of a company.
    Returns {year: incomeTax}."""
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

    year_tax: dict[int, float] = {}
    seen_years: set[int] = set()

    for zid in zavierka_ids:
        if len(year_tax) >= 5:
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
        tax = extract_tax_from_data(data)
        if tax is not None:
            year_tax[year] = tax

    return year_tax


# ── Main ─────────────────────────────────────────────────────────────────────

async def main(concurrency: int = 10, max_count: int = 0, resume: bool = False):
    from prisma import Prisma
    import db_client

    cp = load_checkpoint() if resume else {"processed_icos": [], "total_updated": 0, "total_skipped": 0}
    processed_set = set(cp.get("processed_icos", []))

    db = Prisma()
    await db.connect()
    db_client._db = db

    # Get ICOs that need incomeTax update — raw SQL for speed
    all_icos: list[str] = []
    rows = await db.query_raw(
        'SELECT DISTINCT "companyIco" FROM "FinancialStatement" WHERE "incomeTax" IS NULL AND "netProfitLoss" IS NOT NULL ORDER BY "companyIco"'
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

    async with httpx.AsyncClient(verify=False) as client:
        async def process_ico(ico: str):
            nonlocal updated, skipped
            async with sem:
                try:
                    year_tax = await fetch_tax_for_ico(client, ico)
                    if not year_tax:
                        skipped += 1
                        processed_list.append(ico)
                        return

                    count = 0
                    for year, tax in year_tax.items():
                        result = await db.execute_raw(
                            'UPDATE "FinancialStatement" SET "incomeTax" = $1 WHERE "companyIco" = $2 AND year = $3 AND "incomeTax" IS NULL',
                            tax, ico, year
                        )
                        count += result

                    if count > 0:
                        updated += count
                    else:
                        skipped += 1

                    processed_list.append(ico)
                except Exception as e:
                    logger.warning(f"[{ico}] Error: {e}")
                    skipped += 1
                    processed_list.append(ico)

        for i in range(0, len(todo), batch_size):
            batch = todo[i:i + batch_size]
            logger.info(f"Batch {i // batch_size + 1}/{(len(todo) + batch_size - 1) // batch_size}: {len(batch)} ICOs (updated={updated}, skipped={skipped})")

            await asyncio.gather(*[process_ico(ico) for ico in batch])

            # Checkpoint
            cp["processed_icos"] = processed_list[-50000:]
            cp["total_updated"] = updated
            cp["total_skipped"] = skipped
            save_checkpoint(cp)

            await asyncio.sleep(0.5)

    await db.disconnect()
    logger.info(f"Done. Updated: {updated}, Skipped: {skipped}, Total processed: {len(processed_list)}")


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("--concurrency", type=int, default=10)
    parser.add_argument("--max", type=int, default=0, help="Max ICOs to process (0 = all)")
    parser.add_argument("--resume", action="store_true")
    args = parser.parse_args()

    asyncio.run(main(concurrency=args.concurrency, max_count=args.max, resume=args.resume))
