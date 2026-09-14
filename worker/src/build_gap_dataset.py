"""
Build the final prioritized GAP dataset.

Merges:
  results/gap_enriched_<year>.jsonl   (audit GAP_OURS + RÚZ template enrichment)
  DB: max(FinancialStatement.year), Company.ruzSyncedAt per firm
  results/audit_missing_financials_<year>.jsonl  (for P2: OK_NOT_FILED firms
      whose RÚZ latest is <min-year but newer than our DB latest)

Output:
  results/gap_final_<year>.csv  sorted by priority then employeeCount desc
"""

from __future__ import annotations

import asyncio
import csv
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from db_client import connect_db, disconnect_db, get_db

MIN_YEAR = 2025


async def main() -> None:
    enriched = [json.loads(l) for l in
                Path(f"results/gap_enriched_{MIN_YEAR}.jsonl").open(encoding="utf-8")]
    audit = [json.loads(l) for l in
             Path(f"results/audit_missing_financials_{MIN_YEAR}.jsonl").open(encoding="utf-8")]

    await connect_db()
    db = get_db()

    # DB facts for all audited ICOs: max FS year + ruzSyncedAt
    all_icos = [r["ico"] for r in enriched] + [r["ico"] for r in audit]
    all_icos = list(dict.fromkeys(all_icos))
    db_facts: dict[str, dict] = {}
    CH = 5000
    for i in range(0, len(all_icos), CH):
        chunk = all_icos[i:i + CH]
        rows = await db.query_raw(
            '''
            SELECT c."ico" AS ico,
                   c."ruzSyncedAt" AS "ruzSyncedAt",
                   (SELECT MAX(f."year") FROM "FinancialStatement" f
                    WHERE f."companyIco" = c."ico") AS "dbMaxFsYear"
            FROM "Company" c WHERE c."ico" = ANY($1::text[])
            ''',
            chunk,
        )
        for r in rows:
            db_facts[r["ico"]] = r
    print(f"DB facts for {len(db_facts)} ICOs")
    await disconnect_db()

    out_rows: list[dict] = []

    # P1: GAP_OURS — RÚZ has >= min_year, we don't
    for r in enriched:
        f = db_facts.get(r["ico"], {})
        out_rows.append({
            "priority": "P1",
            "ico": r["ico"],
            "name": r.get("name"),
            "dbLatestYear": r.get("dbLatestYear"),
            "dbMaxFsYear": f.get("dbMaxFsYear"),
            "ruzLatestYear": r.get("ruzLatestYear"),
            "templateKind": r.get("templateKind"),
            "idSablony": r.get("idSablony"),
            "ruzTyp": r.get("ruzTyp"),
            "konsolidovana": r.get("konsolidovana"),
            "employeeCount": r.get("employeeCount"),
            "sizeCategory": r.get("sizeCategory"),
            "legalForm": r.get("legalForm"),
            "ruzSyncedAt": str(f.get("ruzSyncedAt") or ""),
        })

    # P2: RÚZ latest is min_year-1 (2024) and our DB max FS year is older
    p2 = 0
    for r in audit:
        if r.get("classification") != "OK_NOT_FILED":
            continue
        ruz_y = r.get("ruzLatestYear") or 0
        db_y = r.get("dbLatestYear") or 0
        if ruz_y == MIN_YEAR - 1 and db_y < ruz_y:
            f = db_facts.get(r["ico"], {})
            out_rows.append({
                "priority": "P2",
                "ico": r["ico"],
                "name": r.get("name"),
                "dbLatestYear": db_y,
                "dbMaxFsYear": f.get("dbMaxFsYear"),
                "ruzLatestYear": ruz_y,
                "templateKind": "NOT_ENRICHED",
                "idSablony": None,
                "ruzTyp": r.get("ruzTyp"),
                "konsolidovana": r.get("ruzKonsolidovana"),
                "employeeCount": None,
                "sizeCategory": None,
                "legalForm": None,
                "ruzSyncedAt": str(f.get("ruzSyncedAt") or ""),
            })
            p2 += 1
    print(f"P2 firms: {p2}")

    # Sort: priority (P1 first), then employeeCount desc (None last)
    out_rows.sort(key=lambda r: (
        0 if r["priority"] == "P1" else 1,
        -(r.get("employeeCount") or 0),
        r["ico"],
    ))

    out = Path(f"results/gap_final_{MIN_YEAR}.csv")
    with out.open("w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=list(out_rows[0].keys()))
        w.writeheader()
        w.writerows(out_rows)
    print(f"Wrote {len(out_rows)} rows -> {out}")

    # Quick stats
    from collections import Counter
    print("By priority:", Counter(r["priority"] for r in out_rows))
    p1 = [r for r in out_rows if r["priority"] == "P1"]
    print("P1 by templateKind:", Counter(r["templateKind"] for r in p1).most_common())
    print("P1 large (>=50 emp):", sum(1 for r in p1 if (r.get("employeeCount") or 0) >= 50))
    print("P1 medium (10-49 emp):", sum(1 for r in p1 if 10 <= (r.get("employeeCount") or 0) < 50))
    print("P1 small (<10 emp):", sum(1 for r in p1 if 0 < (r.get("employeeCount") or 0) < 10))
    print("P1 unknown emp:", sum(1 for r in p1 if not r.get("employeeCount")))


if __name__ == "__main__":
    asyncio.run(main())
