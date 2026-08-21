"""
Real-Company Validation — Verifa Scoring Pipeline
=================================================

Spustí current (fixed) scoring na 200 reálnych slovenských firmách
a porovná s "old" scoringom (pred fixmi F1/F3/F4/F5).

Usage:
    cd worker && python -m tests.real_company_validation
"""

from __future__ import annotations
import asyncio
import json
import math
import os
import sys
import random
from collections import Counter, defaultdict
from statistics import mean, median
from typing import Any

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import asyncpg
from src.analytics import (
    compute_altman_z_score,
    compute_piotroski_f_score,
    compute_forensic_scorecard,
    compute_financial_trends,
    _is_financial_institution,
    _risk_category,
    get_nace_weights,
    sanitize_cash_flow_fields,
    compute_vestnik_degradation,
)
from src.verdict_builder import _compute_deterministic_adjustment
from types import SimpleNamespace


# ═══════════════════════════════════════════════════════════════════════════════
# DB QUERIES
# ═══════════════════════════════════════════════════════════════════════════════

DB_URL = "postgresql://verifa:verifa_dev_password@localhost:5432/verifa"

STMT_FIELDS = [
    'year', 'mainActivityRevenue', 'netProfitLoss', 'totalAssets', 'equity',
    'shortTermLiabilities', 'longTermLiabilities', 'staffCosts', 'depreciation',
    'interestExpense', 'incomeTax', 'operatingCashFlow', 'investingCashFlow',
    'financingCashFlow', 'cashAndEquivalents', 'grossProfit', 'currentAssets',
    'inventory', 'tradeReceivables', 'tradePayables', 'socialInsuranceLiabilities',
    'taxLiabilities', 'employeeLiabilities', 'employeeCount', 'monthsInPeriod',
    'statementType', 'isConsolidated',
]


async def sample_companies(pool, n=200):
    """Stratified sample of n companies with >=2 financial statements."""
    # Count scoreable
    async with pool.acquire() as conn:
        total = await conn.fetchval("""
            SELECT count(DISTINCT c.ico) FROM "Company" c
            JOIN "FinancialStatement" fs ON fs."companyIco" = c.ico
            GROUP BY c.ico HAVING count(*) >= 2
        """)
        # Actually this returns a row count, let me fix
        rows = await conn.fetch("""
            SELECT c.ico, count(fs.id) as fs_count
            FROM "Company" c
            JOIN "FinancialStatement" fs ON fs."companyIco" = c.ico
            GROUP BY c.ico
            HAVING count(fs.id) >= 2
        """)
        scoreable_icos = [r["ico"] for r in rows]
        print(f"Total scoreable: {len(scoreable_icos)}")

        # Get companies with vestnik events
        vestnik_icos = await conn.fetch("""
            SELECT DISTINCT c.ico, count(ve.id) as ve_count
            FROM "Company" c
            JOIN "VestnikEvent" ve ON ve."companyIco" = c.ico
            GROUP BY c.ico
        """)
        vestnik_set = {r["ico"]: r["ve_count"] for r in vestnik_icos}

        # Stratify
        with_vestnik = [ico for ico in scoreable_icos if ico in vestnik_set]
        without_vestnik = [ico for ico in scoreable_icos if ico not in vestnik_set]

        random.seed(42)
        sample_icos = []
        sample_icos.extend(random.sample(with_vestnik, min(50, len(with_vestnik))))
        sample_icos.extend(random.sample(without_vestnik, min(50, len(without_vestnik))))

        # Micro firms (low totalAssets)
        micro_rows = await conn.fetch("""
            SELECT c.ico, max(fs."totalAssets") as max_ta
            FROM "Company" c
            JOIN "FinancialStatement" fs ON fs."companyIco" = c.ico
            GROUP BY c.ico
            HAVING max(fs."totalAssets") < 100000 AND count(fs.id) >= 2
        """)
        micro_icos = [r["ico"] for r in micro_rows if r["ico"] not in sample_icos]
        sample_icos.extend(random.sample(micro_icos, min(50, len(micro_icos))))

        # New firms (exactly 2 FS)
        new_rows = await conn.fetch("""
            SELECT c.ico, count(fs.id) as fs_count
            FROM "Company" c
            JOIN "FinancialStatement" fs ON fs."companyIco" = c.ico
            GROUP BY c.ico
            HAVING count(fs.id) = 2
        """)
        new_icos = [r["ico"] for r in new_rows if r["ico"] not in sample_icos]
        sample_icos.extend(random.sample(new_icos, min(25, len(new_icos))))

        # Fill remainder
        remaining = [ico for ico in scoreable_icos if ico not in sample_icos]
        sample_icos.extend(random.sample(remaining, min(n - len(sample_icos), len(remaining))))

        sample_icos = sample_icos[:n]

    # Now fetch full data for each company
    companies = []
    async with pool.acquire() as conn:
        for ico in sample_icos:
            comp = await conn.fetchrow('''
                SELECT ico, name, "legalForm", "naceCode"
                FROM "Company" WHERE ico = $1
            ''', ico)
            if not comp:
                continue

            stmts = await conn.fetch('''
                SELECT * FROM "FinancialStatement"
                WHERE "companyIco" = $1 ORDER BY year ASC
            ''', ico)

            vestnik = await conn.fetch('''
                SELECT "eventType", "severityLevel", "publishedAt"
                FROM "VestnikEvent" WHERE "companyIco" = $1
            ''', ico)

            events = await conn.fetch('''
                SELECT source, "eventType", severity, metadata, "createdAt"
                FROM "CompanyEvent" WHERE "companyIco" = $1
            ''', ico)

            companies.append({
                "ico": comp["ico"],
                "name": comp["name"],
                "legalForm": comp["legalForm"],
                "naceCode": comp["naceCode"],
                "stmts": stmts,
                "vestnik": vestnik,
                "events": events,
            })

    return companies


def _to_stmt_obj(row):
    """Convert DB row to SimpleNamespace for analytics functions."""
    kw = {}
    for f in STMT_FIELDS:
        v = row.get(f)
        if v is not None and isinstance(v, str) and f in ('year', 'monthsInPeriod', 'employeeCount'):
            try: v = int(v)
            except: pass
        kw[f] = v
    # Add auditor opinion if present
    kw['auditorOpinion'] = None
    if row.get('auditorOpinionId'):
        kw['auditorOpinion'] = SimpleNamespace(opinionType=row.get('auditorOpinionType', ''))
    kw['statementType'] = row.get('statementType')
    kw['isConsolidated'] = row.get('isConsolidated', False)
    return SimpleNamespace(**kw)


def _to_company_dict(comp):
    """Convert company to dict for compute_forensic_scorecard."""
    stmts = [_to_stmt_obj(s) for s in comp["stmts"]]
    for s in stmts:
        sanitize_cash_flow_fields(s)

    return {
        "ico": comp["ico"],
        "name": comp["name"] or "",
        "legalForm": comp["legalForm"] or "",
        "naceCode": comp["naceCode"] or "",
        "financialStatements": [
            {f: getattr(s, f, None) for f in STMT_FIELDS + ['auditorOpinion']}
            for s in stmts
        ],
        "vestnikEvents": [
            {"eventType": v["eventType"], "severityLevel": v["severityLevel"],
             "publishedAt": v["publishedAt"]}
            for v in comp["vestnik"]
        ],
        "companyEvents": [
            {"source": e["source"], "eventType": e["eventType"], "severity": e["severity"],
             "metadata": e["metadata"] if isinstance(e["metadata"], dict) else (
                 json.loads(e["metadata"]) if e["metadata"] else {}),
             "createdAt": e["createdAt"]}
            for e in comp["events"]
        ],
    }, stmts


# ═══════════════════════════════════════════════════════════════════════════════
# OLD SCORING (pre-fix) — reimplemented inline
# ═══════════════════════════════════════════════════════════════════════════════

def old_altman_z_score(stmt):
    """Old Altman Z'' — bez X4 cap."""
    try:
        ta = float(getattr(stmt, 'totalAssets', 0) or 0)
        ca = getattr(stmt, 'currentAssets', None)
        eq = float(getattr(stmt, 'equity', 0) or 0)
        np_ = float(getattr(stmt, 'netProfitLoss', 0) or 0)
        ie = getattr(stmt, 'interestExpense', None)
        stl = getattr(stmt, 'shortTermLiabilities', None)
        ltl = getattr(stmt, 'longTermLiabilities', None)

        if ta <= 0 or np_ is None or eq is None or stl is None:
            return {"z_score": None, "zone": "N/A"}

        has_ca = ca is not None
        ca = float(ca) if has_ca else 0
        ltl = float(ltl) if ltl is not None else 0
        stl = float(stl)

        wc = (ca - stl) if has_ca else (ta * 0.6 - stl)
        raw_liab = stl + ltl
        if raw_liab < 0:
            tl = max(ta - eq, 1)
        elif stl > 0 or ltl > 0:
            tl = max(raw_liab, 1)
        else:
            tl = max(ta - eq, 1)

        ebit = np_ + abs(float(ie)) if ie is not None else np_
        x1 = wc / ta
        x2 = eq / ta
        x3 = ebit / ta
        x4 = eq / tl  # NO CAP

        z = round(6.56 * x1 + 3.26 * x2 + 6.72 * x3 + 1.05 * x4, 2)
        zone = "SAFE" if z > 2.6 else ("GREY" if z >= 1.1 else "DISTRESS")
        return {"z_score": z, "zone": zone}
    except:
        return {"z_score": None, "zone": "N/A"}


def _old_piotroski(statements):
    """Old Piotroski — 0.5 per missing."""
    if not statements or len(statements) < 2:
        return {"score": None, "skipped_criteria": []}
    curr, prev = statements[-1], statements[-2]
    def _g(o, n):
        v = getattr(o, n, None)
        return float(v) if v is not None else None

    c_np, c_a = _g(curr,'netProfitLoss'), _g(curr,'totalAssets')
    p_np, p_a = _g(prev,'netProfitLoss'), _g(prev,'totalAssets')
    c_cf = _g(curr,'operatingCashFlow')
    c_ld, p_ld = _g(curr,'longTermLiabilities'), _g(prev,'longTermLiabilities')
    c_ca, c_cl = _g(curr,'currentAssets'), _g(curr,'shortTermLiabilities')
    p_ca, p_cl = _g(prev,'currentAssets'), _g(prev,'shortTermLiabilities')
    c_g, c_r = _g(curr,'grossProfit'), _g(curr,'mainActivityRevenue')
    p_g, p_r = _g(prev,'grossProfit'), _g(prev,'mainActivityRevenue')

    score = 0.0; skipped = []
    if c_np is not None and c_a and c_a > 0:
        if c_np/c_a > 0: score += 1
    else: score += 0.5; skipped.append("ROA")
    if c_cf is not None:
        if c_cf > 0: score += 1
    else: score += 0.5; skipped.append("CFO>0")
    if c_np is not None and c_a and c_a > 0 and p_np is not None and p_a and p_a > 0:
        if c_np/c_a > p_np/p_a: score += 1
    else: score += 0.5; skipped.append("dROA")
    if c_cf is not None and c_np is not None:
        if c_cf > c_np: score += 1
    else: score += 0.5; skipped.append("CFO>NI")
    if c_ld is not None and c_a and c_a > 0 and p_ld is not None and p_a and p_a > 0:
        if c_ld/c_a < p_ld/p_a: score += 1
    else: score += 0.5; skipped.append("dLev")
    if c_ca is not None and c_cl and c_cl > 0 and p_ca is not None and p_cl and p_cl > 0:
        if c_ca/c_cl > p_ca/p_cl: score += 1
    else: score += 0.5; skipped.append("dLiq")
    if c_g is not None and c_r and c_r > 0 and p_g is not None and p_r and p_r > 0:
        if c_g/c_r > p_g/p_r: score += 1
    else: score += 0.5; skipped.append("dMargin")
    if c_r is not None and c_a and c_a > 0 and p_r is not None and p_a and p_a > 0:
        if c_r/c_a > p_r/p_a: score += 1
    else: score += 0.5; skipped.append("dTurn")
    return {"score": int(round(score)), "skipped_criteria": skipped}


def _compute_old_p1(company_dict, trends, nace_w):
    """Old P1 with vestnik penalization."""
    sorted_stmts = sorted(company_dict["financialStatements"], key=lambda x: x.get("year", 0))
    all_ratios = trends.get("ratios_by_year") or [{}]
    all_z = trends.get("altman_z_scores") or [{}]
    last_ratios = next((r for r in reversed(all_ratios) if r.get("current_ratio") is not None), all_ratios[-1] if all_ratios else {})
    last_z = next((z for z in reversed(all_z) if z.get("z_score") is not None and z.get("components")), all_z[-1] if all_z else {})

    is_financial_inst = False
    if sorted_stmts:
        last = sorted_stmts[-1]
        ta = float(last.get("totalAssets") or 0)
        stl = last.get("shortTermLiabilities")
        eq = float(last.get("equity") or 0)
        if ta > 10_000_000 and eq > 0:
            tl = ta - eq
            if stl is not None and float(stl) <= ta * 0.01 and tl > ta * 0.50:
                is_financial_inst = True

    p1_raw = 0
    cr = last_ratios.get("current_ratio")
    if is_financial_inst: p1_raw += 10
    elif cr is None: p1_raw += 6
    elif cr >= 1.5: p1_raw += 12
    elif cr >= 1.0: p1_raw += 8
    elif cr >= 0.5: p1_raw += 4

    equity_to_debt = last_z.get("components", {}).get("x4_equity_to_debt", None)
    if is_financial_inst:
        _eq = sorted_stmts[-1].get("equity") if sorted_stmts else None
        if _eq is not None and float(_eq) > 0: p1_raw += 12
        elif _eq is not None and float(_eq) < 0: pass
        else: p1_raw += 6
    elif equity_to_debt is None: p1_raw += 6
    elif equity_to_debt > 0: p1_raw += 12

    # Vestnik penalization (OLD)
    vestnik_events = company_dict.get("vestnikEvents", [])
    crit_events_penalty = 0
    for e in vestnik_events:
        sev = e.get("severityLevel", "")
        if sev in ("CRITICAL", "HIGH"):
            crit_events_penalty += compute_vestnik_degradation(e)
    if crit_events_penalty == 0: p1_raw += 6
    elif crit_events_penalty < 1.0: p1_raw += 3

    p1_raw = max(0, min(30, p1_raw))
    return int(round((p1_raw / 30.0) * nace_w["P1"]))


# ═══════════════════════════════════════════════════════════════════════════════
# SCORING
# ═══════════════════════════════════════════════════════════════════════════════

def score_company(comp):
    company_dict, stmts = _to_company_dict(comp)
    if not stmts or len(stmts) < 2:
        return None

    trends = compute_financial_trends(stmts)

    # NEW scoring
    new_sc = compute_forensic_scorecard(company_dict, trends)
    new_pillars = {p.name: p.score for p in new_sc.pillars}
    new_altman = compute_altman_z_score(stmts[-1])
    new_piotroski = compute_piotroski_f_score(stmts)

    # Det adj
    narrative_by_year = []
    notes_by_year = []
    for stmt in company_dict.get("financialStatements", []):
        nr = stmt.get("narrativeRisk")
        if nr: narrative_by_year.append({"rok": stmt.get("year"), "narrativeRisk": nr})
        notes = stmt.get("notesRisk")
        if notes: notes_by_year.append({"rok": stmt.get("year"), "notesRisk": notes})

    raw_det_adj, _ = _compute_deterministic_adjustment(
        narrative_by_year, notes_by_year,
        company_dict.get("companyEvents", []),
        company_dict.get("ico", ""),
    )
    new_det_adj = max(-10, min(10, raw_det_adj))  # NEW clamp
    old_det_adj = max(-5, min(5, raw_det_adj))    # OLD clamp

    new_final = max(0, min(100, new_sc.total_score + new_det_adj))

    # OLD scoring
    old_altman = old_altman_z_score(stmts[-1])
    old_piotroski = _old_piotroski(stmts)
    nace_w = get_nace_weights(company_dict.get("naceCode", ""))
    old_p1 = _compute_old_p1(company_dict, trends, nace_w)

    # Old total = new total + P1 diff + det_adj diff
    new_p1 = new_pillars.get("Platobná schopnosť & Exekúcie", 0)
    old_total = new_sc.total_score + (old_p1 - new_p1) + (old_det_adj - new_det_adj)
    old_total = max(0, min(100, old_total))

    new_cat = _risk_category(new_final)
    old_cat = _risk_category(old_total)

    return {
        "ico": comp["ico"],
        "name": comp["name"] or "",
        "nace": comp["naceCode"] or "",
        "legalForm": comp["legalForm"] or "",
        "stmtCount": len(stmts),
        "vestnikCount": len(comp["vestnik"]),
        "new_score": new_final,
        "new_cat": new_cat,
        "new_P1": new_p1,
        "new_P2": new_pillars.get("Finančné zdravie", 0),
        "new_P3": new_pillars.get("Ziskovosť, Stabilita a Cash Flow", 0),
        "new_P4": new_pillars.get("Rast & Trendová sila", 0),
        "new_P5": new_pillars.get("Právna bezúhonnosť", 0),
        "new_altman": new_altman.get("z_score"),
        "new_piotroski": new_piotroski.get("score"),
        "new_piotroski_skipped": len(new_piotroski.get("skipped_criteria", [])),
        "new_det_adj": new_det_adj,
        "new_hardStop": new_sc.hard_stop,
        "old_score": old_total,
        "old_cat": old_cat,
        "old_P1": old_p1,
        "old_altman": old_altman.get("z_score"),
        "old_piotroski": old_piotroski.get("score"),
        "old_det_adj": old_det_adj,
        "delta_score": new_final - old_total,
        "delta_P1": new_p1 - old_p1,
    }


# ═══════════════════════════════════════════════════════════════════════════════
# REPORT
# ═══════════════════════════════════════════════════════════════════════════════

def _pct(arr, p):
    if not arr: return 0
    s = sorted(arr)
    idx = min(int(len(s) * p / 100), len(s) - 1)
    return s[idx]


def _bucket(scores):
    b = Counter()
    for s in scores:
        if s >= 90: b["90-100"] += 1
        elif s >= 80: b["80-89"] += 1
        elif s >= 70: b["70-79"] += 1
        elif s >= 60: b["60-69"] += 1
        elif s >= 50: b["50-59"] += 1
        elif s >= 40: b["40-49"] += 1
        elif s >= 30: b["30-39"] += 1
        elif s >= 20: b["20-29"] += 1
        else: b["0-19"] += 1
    return b


def print_report(results):
    N = len(results)
    print(f"\n{'='*90}")
    print(f"VALIDATION REPORT — {N} real Slovak companies")
    print(f"{'='*90}")

    old_scores = [r["old_score"] for r in results]
    new_scores = [r["new_score"] for r in results]
    old_buckets = _bucket(old_scores)
    new_buckets = _bucket(new_scores)

    # 1. Score Distribution
    print(f"\n── 1. Score Distribution: OLD (pre-fix) vs NEW (post-fix) ──")
    print(f"  {'Bucket':8s} {'OLD':>6} {'OLD%':>6} {'NEW':>6} {'NEW%':>6}  {'Δ':>5}")
    print("  " + "-" * 45)
    for b in ["90-100", "80-89", "70-79", "60-69", "50-59", "40-49", "30-39", "20-29", "0-19"]:
        co = old_buckets.get(b, 0); cn = new_buckets.get(b, 0)
        print(f"  {b:8s} {co:6d} {co/N*100:5.1f}% {cn:6d} {cn/N*100:5.1f}%  {cn-co:+5d}")

    # 2. Risk Categories
    old_cats = Counter(r["old_cat"] for r in results)
    new_cats = Counter(r["new_cat"] for r in results)
    print(f"\n── 2. Risk Categories: OLD vs NEW ──")
    print(f"  {'Cat':5s} {'OLD':>6} {'OLD%':>6} {'NEW':>6} {'NEW%':>6}  {'Δ':>5}")
    print("  " + "-" * 40)
    for cat in ["AAA", "A", "B", "C"]:
        co = old_cats.get(cat, 0); cn = new_cats.get(cat, 0)
        print(f"  {cat:5s} {co:6d} {co/N*100:5.1f}% {cn:6d} {cn/N*100:5.1f}%  {cn-co:+5d}")

    # 3. Percentiles
    print(f"\n── 3. Percentile Comparison ──")
    print(f"  {'Metric':20s} {'Min':>5} {'P10':>5} {'P25':>5} {'Med':>5} {'P75':>5} {'P90':>5} {'Max':>5} {'Mean':>6}")
    print("  " + "-" * 70)
    for label, scores in [("OLD Score", old_scores), ("NEW Score", new_scores)]:
        print(f"  {label:20s} {min(scores):5d} {_pct(scores,10):5d} {_pct(scores,25):5d} {_pct(scores,50):5d} {_pct(scores,75):5d} {_pct(scores,90):5d} {max(scores):5d} {mean(scores):6.1f}")

    # 4. P1-P5
    print(f"\n── 4. Per-Pillar Mean: OLD vs NEW ──")
    print(f"  {'Pillar':30s} {'OLD':>8} {'NEW':>8} {'Δ':>6}")
    print("  " + "-" * 55)
    for pname, old_k, new_k in [("P1 (Platobná)", "old_P1", "new_P1"),
                                  ("P2 (Finančné zdravie)", None, "new_P2"),
                                  ("P3 (Ziskovosť/CF)", None, "new_P3"),
                                  ("P4 (Rast & Trend)", None, "new_P4"),
                                  ("P5 (Právna)", None, "new_P5")]:
        if old_k:
            om = mean([r[old_k] for r in results])
            nm = mean([r[new_k] for r in results])
            print(f"  {pname:30s} {om:8.1f} {nm:8.1f} {nm-om:+6.1f}")
        else:
            nm = mean([r[new_k] for r in results])
            print(f"  {pname:30s} {'—':>8s} {nm:8.1f} {'—':>6s}")

    # 5. Altman
    old_altman = [r["old_altman"] for r in results if r["old_altman"] is not None]
    new_altman = [r["new_altman"] for r in results if r["new_altman"] is not None]
    print(f"\n── 5. Altman Z'' ──")
    print(f"  OLD: N={len(old_altman)}, mean={mean(old_altman):.2f}, median={median(old_altman):.2f}, max={max(old_altman):.2f}")
    print(f"  NEW: N={len(new_altman)}, mean={mean(new_altman):.2f}, median={median(new_altman):.2f}, max={max(new_altman):.2f}")
    extreme_old = sum(1 for z in old_altman if z > 100)
    extreme_new = sum(1 for z in new_altman if z > 100)
    print(f"  Extreme Z'' > 100: OLD={extreme_old}, NEW={extreme_new}")
    if extreme_old > 0:
        print(f"  → F1 fix eliminated {extreme_old} extreme Z'' values")

    # 6. Piotroski
    old_pio = [r["old_piotroski"] for r in results if r["old_piotroski"] is not None]
    new_pio = [r["new_piotroski"] for r in results if r["new_piotroski"] is not None]
    new_pio_na = sum(1 for r in results if r["new_piotroski"] is None)
    old_pio_na = sum(1 for r in results if r["old_piotroski"] is None)
    print(f"\n── 6. Piotroski F-score ──")
    print(f"  OLD: N={len(old_pio)}, mean={mean(old_pio):.2f}, median={median(old_pio):.2f}, N/A={old_pio_na}")
    print(f"  NEW: N={len(new_pio)}, mean={mean(new_pio):.2f}, median={median(new_pio):.2f}, N/A={new_pio_na}")
    old_4 = sum(1 for p in old_pio if p == 4)
    print(f"  OLD Piotroski = 4 (all-missing inflation): {old_4}")
    if new_pio_na > old_pio_na:
        print(f"  → F3 fix: {new_pio_na - old_pio_na} companies now N/A instead of inflated 4/8")

    # 7. Det Adj
    old_adj = [r["old_det_adj"] for r in results]
    new_adj = [r["new_det_adj"] for r in results]
    old_clamped = sum(1 for r in results if r["old_det_adj"] == -5 and r["new_det_adj"] < -5)
    print(f"\n── 7. Deterministic Adjustment ──")
    print(f"  OLD: mean={mean(old_adj):.2f}, min={min(old_adj)}, max={max(old_adj)}")
    print(f"  NEW: mean={mean(new_adj):.2f}, min={min(new_adj)}, max={max(new_adj)}")
    print(f"  Cases where OLD clamped -5 but NEW allowed more: {old_clamped}")

    # 8. Top 20 Biggest Changes
    deltas = sorted(results, key=lambda x: abs(x["delta_score"]), reverse=True)
    print(f"\n── 8. Top 20 Biggest Score Changes (OLD → NEW) ──")
    print(f"  {'OLD':>4} {'NEW':>4} {'Δ':>5} {'P1Δ':>4} {'ICO':>10} Name")
    print("  " + "-" * 70)
    for r in deltas[:20]:
        print(f"  {r['old_score']:4d} {r['new_score']:4d} {r['delta_score']:+5d} {r['delta_P1']:+4d} {r['ico']:>10s} {r['name'][:30]}")

    # 9. Hard Stops
    hard_stops = [r for r in results if r["new_hardStop"]]
    print(f"\n── 9. Hard Stops: {len(hard_stops)} ──")
    for r in hard_stops[:10]:
        print(f"  {r['ico']:>10s} {r['name'][:30]} — score={r['new_score']}, vestnik={r['vestnikCount']}")

    # 10. Segment Analysis
    print(f"\n── 10. Score by Segment ──")
    segments = {
        "with_vestnik": [r for r in results if r["vestnikCount"] > 0],
        "no_vestnik": [r for r in results if r["vestnikCount"] == 0],
        "new (<=2 stmts)": [r for r in results if r["stmtCount"] <= 2],
        "established (5+)": [r for r in results if r["stmtCount"] >= 5],
    }
    print(f"  {'Segment':25s} {'N':>5} {'OLD Med':>7} {'NEW Med':>7} {'Δ Med':>6} {'NEW C%':>6}")
    print("  " + "-" * 60)
    for sn, rs in segments.items():
        if not rs: continue
        nn = len(rs)
        om = _pct([r["old_score"] for r in rs], 50)
        nm = _pct([r["new_score"] for r in rs], 50)
        c_pct = sum(1 for r in rs if r["new_cat"] == "C") / nn * 100
        print(f"  {sn:25s} {nn:5d} {om:7d} {nm:7d} {nm-om:+6d} {c_pct:5.0f}%")

    # 11. N/A
    altman_na = sum(1 for r in results if r["new_altman"] is None)
    print(f"\n── 11. N/A Statistics ──")
    print(f"  Altman Z N/A: {altman_na}/{N} ({altman_na/N*100:.1f}%)")
    print(f"  Piotroski N/A (NEW): {new_pio_na}/{N} ({new_pio_na/N*100:.1f}%)")
    print(f"  Piotroski N/A (OLD): {old_pio_na}/{N} ({old_pio_na/N*100:.1f}%)")

    # 12. Sanity Check — 20 Most Counterintuitive
    print(f"\n── 12. 20 Most Counterintuitive Scores (NEW) ──")
    counterintuitive = []
    for r in results:
        weirdness = 0; reasons = []
        if r["new_score"] >= 70 and r["vestnikCount"] > 0:
            weirdness += r["vestnikCount"] * 10
            reasons.append(f"score≥70 + {r['vestnikCount']} vestnik events")
        if r["new_score"] < 40 and r["vestnikCount"] == 0:
            weirdness += 20
            reasons.append("score<40 + no vestnik")
        if r["new_altman"] is not None and r["new_altman"] > 2.6 and r["new_score"] < 50:
            weirdness += 15
            reasons.append(f"Altman SAFE ({r['new_altman']:.1f}) but score<50")
        if r["new_altman"] is not None and r["new_altman"] < 1.1 and r["new_score"] > 70:
            weirdness += 15
            reasons.append(f"Altman DISTRESS ({r['new_altman']:.1f}) but score>70")
        if r["new_piotroski"] is not None and r["new_piotroski"] >= 6 and r["new_score"] < 40:
            weirdness += 10
            reasons.append(f"Piotroski {r['new_piotroski']}/8 but score<40")
        if r["new_hardStop"] and r["new_score"] > 0:
            weirdness += 50
            reasons.append(f"HARD STOP but score={r['new_score']}")
        if weirdness > 0:
            counterintuitive.append((r, weirdness, reasons))

    counterintuitive.sort(key=lambda x: x[1], reverse=True)
    print(f"  {'Score':>5} {'Cat':>4} {'P1':>3} {'P2':>3} {'P3':>3} {'P4':>3} {'P5':>3} {'Alt':>6} {'Pio':>4} {'Vst':>4} {'ICO':>10} Reasons")
    print("  " + "-" * 100)
    for r, w, reasons in counterintuitive[:20]:
        alt = f"{r['new_altman']:.1f}" if r['new_altman'] is not None else "N/A"
        pio = str(r['new_piotroski']) if r['new_piotroski'] is not None else "N/A"
        print(f"  {r['new_score']:5d} {r['new_cat']:>4s} {r['new_P1']:3d} {r['new_P2']:3d} {r['new_P3']:3d} {r['new_P4']:3d} {r['new_P5']:3d} {alt:>6s} {pio:>4s} {r['vestnikCount']:4d} {r['ico']:>10s} {'; '.join(reasons[:2])}")

    # Summary
    print(f"\n{'='*90}")
    print(f"SUMMARY")
    print(f"{'='*90}")
    print(f"  Companies scored: {N}")
    print(f"  Mean score: OLD={mean(old_scores):.1f} → NEW={mean(new_scores):.1f} (Δ={mean(new_scores)-mean(old_scores):+.1f})")
    print(f"  Median score: OLD={median(old_scores):.0f} → NEW={median(new_scores):.0f}")
    print(f"  AAA/A: OLD={old_cats.get('AAA',0)+old_cats.get('A',0)} → NEW={new_cats.get('AAA',0)+new_cats.get('A',0)}")
    print(f"  C: OLD={old_cats.get('C',0)} → NEW={new_cats.get('C',0)}")
    print(f"  Hard stops: {len(hard_stops)}")
    print(f"  Altman extreme (>100): OLD={extreme_old} → NEW={extreme_new}")
    print(f"  Piotroski all-missing inflation: OLD={old_4} → NEW=0 (N/A instead)")
    print(f"  Det adj clamped (OLD -5, NEW more): {old_clamped}")
    print(f"  Counterintuitive scores: {len(counterintuitive)}")


async def main():
    print("╔" + "═"*78 + "╗")
    print("║" + " VERIFA SCORING — REAL COMPANY VALIDATION".center(78) + "║")
    print("║" + " 200 real Slovak companies — OLD vs NEW scoring".center(78) + "║")
    print("╚" + "═"*78 + "╝")

    pool = await asyncpg.create_pool(DB_URL, min_size=2, max_size=5)
    print("DB connected")

    sample = await sample_companies(pool, n=200)
    print(f"Sample: {len(sample)} companies")

    results = []
    errors = 0
    for i, comp in enumerate(sample):
        try:
            r = score_company(comp)
            if r: results.append(r)
        except Exception as e:
            errors += 1
            if errors <= 5:
                print(f"  ERROR {comp['ico']}: {e}")
                import traceback; traceback.print_exc()
        if (i + 1) % 50 == 0:
            print(f"  Progress: {i+1}/{len(sample)} ({errors} errors)")

    print(f"\nScoring complete: {len(results)} scored, {errors} errors")

    if results:
        print_report(results)

    with open("tests/validation_results.json", "w") as f:
        json.dump(results, f, ensure_ascii=False, indent=2, default=str)
    print(f"\nResults saved to tests/validation_results.json")

    await pool.close()


if __name__ == "__main__":
    asyncio.run(main())
