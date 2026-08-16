"""
Bulk seed script — downloads IČO list + financial statements from RÚZ API.

Usage:
  python -m src.seed_ruz_bulk                    # Full seed (all entities)
  python -m src.seed_ruz_bulk --max 1000         # First 1000 entities only
  python -m src.seed_ruz_bulk --resume           # Resume from last checkpoint
  python -m src.seed_ruz_bulk --financials       # Also download financial statements

Flow:
  1. Paginate /api/uctovne-jednotky → get all entity IDs
  2. For each entity, GET /api/uctovna-jednotka → get IČO, name, address
  3. Upsert Company record in DB
  4. (Optional) Download & parse financial statements via ruz_parser

Checkpoint: saves last processed ID to seed_checkpoint.json for resume.

Rate limiting: 10 concurrent requests, 100ms delay between batches,
exponential backoff on 429/5xx.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import logging
import os
import sys
import time
from pathlib import Path
from typing import Optional

import httpx

# Add worker src to path for imports
sys.path.insert(0, str(Path(__file__).parent))

from db_client import connect_db, disconnect_db, get_db

logger = logging.getLogger(__name__)

RUZ_API = "https://www.registeruz.sk/cruz-public/api"
UA = "Verifa.sk/1.0 (+https://verifa.sk)"
TIMEOUT = 30.0
MAX_CONCURRENT = 10
BATCH_DELAY = 0.1  # 100ms between pagination calls
CHECKPOINT_FILE = "seed_checkpoint.json"

# Legal form mapping
LF_MAP = {
    "112": "s.r.o.", "121": "a.s.", "113": "v.o.s.", "114": "k.s.",
    "101": "fyzická osoba", "107": "živnostník",
    "115": "európske združenie hospodárskych záujmov",
    "116": "európska spoločnosť", "117": "európske družstvo",
    "118": "družstvo", "119": "štátny podnik", "120": "rozpočtová organizácia",
    "122": "príspevková organizácia", "123": "nezisková organizácia",
    "124": "občianske združenie", "125": "nadácia", "126": "fond",
    "127": "nezisková organizácia poskytujúca všeobecne prospešné služby",
}

OWNERSHIP_MAP = {
    "1": "Súkromné domáce", "2": "Súkromné zahraničné",
    "3": "Zmiešané", "4": "Verejné", "5": "Spoločné",
    "6": "Dánske", "7": "Zahraničné",
}

SIZE_MAP = {
    "10": "Mikro", "11": "Mikro", "20": "Malá", "21": "Malá",
    "22": "Stredná", "23": "Stredná", "30": "Veľká", "31": "Veľká",
    "32": "Veľká", "33": "Veľká",
}


# ── Checkpoint ──────────────────────────────────────────────────────────────

def load_checkpoint() -> dict:
    p = Path(CHECKPOINT_FILE)
    if p.exists():
        return json.loads(p.read_text())
    return {"last_entity_id": 0, "total_processed": 0, "total_companies": 0}


def save_checkpoint(cp: dict) -> None:
    Path(CHECKPOINT_FILE).write_text(json.dumps(cp, indent=2))


# ── RÚZ API helpers ──────────────────────────────────────────────────────────

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
            logger.debug(f"RUZ {resp.status_code} for {endpoint} params={params}")
            return None
        except (httpx.TimeoutException, httpx.ConnectError) as e:
            wait = 2 ** attempt
            logger.warning(f"RUZ error for {endpoint}: {e}, retrying in {wait}s")
            await asyncio.sleep(wait)
    return None


async def get_entity_ids(
    client: httpx.AsyncClient,
    last_id: int = 0,
    max_entities: Optional[int] = None,
) -> tuple[list[int], int]:
    """Paginate through all accounting entities. Returns (entity_ids, last_id)."""
    all_ids: list[int] = []
    current_id = last_id

    while True:
        params = {
            "zmenene-od": "2000-01-01",
            "max-zaznamov": 10000,
        }
        if current_id > 0:
            params["pokracovat-za-id"] = current_id

        data = await ruz_get(client, "uctovne-jednotky", params)
        if not data or "id" not in data or not data["id"]:
            break

        ids = data["id"]
        all_ids.extend(ids)
        current_id = ids[-1]

        logger.info(f"Paginated: +{len(ids)} entities (total: {len(all_ids)}, last_id: {current_id})")

        if max_entities and len(all_ids) >= max_entities:
            all_ids = all_ids[:max_entities]
            break

        await asyncio.sleep(BATCH_DELAY)

    return all_ids, current_id


async def get_entity_details(
    client: httpx.AsyncClient,
    entity_id: int,
) -> Optional[dict]:
    """Get entity details (IČO, name, address, legal form)."""
    return await ruz_get(client, "uctovna-jednotka", {"id": entity_id})


# ── DB upsert ────────────────────────────────────────────────────────────────

async def upsert_company(entity: dict) -> bool:
    """Upsert a Company record from RÚZ entity data. Returns True if IČO present."""
    ico = entity.get("ico")
    if not ico or not ico.strip():
        return False

    ico = ico.strip()

    legal_form = LF_MAP.get(str(entity.get("pravnaForma", "")), entity.get("pravnaForma"))
    ownership = OWNERSHIP_MAP.get(str(entity.get("druhVlastnictva", "")), entity.get("druhVlastnictva"))
    size_cat = SIZE_MAP.get(str(entity.get("velkostOrganizacie", "")), entity.get("velkostOrganizacie"))

    established = entity.get("datumZalozenia")
    established_at = None
    if established:
        try:
            established_at = established  # Prisma accepts ISO date strings
        except Exception:
            pass

    db = get_db()
    await db.company.upsert(
        where={"ico": ico},
        data={
            "create": {
                "ico": ico,
                "name": entity.get("nazovUJ"),
                "legalForm": legal_form,
                "city": entity.get("mesto"),
                "street": entity.get("ulica"),
                "zipCode": str(entity.get("psc")) if entity.get("psc") else None,
                "country": "Slovensko",
                "establishedAt": established_at,
                "status": "active",
                "naceCode": entity.get("skNace"),
                "ownershipType": ownership,
                "sizeCategory": size_cat,
                "employeeCount": entity.get("pocetZamestnancov"),
            },
            "update": {
                "name": entity.get("nazovUJ"),
                "legalForm": legal_form,
                "city": entity.get("mesto"),
                "street": entity.get("ulica"),
                "zipCode": str(entity.get("psc")) if entity.get("psc") else None,
                "country": "Slovensko",
                "establishedAt": established_at,
                "status": "active",
                "naceCode": entity.get("skNace"),
                "ownershipType": ownership,
                "sizeCategory": size_cat,
                "employeeCount": entity.get("pocetZamestnancov"),
            },
        },
    )
    return True


# ── Financial statement download ─────────────────────────────────────────────

# Row indices (cisloRiadku from RÚZ template 699)
# Aktív: data_index = cisloRiadku - 1
# Pasív: data_index = cisloRiadku - 79
# Income: data_index = cisloRiadku - 1


def _to_float(val) -> Optional[float]:
    if val is None or val == "" or val == " ":
        return None
    if isinstance(val, bool):
        return None
    if isinstance(val, (int, float)):
        return float(val)
    if isinstance(val, str):
        import re
        cleaned = re.sub(r'[\s\xa0]', '', val.strip())
        if not cleaned:
            return None
        is_neg = False
        if cleaned.startswith('(') and cleaned.endswith(')'):
            is_neg = True
            cleaned = cleaned[1:-1]
        if ',' in cleaned and '.' in cleaned:
            last_comma = cleaned.rfind(',')
            last_dot = cleaned.rfind('.')
            if last_comma > last_dot:
                cleaned = cleaned.replace('.', '').replace(',', '.')
            else:
                cleaned = cleaned.replace(',', '')
        elif ',' in cleaned:
            cleaned = cleaned.replace(',', '.')
        try:
            result = float(cleaned) if cleaned else None
            if result is not None and is_neg:
                result = -result
            return result
        except ValueError:
            return None
    return None


def _extract_row(row, data_cols: int, target_col: int) -> Optional[float]:
    if row is None or not isinstance(row, list):
        return None
    if len(row) == data_cols:
        data_start = 0
    elif len(row) > data_cols:
        data_start = len(row) - data_cols
    else:
        return None
    idx = data_start + target_col
    if 0 <= idx < len(row):
        return _to_float(row[idx])
    return None


def _get_row(tables: list, table_idx: int, cislo_riadku: int, offset: int, data_cols: int = 0) -> Optional[list]:
    if table_idx >= len(tables):
        return None
    data = tables[table_idx].get("data", [])
    idx = cislo_riadku - offset
    if not data or idx < 0:
        return None
    first = data[0]
    if not isinstance(first, list) and data_cols > 0:
        start = idx * data_cols
        if start + data_cols <= len(data):
            return data[start: start + data_cols]
        return None
    if idx < len(data):
        return data[idx]
    return None


def _activ_val(tables: list, cislo: int, current: bool = True) -> Optional[float]:
    row = _get_row(tables, 0, cislo, 1, data_cols=4)
    return _extract_row(row, 4, 2 if current else 3) if row else None


def _pasiv_val(tables: list, cislo: int, current: bool = True) -> Optional[float]:
    row = _get_row(tables, 1, cislo, 79, data_cols=2)
    return _extract_row(row, 2, 0 if current else 1) if row else None


def _income_val(tables: list, cislo: int, current: bool = True) -> Optional[float]:
    row = _get_row(tables, 2, cislo, 1, data_cols=2)
    return _extract_row(row, 2, 0 if current else 1) if row else None


def _identify_tables(tables: list) -> dict:
    result = {}
    for i, tab in enumerate(tables):
        nazov = tab.get("nazov", {}).get("sk", "").lower()
        if "strana akt" in nazov or "aktív" in nazov or ("akt" in nazov and "pas" not in nazov):
            result["aktiv"] = i
        elif "strana pas" in nazov or "pasív" in nazov or "pas" in nazov:
            result["pasiv"] = i
        elif "ziskov a str" in nazov or "profit and loss" in nazov or "výsledovka" in nazov:
            result["income"] = i
    return result


async def download_financials(
    client: httpx.AsyncClient,
    ico: str,
    entity: dict,
) -> int:
    """Download financial statements for a company from RÚZ API.
    Returns number of statements upserted."""
    zavierka_ids: list[int] = entity.get("idUctovnychZavierok", [])
    if not zavierka_ids:
        return 0

    # Sort závierky by obdobieDo descending (newest first)
    zavierky = []
    for zid in zavierka_ids:
        z = await ruz_get(client, "uctovna-zavierka", {"id": zid})
        if z:
            zavierky.append(z)
    zavierky.sort(key=lambda z: z.get("obdobieDo", ""), reverse=True)

    stmts = []
    seen_years: set[int] = set()

    for z in zavierky:
        if len(stmts) >= 5:
            break
        import re
        year_match = re.search(r'20\d{2}', str(z.get("obdobieDo", "")))
        if not year_match:
            continue
        year = int(year_match.group())
        if year in seen_years:
            continue
        seen_years.add(year)

        # Fetch all výkazy for this závierka
        all_tables: list = []
        for vid in z.get("idUctovnychVykazov", []):
            v = await ruz_get(client, "uctovny-vykaz", {"id": vid})
            if v and v.get("obsah", {}).get("tabulky"):
                all_tables.extend(v["obsah"]["tabulky"])
        if not all_tables:
            continue

        tm = _identify_tables(all_tables)
        if "aktiv" not in tm or "pasiv" not in tm:
            continue

        ordered = [all_tables[tm["aktiv"]], all_tables[tm["pasiv"]]]
        if "income" in tm:
            ordered.append(all_tables[tm["income"]])
        has_income = len(ordered) > 2

        # Extract key metrics
        zasoby_prev = _activ_val(ordered, 34, False)
        pohladavky_prev = _activ_val(ordered, 54, False)
        zavazky_prev = _pasiv_val(ordered, 123, False)

        zasoby = _activ_val(ordered, 34)
        pohladavky = _activ_val(ordered, 54)
        zavazky_obchod = _pasiv_val(ordered, 123)
        zisk = _income_val(ordered, 61) if has_income else None
        odpisy = _income_val(ordered, 21) if has_income else None
        trzby = _income_val(ordered, 1) if has_income else None
        cogs = _income_val(ordered, 10) if has_income else None

        # Operating cash flow estimate
        ocf = None
        if zisk is not None and odpisy is not None:
            ocf = zisk + odpisy
            if zasoby is not None and zasoby_prev is not None:
                ocf -= zasoby - zasoby_prev
            if pohladavky is not None and pohladavky_prev is not None:
                ocf -= pohladavky - pohladavky_prev
            if zavazky_obchod is not None and zavazky_prev is not None:
                ocf += zavazky_obchod - zavazky_prev

        # Gross profit
        hruba_marza = None
        if trzby is not None and cogs is not None:
            hruba_marza = trzby - cogs
        if hruba_marza is None and has_income:
            hruba_marza = _income_val(ordered, 28)

        stmts.append({
            "year": year,
            "totalAssets": _activ_val(ordered, 1),
            "currentAssets": _activ_val(ordered, 33),
            "equity": _pasiv_val(ordered, 80),
            "shortTermLiabilities": _pasiv_val(ordered, 122),
            "longTermLiabilities": _pasiv_val(ordered, 102),
            "mainActivityRevenue": trzby,
            "grossProfit": hruba_marza,
            "netProfitLoss": zisk,
            "cashAndEquivalents": _activ_val(ordered, 72),
            "operatingCashFlow": ocf,
            "staffCosts": _income_val(ordered, 15) if has_income else None,
            "tradeReceivables": pohladavky,
            "tradePayables": zavazky_obchod,
            "inventory": zasoby,
            "depreciation": odpisy,
            "interestExpense": _income_val(ordered, 49) if has_income else None,
            "incomeTax": _income_val(ordered, 57) if has_income else None,
            "profitBeforeTax": _income_val(ordered, 56) if has_income else None,
            "operatingCosts": cogs,
            "socialInsuranceLiabilities": _pasiv_val(ordered, 132),
            "taxLiabilities": _pasiv_val(ordered, 133),
            "employeeLiabilities": _pasiv_val(ordered, 131),
            "statementType": "SK_GAAP",
            "monthsInPeriod": 12,
            "isConsolidated": False,
        })

    if not stmts:
        return 0

    # Upsert financial statements
    db = get_db()
    count = 0
    for s in stmts:
        await db.financialstatement.upsert(
            where={"companyIco_year": {"companyIco": ico, "year": s["year"]}},
            data={
                "create": {"companyIco": ico, **s},
                "update": {
                    "totalAssets": s["totalAssets"],
                    "currentAssets": s["currentAssets"],
                    "equity": s["equity"],
                    "shortTermLiabilities": s["shortTermLiabilities"],
                    "longTermLiabilities": s["longTermLiabilities"],
                    "mainActivityRevenue": s["mainActivityRevenue"],
                    "grossProfit": s["grossProfit"],
                    "netProfitLoss": s["netProfitLoss"],
                    "cashAndEquivalents": s["cashAndEquivalents"],
                    "operatingCashFlow": s["operatingCashFlow"],
                    "staffCosts": s["staffCosts"],
                    "tradeReceivables": s["tradeReceivables"],
                    "tradePayables": s["tradePayables"],
                    "inventory": s["inventory"],
                    "depreciation": s["depreciation"],
                    "interestExpense": s["interestExpense"],
                    "incomeTax": s["incomeTax"],
                    "profitBeforeTax": s["profitBeforeTax"],
                    "operatingCosts": s["operatingCosts"],
                    "socialInsuranceLiabilities": s["socialInsuranceLiabilities"],
                    "taxLiabilities": s["taxLiabilities"],
                    "employeeLiabilities": s["employeeLiabilities"],
                },
            },
        )
        count += 1

    # Update Company with latest year/revenue
    latest = stmts[0]
    await db.company.update(
        where={"ico": ico},
        data={
            "latestYear": latest["year"],
            "latestRevenue": latest["mainActivityRevenue"],
            "latestProfit": latest["netProfitLoss"],
            "latestAssets": latest["totalAssets"],
            "latestEquity": latest["equity"],
        },
    )

    return count


# ── Main seed loop ───────────────────────────────────────────────────────────

async def process_batch(
    client: httpx.AsyncClient,
    entity_ids: list[int],
    cp: dict,
    do_financials: bool,
) -> int:
    """Process a batch of entity IDs. Returns count of companies upserted."""
    sem = asyncio.Semaphore(MAX_CONCURRENT)
    upserted = 0
    financials_count = 0

    async def process_one(eid: int):
        nonlocal upserted, financials_count
        async with sem:
            entity = await get_entity_details(client, eid)
            if not entity:
                return

            ok = await upsert_company(entity)
            if ok:
                upserted += 1

                if do_financials:
                    ico = entity.get("ico", "").strip()
                    n = await download_financials(client, ico, entity)
                    financials_count += n

    await asyncio.gather(*[process_one(eid) for eid in entity_ids])

    if do_financials and financials_count > 0:
        logger.info(f"  Financial statements upserted: {financials_count}")

    return upserted


async def main(args: argparse.Namespace):
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(message)s",
        handlers=[logging.StreamHandler()],
    )

    await connect_db()
    logger.info("DB connected, starting RÚZ bulk seed...")

    cp = load_checkpoint() if args.resume else {"last_entity_id": 0, "total_processed": 0, "total_companies": 0}
    logger.info(f"Checkpoint: last_id={cp['last_entity_id']}, processed={cp['total_processed']}, companies={cp['total_companies']}")

    limits = httpx.Limits(max_connections=MAX_CONCURRENT, max_keepalive_connections=MAX_CONCURRENT)

    async with httpx.AsyncClient(limits=limits) as client:
        # Phase 1: Get entity IDs
        logger.info("Phase 1: Fetching entity IDs from RÚZ API...")
        entity_ids, last_id = await get_entity_ids(
            client,
            last_id=cp["last_entity_id"],
            max_entities=args.max,
        )
        logger.info(f"Got {len(entity_ids)} entity IDs to process (last_id={last_id})")

        # Phase 2: Process in batches of 100
        BATCH_SIZE = 100
        total = len(entity_ids)

        for i in range(0, total, BATCH_SIZE):
            batch = entity_ids[i:i + BATCH_SIZE]
            upserted = await process_batch(client, batch, cp, args.financials)

            cp["total_processed"] += len(batch)
            cp["total_companies"] += upserted
            cp["last_entity_id"] = batch[-1]
            save_checkpoint(cp)

            elapsed = time.perf_counter()
            rate = cp["total_processed"] / max(elapsed, 1)
            logger.info(
                f"Progress: {cp['total_processed']}/{total} "
                f"({cp['total_processed']/total*100:.1f}%) "
                f"companies={cp['total_companies']} "
                f"rate={rate:.0f}/s "
                f"last_id={cp['last_entity_id']}"
            )

            await asyncio.sleep(BATCH_DELAY)

    logger.info(f"Seed complete! Processed {cp['total_processed']} entities, upserted {cp['total_companies']} companies.")
    await disconnect_db()


async def run_financials_only(args: argparse.Namespace):
    """Download financial statements for companies already in DB, sorted by priority.

    Priority: large companies first (more employees = higher SEO value).
    Skips companies that already have financial statements.
    """
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(message)s",
        handlers=[logging.StreamHandler()],
    )

    await connect_db()
    db = get_db()

    # Find companies without financial statements, sorted by employee count DESC
    where_clause = {"financialStatements": {"none": {}}}
    if args.ico:
        where_clause["ico"] = {"in": args.ico.split(",")}

    companies = await db.company.find_many(
        where=where_clause,
        select={"ico": True, "name": True, "employeeCount": True, "sizeCategory": True, "city": True},
        order={"employeeCount": "desc", "ico": "asc"},
        take=args.max or 10000,
    )
    logger.info(f"Found {len(companies)} companies without financials (sorted by employee count DESC)")

    if not companies:
        logger.info("Nothing to do — all companies already have financial statements.")
        await disconnect_db()
        return

    limits = httpx.Limits(max_connections=MAX_CONCURRENT, max_keepalive_connections=MAX_CONCURRENT)
    sem = asyncio.Semaphore(MAX_CONCURRENT)
    total_stmts = 0
    total_companies = 0
    failed = 0

    async with httpx.AsyncClient(limits=limits) as client:
        async def process_one(idx: int, ico: str, name: str | None):
            nonlocal total_stmts, total_companies, failed
            async with sem:
                # Get entity details from RÚZ (need idUctovnychZavierok)
                eids = await ruz_get(client, "uctovne-jednotky", {
                    "zmenene-od": "2000-01-01", "ico": ico, "max-zaznamov": 10,
                })
                if not eids or not eids.get("id"):
                    failed += 1
                    return

                entity = await ruz_get(client, "uctovna-jednotka", {"id": eids["id"][0]})
                if not entity:
                    failed += 1
                    return

                n = await download_financials(client, ico, entity)
                if n > 0:
                    total_stmts += n
                    total_companies += 1
                    logger.info(f"[{idx+1}/{len(companies)}] {name or ico}: {n} statements")
                else:
                    failed += 1
                    logger.debug(f"[{idx+1}/{len(companies)}] {name or ico}: no statements")

        tasks = [process_one(i, c.ico, c.name) for i, c in enumerate(companies)]
        await asyncio.gather(*tasks)

    logger.info(
        f"Financials complete! "
        f"Companies: {total_companies}/{len(companies)} "
        f"Statements: {total_stmts} "
        f"Failed: {failed}"
    )
    await disconnect_db()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Bulk seed companies from RÚZ API")
    parser.add_argument("--max", type=int, default=None, help="Max entities to process")
    parser.add_argument("--resume", action="store_true", help="Resume from last checkpoint")
    parser.add_argument("--financials", action="store_true", help="Also download financial statements (slower)")
    parser.add_argument("--financials-only", action="store_true", help="Only download financials for companies already in DB (sorted by priority)")
    parser.add_argument("--ico", type=str, default=None, help="Comma-separated IČO list (for --financials-only)")
    args = parser.parse_args()

    if args.financials_only:
        asyncio.run(run_financials_only(args))
    else:
        asyncio.run(main(args))
