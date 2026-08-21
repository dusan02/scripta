"""
Population-wide Distribution Audit — All 12,576 scoreable companies.

Generates:
- Score distribution (mean, median, percentiles)
- A/AAA/B/C categories
- P1-P5 distributions
- Altman N/A %, Piotroski N/A %
- P2 method distribution (altman_piotroski vs ratio_fallback vs ...)
- Confidence distribution
- Cross-tab: statements count vs median score vs C%
- Cross-tab: NACE vs median score
- Score vs company age

Usage:
    cd worker && python -m tests.population_audit
"""

from __future__ import annotations
import asyncio
import json
import os
import sys
from collections import Counter, defaultdict
from statistics import mean, median

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import asyncpg
from src.analytics import (
    compute_altman_z_score,
    compute_piotroski_f_score,
    compute_forensic_scorecard,
    compute_financial_trends,
    _risk_category,
    get_nace_weights,
    sanitize_cash_flow_fields,
)
from types import SimpleNamespace

DB_URL = "postgresql://verifa:verifa_dev_password@localhost:5432/verifa"

STMT_FIELDS = [
    'year', 'mainActivityRevenue', 'netProfitLoss', 'totalAssets', 'equity',
    'shortTermLiabilities', 'longTermLiabilities', 'staffCosts', 'depreciation',
    'interestExpense', 'incomeTax', 'operatingCashFlow', 'investingCashFlow',
    'financingCashFlow', 'cashAndEquivalents', 'grossProfit', 'currentAssets',
    'inventory', 'tradeReceivables', 'tradePayables', 'socialInsuranceLiabilities',
    'taxLiabilities', 'employeeLiabilities', 'employeeCount', 'monthsInPeriod',
    'statementType', 'isConsolidated', 'retainedEarnings',
]


def _to_stmt_obj(row):
    kw = {}
    for f in STMT_FIELDS:
        v = row.get(f)
        if v is not None and isinstance(v, str) and f in ('year', 'monthsInPeriod', 'employeeCount'):
            try: v = int(v)
            except: pass
        kw[f] = v
    kw['auditorOpinion'] = None
    if row.get('auditorOpinionId'):
        kw['auditorOpinion'] = SimpleNamespace(opinionType=row.get('auditorOpinionType', ''))
    kw['statementType'] = row.get('statementType')
    kw['isConsolidated'] = row.get('isConsolidated', False)
    return SimpleNamespace(**kw)


def _pct(arr, p):
    if not arr: return 0
    s = sorted(arr)
    idx = min(int(len(s) * p / 100), len(s) - 1)
    return s[idx]


async def main():
    print("╔" + "═"*78 + "╗")
    print("║" + " VERIFA — POPULATION-WIDE DISTRIBUTION AUDIT".center(78) + "║")
    print("║" + " All 12,576 scoreable companies".center(78) + "║")
    print("╚" + "═"*78 + "╝")

    pool = await asyncpg.create_pool(DB_URL, min_size=2, max_size=10)
    print("DB connected")

    async with pool.acquire() as conn:
        rows = await conn.fetch("""
            SELECT c.ico, count(fs.id) as fs_count
            FROM "Company" c
            JOIN "FinancialStatement" fs ON fs."companyIco" = c.ico
            GROUP BY c.ico
            HAVING count(fs.id) >= 2
            ORDER BY c.ico
        """)
        scoreable_icos = [r["ico"] for r in rows]
        print(f"Scoreable companies: {len(scoreable_icos)}")

    results = []
    errors = 0
    batch_size = 100

    async with pool.acquire() as conn:
        for batch_start in range(0, len(scoreable_icos), batch_size):
            batch = scoreable_icos[batch_start:batch_start + batch_size]
            for ico in batch:
                try:
                    comp = await conn.fetchrow(
                        'SELECT ico, name, "legalForm", "naceCode" FROM "Company" WHERE ico = $1', ico)
                    if not comp: continue

                    stmts = await conn.fetch(
                        'SELECT * FROM "FinancialStatement" WHERE "companyIco" = $1 ORDER BY year ASC', ico)
                    vestnik = await conn.fetch(
                        'SELECT "eventType", "severityLevel", "publishedAt" FROM "VestnikEvent" WHERE "companyIco" = $1', ico)
                    events = await conn.fetch(
                        'SELECT source, "eventType", severity, metadata, "createdAt" FROM "CompanyEvent" WHERE "companyIco" = $1', ico)

                    stmt_objs = [_to_stmt_obj(s) for s in stmts]
                    for s in stmt_objs:
                        sanitize_cash_flow_fields(s)

                    company_dict = {
                        "ico": comp["ico"],
                        "name": comp["name"] or "",
                        "legalForm": comp["legalForm"] or "",
                        "naceCode": comp["naceCode"] or "",
                        "financialStatements": [
                            {f: getattr(s, f, None) for f in STMT_FIELDS + ['auditorOpinion']}
                            for s in stmt_objs
                        ],
                        "vestnikEvents": [
                            {"eventType": v["eventType"], "severityLevel": v["severityLevel"],
                             "publishedAt": v["publishedAt"]}
                            for v in vestnik
                        ],
                        "companyEvents": [
                            {"source": e["source"], "eventType": e["eventType"], "severity": e["severity"],
                             "metadata": e["metadata"] if isinstance(e["metadata"], dict) else (
                                 json.loads(e["metadata"]) if e["metadata"] else {}),
                             "createdAt": e["createdAt"]}
                            for e in events
                        ],
                    }

                    trends = compute_financial_trends(stmt_objs)
                    sc = compute_forensic_scorecard(company_dict, trends)

                    # Extract P2 method from detail
                    p2_pillar = [p for p in sc.pillars if "Finančné zdravie" in p.name]
                    p2_method = "unknown"
                    if p2_pillar and p2_pillar[0].detail.startswith("["):
                        p2_method = p2_pillar[0].detail.split("]")[0][1:]

                    altman = compute_altman_z_score(stmt_objs[-1])
                    piotroski = compute_piotroski_f_score(stmt_objs)

                    results.append({
                        "ico": comp["ico"],
                        "nace": comp["naceCode"] or "",
                        "legalForm": comp["legalForm"] or "",
                        "stmtCount": len(stmt_objs),
                        "vestnikCount": len(vestnik),
                        "score": sc.total_score,
                        "cat": sc.risk_category,
                        "confidence": sc.confidence,
                        "hardStop": sc.hard_stop,
                        "P1": next((p.score for p in sc.pillars if "Platobná" in p.name), 0),
                        "P2": next((p.score for p in sc.pillars if "Finančné zdravie" in p.name), 0),
                        "P3": next((p.score for p in sc.pillars if "Ziskovosť" in p.name), 0),
                        "P4": next((p.score for p in sc.pillars if "Rast" in p.name), 0),
                        "P5": next((p.score for p in sc.pillars if "Právna" in p.name), 0),
                        "altman": altman.get("z_score"),
                        "piotroski": piotroski.get("score"),
                        "p2_method": p2_method,
                    })
                except Exception as e:
                    errors += 1
                    if errors <= 3:
                        print(f"  ERROR {ico}: {e}")

            if (batch_start + batch_size) % 1000 == 0 or batch_start + batch_size >= len(scoreable_icos):
                print(f"  Progress: {min(batch_start + batch_size, len(scoreable_icos))}/{len(scoreable_icos)} ({errors} errors)")

    print(f"\nScoring complete: {len(results)} scored, {errors} errors")
    await pool.close()

    if not results:
        print("No results!")
        return

    N = len(results)
    scores = [r["score"] for r in results]
    cats = Counter(r["cat"] for r in results)
    confidences = [r["confidence"] for r in results]

    # ── 1. Overall Distribution ──
    print(f"\n{'='*90}")
    print(f"POPULATION AUDIT — {N} companies")
    print(f"{'='*90}")

    print(f"\n── 1. Score Distribution ──")
    print(f"  Mean: {mean(scores):.1f}")
    print(f"  Median: {median(scores):.0f}")
    print(f"  Min: {min(scores)}, Max: {max(scores)}")
    print(f"  P10: {_pct(scores,10)}, P25: {_pct(scores,25)}, P75: {_pct(scores,75)}, P90: {_pct(scores,90)}")
    print(f"  StDev: {(sum((s-mean(scores))**2 for s in scores)/N)**0.5:.1f}")

    print(f"\n── 2. Risk Categories ──")
    for cat in ["AAA", "A", "B", "C"]:
        c = cats.get(cat, 0)
        print(f"  {cat:5s}: {c:6d} ({c/N*100:.1f}%)")

    # ── 3. P1-P5 Distribution ──
    print(f"\n── 3. Per-Pillar Distribution ──")
    print(f"  {'Pillar':30s} {'Mean':>6} {'Med':>5} {'P25':>5} {'P75':>5}")
    for pname, pk in [("P1 (Platobná)", "P1"), ("P2 (Finančné zdravie)", "P2"),
                       ("P3 (Ziskovosť/CF)", "P3"), ("P4 (Rast & Trend)", "P4"),
                       ("P5 (Právna)", "P5")]:
        vals = [r[pk] for r in results]
        print(f"  {pname:30s} {mean(vals):6.1f} {median(vals):5.0f} {_pct(vals,25):5d} {_pct(vals,75):5d}")

    # ── 4. Altman / Piotroski N/A ──
    altman_na = sum(1 for r in results if r["altman"] is None)
    pio_na = sum(1 for r in results if r["piotroski"] is None)
    both_na = sum(1 for r in results if r["altman"] is None and r["piotroski"] is None)
    print(f"\n── 4. Model N/A Statistics ──")
    print(f"  Altman Z'' N/A: {altman_na}/{N} ({altman_na/N*100:.1f}%)")
    print(f"  Piotroski N/A: {pio_na}/{N} ({pio_na/N*100:.1f}%)")
    print(f"  Both N/A: {both_na}/{N} ({both_na/N*100:.1f}%)")

    # ── 5. P2 Method Distribution ──
    p2_methods = Counter(r["p2_method"] for r in results)
    print(f"\n── 5. P2 Method Distribution ──")
    for method, count in p2_methods.most_common():
        method_scores = [r["score"] for r in results if r["p2_method"] == method]
        print(f"  {method:25s}: {count:6d} ({count/N*100:.1f}%) — median score={median(method_scores):.0f}")

    # ── 6. Confidence Distribution ──
    print(f"\n── 6. Confidence Distribution ──")
    print(f"  Mean: {mean(confidences):.1f}")
    print(f"  Median: {median(confidences):.0f}")
    print(f"  P10: {_pct(confidences,10)}, P25: {_pct(confidences,25)}, P75: {_pct(confidences,75)}, P90: {_pct(confidences,90)}")
    conf_buckets = Counter()
    for c in confidences:
        if c >= 90: conf_buckets["90-100"] += 1
        elif c >= 70: conf_buckets["70-89"] += 1
        elif c >= 50: conf_buckets["50-69"] += 1
        elif c >= 30: conf_buckets["30-49"] += 1
        else: conf_buckets["0-29"] += 1
    print(f"  {'Bucket':10s} {'Count':>6} {'%':>6}")
    for b in ["90-100", "70-89", "50-69", "30-49", "0-29"]:
        c = conf_buckets.get(b, 0)
        print(f"  {b:10s} {c:6d} {c/N*100:5.1f}%")

    # ── 7. Cross-tab: Statements vs Score vs C% ──
    print(f"\n── 7. Cross-tab: Statements Count vs Score vs C% ──")
    stmt_groups = defaultdict(list)
    for r in results:
        n = r["stmtCount"]
        if n <= 2: stmt_groups["1-2"].append(r)
        elif n == 3: stmt_groups["3"].append(r)
        elif n == 4: stmt_groups["4"].append(r)
        elif n >= 5: stmt_groups["5+"].append(r)

    print(f"  {'Stmts':8s} {'N':>6} {'Med Score':>9} {'Med P2':>7} {'Med Conf':>8} {'C%':>6} {'A/AAA%':>7}")
    for g in ["1-2", "3", "4", "5+"]:
        rs = stmt_groups.get(g, [])
        if not rs: continue
        nn = len(rs)
        med_s = median([r["score"] for r in rs])
        med_p2 = median([r["P2"] for r in rs])
        med_conf = median([r["confidence"] for r in rs])
        c_pct = sum(1 for r in rs if r["cat"] == "C") / nn * 100
        a_pct = sum(1 for r in rs if r["cat"] in ("A", "AAA")) / nn * 100
        print(f"  {g:8s} {nn:6d} {med_s:9.0f} {med_p2:7.0f} {med_conf:8.0f} {c_pct:5.1f}% {a_pct:6.1f}%")

    # ── 8. Cross-tab: NACE vs Score ──
    print(f"\n── 8. Cross-tab: NACE Section vs Score ──")
    nace_groups = defaultdict(list)
    for r in results:
        nace_code = r["nace"][:2] if r["nace"] else "??"
        nace_groups[nace_code].append(r)

    print(f"  {'NACE':6s} {'N':>6} {'Med Score':>9} {'Med P2':>7} {'C%':>6} {'A/AAA%':>7}")
    for nace in sorted(nace_groups.keys()):
        rs = nace_groups[nace]
        if len(rs) < 20: continue  # skip small groups
        nn = len(rs)
        med_s = median([r["score"] for r in rs])
        med_p2 = median([r["P2"] for r in rs])
        c_pct = sum(1 for r in rs if r["cat"] == "C") / nn * 100
        a_pct = sum(1 for r in rs if r["cat"] in ("A", "AAA")) / nn * 100
        print(f"  {nace:6s} {nn:6d} {med_s:9.0f} {med_p2:7.0f} {c_pct:5.1f}% {a_pct:6.1f}%")

    # ── 9. Cross-tab: Legal Form vs Score ──
    print(f"\n── 9. Cross-tab: Legal Form vs Score ──")
    lf_groups = defaultdict(list)
    for r in results:
        lf_groups[r["legalForm"] or "unknown"].append(r)

    print(f"  {'Legal Form':25s} {'N':>6} {'Med Score':>9} {'C%':>6} {'A/AAA%':>7}")
    for lf in sorted(lf_groups.keys()):
        rs = lf_groups[lf]
        if len(rs) < 20: continue
        nn = len(rs)
        med_s = median([r["score"] for r in rs])
        c_pct = sum(1 for r in rs if r["cat"] == "C") / nn * 100
        a_pct = sum(1 for r in rs if r["cat"] in ("A", "AAA")) / nn * 100
        print(f"  {lf:25s} {nn:6d} {med_s:9.0f} {c_pct:5.1f}% {a_pct:6.1f}%")

    # ── 10. Hard Stops ──
    hard_stops = [r for r in results if r["hardStop"]]
    print(f"\n── 10. Hard Stops: {len(hard_stops)} ──")

    # ── 11. Vestnik Impact ──
    with_v = [r for r in results if r["vestnikCount"] > 0]
    without_v = [r for r in results if r["vestnikCount"] == 0]
    print(f"\n── 11. Vestnik Impact ──")
    print(f"  With vestnik:    N={len(with_v):6d}, med score={median([r['score'] for r in with_v]):.0f}, C%={sum(1 for r in with_v if r['cat']=='C')/max(len(with_v),1)*100:.1f}%")
    print(f"  Without vestnik: N={len(without_v):6d}, med score={median([r['score'] for r in without_v]):.0f}, C%={sum(1 for r in without_v if r['cat']=='C')/max(len(without_v),1)*100:.1f}%")

    # ── Summary ──
    print(f"\n{'='*90}")
    print(f"SUMMARY — {N} companies")
    print(f"{'='*90}")
    print(f"  Mean score: {mean(scores):.1f}, Median: {median(scores):.0f}")
    print(f"  AAA: {cats.get('AAA',0)}, A: {cats.get('A',0)}, B: {cats.get('B',0)}, C: {cats.get('C',0)}")
    print(f"  Altman N/A: {altman_na/N*100:.1f}%, Piotroski N/A: {pio_na/N*100:.1f}%, Both N/A: {both_na/N*100:.1f}%")
    print(f"  P2 methods: {dict(p2_methods.most_common())}")
    print(f"  Mean confidence: {mean(confidences):.1f}")
    print(f"  Hard stops: {len(hard_stops)}")
    print(f"  Errors: {errors}")

    # Save
    with open("tests/population_results.json", "w") as f:
        json.dump(results, f, ensure_ascii=False, indent=2, default=str)
    print(f"\nResults saved to tests/population_results.json")


if __name__ == "__main__":
    asyncio.run(main())
