"""
Enrich GAP_OURS firms from the missing-financials audit with RÚZ template
details (idSablony → IFRS vs SK GAAP) and DB facts (size, legal form).

Read-only: RÚZ API GETs + prisma reads. No writes to Company/FinancialStatement.

Inputs (results/):
  audit_missing_financials_<year>.jsonl   output of audit_missing_recent_financials

Output (results/):
  gap_enriched_<year>.jsonl   one record per GAP_OURS firm:
      ico, name, dbLatestYear, ruzLatestYear, ruzTyp, ruzDatumPodania,
      ruzZavierkaId, idSablony, templateKind, vykazPristupnost,
      employeeCount, sizeCategory, legalForm, priority

Template classification (RÚZ šablóny):
  709, 703      → IFRS (FRSR, PDF-only)
  5183          → VU_POD (Výkaz vybraných údajov POD 1-01, FRSR, PDF-only)
  699, 687      → SK_GAAP (structured JSON tables)
  anything else → UNKNOWN (recorded raw idSablony)

Usage (worker container):
  python -m src.enrich_gap_firms --min-year 2025 --resume
  python -m src.enrich_gap_firms --min-year 2025 --summary
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

logger = logging.getLogger("enrich_gap")

RUZ_API = "https://www.registeruz.sk/cruz-public/api"
UA = "Verifa.sk/1.0 (+https://verifa.sk)"
TIMEOUT = 30.0

IFRS_TEMPLATES = {709, 703}
VU_POD_TEMPLATES = {5183}
SK_GAAP_TEMPLATES = {699, 687}


async def ruz_get(client: httpx.AsyncClient, endpoint: str, params: dict,
                  max_retries: int = 3) -> Optional[dict]:
    url = f"{RUZ_API}/{endpoint}"
    for attempt in range(max_retries):
        try:
            resp = await asyncio.wait_for(
                client.get(url, params=params, headers={"User-Agent": UA}, timeout=TIMEOUT),
                timeout=TIMEOUT + 15,
            )
            if resp.status_code == 200:
                return resp.json()
            if resp.status_code in (429, 502, 503):
                await asyncio.sleep(2 ** attempt)
                continue
            return None
        except (httpx.HTTPError, asyncio.TimeoutError) as e:
            logger.warning(f"RUZ error {endpoint}: {type(e).__name__}: {e} (attempt {attempt + 1})")
            await asyncio.sleep(2 ** attempt)
    return None


def classify_template(id_sablony: Optional[int]) -> str:
    if id_sablony in IFRS_TEMPLATES:
        return "IFRS"
    if id_sablony in VU_POD_TEMPLATES:
        return "VU_POD"
    if id_sablony in SK_GAAP_TEMPLATES:
        return "SK_GAAP"
    return "UNKNOWN"


async def enrich_one(client, rec: dict, db_facts: dict) -> dict:
    out = {
        "ico": rec["ico"],
        "name": rec.get("name"),
        "dbLatestYear": rec.get("dbLatestYear"),
        "ruzLatestYear": rec.get("ruzLatestYear"),
        "ruzZavierkaId": rec.get("ruzLatestZavierkaId"),
        "ruzDatumPodania": rec.get("ruzDatumPodania"),
        **db_facts,
    }

    zid = rec.get("ruzLatestZavierkaId")
    id_sablony = None
    pristupnost = None
    konsolidovana = None
    typ = rec.get("ruzTyp")

    if zid:
        zav = await ruz_get(client, "uctovna-zavierka", {"id": zid})
        if zav:
            typ = zav.get("typ") or typ
            konsolidovana = bool(zav.get("konsolidovana", False))
            for vid in (zav.get("idUctovnychVykazov") or [])[:3]:
                v = await ruz_get(client, "uctovny-vykaz", {"id": vid})
                if not v:
                    continue
                pristupnost = v.get("pristupnostDat") or pristupnost
                if v.get("idSablony"):
                    id_sablony = v["idSablony"]
                    break

    out.update({
        "ruzTyp": typ,
        "konsolidovana": konsolidovana,
        "idSablony": id_sablony,
        "templateKind": classify_template(id_sablony),
        "vykazPristupnost": pristupnost,
        "priority": "P1",
    })
    return out


def summarize(path: Path) -> None:
    if not path.exists():
        print(f"No results file: {path}")
        return
    by_kind: dict[str, int] = {}
    by_year: dict[int, int] = {}
    by_typ: dict[str, int] = {}
    large = 0
    total = 0
    with path.open(encoding="utf-8") as f:
        for line in f:
            try:
                r = json.loads(line)
            except Exception:
                continue
            total += 1
            k = r.get("templateKind", "?")
            by_kind[k] = by_kind.get(k, 0) + 1
            y = r.get("ruzLatestYear") or 0
            by_year[y] = by_year.get(y, 0) + 1
            t = r.get("ruzTyp") or "?"
            by_typ[t] = by_typ.get(t, 0) + 1
            if (r.get("employeeCount") or 0) >= 50:
                large += 1
    print(f"File: {path}")
    print(f"Total GAP firms enriched: {total}")
    print("By templateKind:")
    for k in sorted(by_kind):
        print(f"  {k}: {by_kind[k]}")
    print("By RÚZ latest year:")
    for y in sorted(by_year, reverse=True):
        print(f"  {y}: {by_year[y]}")
    print("By závierka typ:")
    for k in sorted(by_typ):
        print(f"  {k}: {by_typ[k]}")
    print(f"Large firms (employeeCount>=50): {large}")


async def run(args: argparse.Namespace) -> None:
    logging.basicConfig(level=logging.INFO,
                        format="%(asctime)s [%(levelname)s] %(message)s",
                        handlers=[logging.StreamHandler()])

    audit_file = Path("results") / f"audit_missing_financials_{args.min_year}.jsonl"
    out_file = Path("results") / f"gap_enriched_{args.min_year}.jsonl"

    if args.summary:
        summarize(out_file)
        return

    gap: list[dict] = []
    with audit_file.open(encoding="utf-8") as f:
        for line in f:
            try:
                rec = json.loads(line)
            except Exception:
                continue
            if rec.get("classification") == "GAP_OURS":
                gap.append(rec)
    logger.info(f"Audit file: {len(gap)} GAP_OURS firms")

    done: set[str] = set()
    if args.resume and out_file.exists():
        with out_file.open(encoding="utf-8") as f:
            for line in f:
                try:
                    done.add(json.loads(line)["ico"])
                except Exception:
                    continue
        logger.info(f"Resume: {len(done)} already enriched")

    todo = [r for r in gap if r["ico"] not in done]
    logger.info(f"To enrich: {len(todo)} (concurrency={args.concurrency})")

    await connect_db()
    db = get_db()

    # DB facts in bulk (employeeCount/sizeCategory/legalForm) via chunked query_raw
    db_map: dict[str, dict] = {}
    CH = 5000
    icos = [r["ico"] for r in gap]
    for i in range(0, len(icos), CH):
        chunk = icos[i:i + CH]
        rows = await db.query_raw(
            'SELECT "ico", "employeeCount", "sizeCategory", "legalForm" '
            'FROM "Company" WHERE "ico" = ANY($1::text[])',
            chunk,
        )
        for r in rows:
            db_map[r["ico"]] = {
                "employeeCount": r.get("employeeCount"),
                "sizeCategory": r.get("sizeCategory"),
                "legalForm": r.get("legalForm"),
            }
    logger.info(f"DB facts loaded for {len(db_map)} firms")

    sem = asyncio.Semaphore(args.concurrency)
    t0 = time.perf_counter()
    processed = 0
    out_f = out_file.open("a", encoding="utf-8")

    async def work(rec: dict) -> None:
        nonlocal processed
        async with sem:
            try:
                enriched = await enrich_one(client, rec, db_map.get(rec["ico"], {}))
            except Exception as e:
                enriched = {"ico": rec["ico"], "name": rec.get("name"),
                            "templateKind": "EXCEPTION", "priority": "P1",
                            "error": f"{type(e).__name__}: {e}"}
            out_f.write(json.dumps(enriched, ensure_ascii=False) + "\n")
            processed += 1
            if processed % 1000 == 0:
                out_f.flush()
                rate = processed / max(time.perf_counter() - t0, 1)
                eta_h = (len(todo) - processed) / max(rate, 0.01) / 3600
                logger.info(f"[enrich] {processed}/{len(todo)} ({rate:.1f}/s, ETA {eta_h:.1f}h)")

    async with httpx.AsyncClient(limits=httpx.Limits(
            max_connections=args.concurrency,
            max_keepalive_connections=args.concurrency)) as client:
        await asyncio.gather(*[work(r) for r in todo])

    out_f.flush()
    out_f.close()
    logger.info("[enrich] complete")
    await disconnect_db()


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("--min-year", type=int, default=2025)
    p.add_argument("--concurrency", type=int, default=8)
    p.add_argument("--resume", action="store_true")
    p.add_argument("--summary", action="store_true")
    asyncio.run(run(p.parse_args()))
