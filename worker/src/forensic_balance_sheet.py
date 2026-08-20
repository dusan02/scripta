#!/usr/bin/env python3
"""Forensic audit: balance-sheet parser bug investigation.

Downloads raw RÚZ JSON for sample ICOs and compares:
1. Table structure (names, pocetDatovychStlpcov, data format)
2. Raw data values for totalAssets (row 1) vs equity (row 80)
3. Parser output vs raw data

Usage: python3 forensic_balance_sheet.py
"""
import asyncio
import httpx
import json
import logging
import sys
from pathlib import Path

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger(__name__)

RUZ_API = "https://www.registeruz.sk/cruz-public/api"
UA = "Verifa.sk/1.0 (+https://verifa.sk)"
TIMEOUT = 30.0

# Sample ICOs with totalAssets NULL + equity NOT NULL
SAMPLE_ICOS = [
    ("00002216", 3581),    # Východoslovenské strojárne a.s.
    ("00008486", 16350),   # Kábelovňa Bratisllava, a.s. v likvidácii
    ("00151017", 13899),   # Agrostav
    ("00153273", 23281),   # OZETA odevné závody a.s.
    ("00188034", 25365),   # PIENSTAV a.s.
    ("00584550", 1823),    # I.S. SYSTÉM spol. s r.o.
    ("00584762", 7142),    # SLOWBAU, spol. s r.o.
    ("00585581", 14120),   # TRAKOS, a.s.
    ("00587231", 11437),   # TOPbit, spol. s r.o.
    ("00591912", 7631),    # SAE - Control a.s.
    ("52574997", None),    # Okta s.r.o. (the original case)
]


async def ruz_get(client, endpoint, params):
    url = f"{RUZ_API}/{endpoint}"
    for attempt in range(3):
        try:
            resp = await client.get(url, params=params, headers={"User-Agent": UA}, timeout=TIMEOUT)
            if resp.status_code == 200:
                return resp.json()
            logger.warning(f"HTTP {resp.status_code}: {endpoint} params={params}")
            return None
        except Exception as e:
            logger.warning(f"Error: {endpoint}: {type(e).__name__}: {e}")
            await asyncio.sleep(2 ** attempt)
    return None


async def audit_ico(client, ico, entity_id):
    """Audit one ICO: download raw RÚZ data and analyze table structure."""
    print(f"\n{'='*80}")
    print(f"AUDIT: {ico} (entity_id={entity_id})")
    print(f"{'='*80}")

    # If no entity_id, try ico lookup (may 403)
    if entity_id is None:
        r = await ruz_get(client, "uctovne-jednotky", {"ico": ico, "zmenene-od": "2000-01-01"})
        if not r or not r.get("id"):
            print(f"  Cannot lookup entity for {ico}")
            return
        entity_id = r["id"][0]

    entity = await ruz_get(client, "uctovna-jednotka", {"id": entity_id})
    if not entity:
        print(f"  Cannot get entity details for {entity_id}")
        return

    zavierka_ids = entity.get("idUctovnychZavierok", [])
    print(f"  Zavierky: {len(zavierka_ids)}")

    for zid in zavierka_ids[:5]:  # check up to 5 zavierky
        z = await ruz_get(client, "uctovna-zavierka", {"id": zid})
        if not z:
            continue

        rok = z.get("obdobieDo", "")[:4]
        vids = z.get("idUctovnychVykazov", [])
        print(f"\n  Rok {rok}: {len(vids)} vykazov")

        all_tables = []
        for vid in vids:
            v = await ruz_get(client, "uctovny-vykaz", {"id": vid})
            if v and v.get("obsah", {}).get("tabulky"):
                tables = v["obsah"]["tabulky"]
                all_tables.extend(tables)
                id_sablony = v.get("idSablony")
                print(f"    Vykaz {vid}: idSablony={id_sablony}, {len(tables)} tables")

        if not all_tables:
            print(f"    NO TABLES")
            continue

        # Analyze each table
        for i, tab in enumerate(all_tables):
            nazov = tab.get("nazov", {}).get("sk", "?")
            pocet_stlpcov = tab.get("pocetDatovychStlpcov", "?")
            data = tab.get("data", [])

            # Determine data format
            if not data:
                data_format = "EMPTY"
                first_row = None
            else:
                first = data[0]
                if isinstance(first, list):
                    data_format = f"LOL (rows={len(data)}, cols={len(first)})"
                    first_row = first
                else:
                    data_format = f"FLAT (len={len(data)})"
                    first_row = data[:8] if len(data) >= 8 else data

            # Check if this is aktiv/pasiv/income
            nazov_lower = nazov.lower()
            table_type = "UNKNOWN"
            if "strana akt" in nazov_lower or "aktív" in nazov_lower or ("akt" in nazov_lower and "pas" not in nazov_lower):
                table_type = "AKTIV"
            elif "strana pas" in nazov_lower or "pasív" in nazov_lower or "pas" in nazov_lower:
                table_type = "PASIV"
            elif "ziskov a str" in nazov_lower or "profit and loss" in nazov_lower or "výsledovka" in nazov_lower:
                table_type = "INCOME"

            print(f"    Table {i}: {table_type} | {nazov[:35]:35s} | datoveStlpce={pocet_stlpcov} | {data_format}")
            if first_row and table_type == "AKTIV":
                print(f"      First row (totalAssets): {first_row}")

                # Try extraction with data_cols=4
                if isinstance(first_row, list):
                    if len(first_row) == 4:
                        val_4 = first_row[2]  # target=2, data_cols=4
                    elif len(first_row) > 4:
                        val_4 = first_row[len(first_row) - 4 + 2]
                    else:
                        val_4 = "ROW TOO SHORT for data_cols=4"

                    # Try extraction with data_cols=2
                    if len(first_row) == 2:
                        val_2 = first_row[0]  # target=0, data_cols=2
                    elif len(first_row) > 2:
                        val_2 = first_row[len(first_row) - 2 + 0]
                    else:
                        val_2 = "ROW TOO SHORT for data_cols=2"

                    print(f"      Extracted with data_cols=4, target=2: {val_4}")
                    print(f"      Extracted with data_cols=2, target=0: {val_2}")

                    if val_4 is None and val_2 is not None:
                        print(f"      *** BUG CONFIRMED: data_cols=4 fails but data_cols=2 works! ***")

        await asyncio.sleep(1)  # rate limit


async def main():
    async with httpx.AsyncClient(verify=False, timeout=TIMEOUT) as client:
        for ico, eid in SAMPLE_ICOS:
            await audit_ico(client, ico, eid)
            await asyncio.sleep(2)  # rate limit between ICOs


if __name__ == "__main__":
    asyncio.run(main())
