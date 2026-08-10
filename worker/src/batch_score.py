"""
Batch V2 vs V3 A/B comparison — diagnostický run nad všetkými firmami s ≥2 výkazmi.

V2: pôvodný model s DQ multiplier
V3: availability mask + renormalization + entity classifier + DQ separation

Usage:
    cd worker && python -m src.batch_score --dry-run
"""

import argparse
import asyncio
import json
import logging
import re
import time
from collections import Counter, defaultdict
from statistics import median, mean

from prisma import Prisma

from src.analytics import (
    compute_financial_trends,
    compute_forensic_scorecard,
    compute_forensic_scorecard_v3,
    classify_entity_type,
    sanitize_cash_flow_fields,
)

logging.basicConfig(level=logging.WARNING, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger(__name__)

SCORING_VERSION = "v3-candidate"

STMT_FIELDS = (
    'year', 'mainActivityRevenue', 'netProfitLoss', 'totalAssets', 'equity',
    'shortTermLiabilities', 'longTermLiabilities', 'staffCosts', 'depreciation',
    'interestExpense', 'incomeTax', 'operatingCashFlow', 'investingCashFlow',
    'financingCashFlow', 'cashAndEquivalents', 'grossProfit', 'currentAssets',
    'inventory', 'tradeReceivables', 'tradePayables', 'socialInsuranceLiabilities',
    'taxLiabilities', 'employeeLiabilities', 'employeeCount', 'monthsInPeriod',
    'statementType', 'isConsolidated', 'auditorOpinion', 'narrativeRisk', 'notesRisk',
)

PILLAR_NAMES = [
    "Platobná schopnosť & Exekúcie",
    "Finančné zdravie",
    "Ziskovosť, Stabilita a Cash Flow",
    "Rast & Trendová sila",
    "Právna bezúhonnosť",
]


def _pct(arr, p):
    if not arr:
        return 0
    s = sorted(arr)
    idx = int(len(s) * p / 100)
    if idx >= len(s):
        idx = len(s) - 1
    return s[idx]


def _extract_dq_mult(pillars):
    for p in pillars:
        if p.name == "Data Quality Multiplier":
            m = re.search(r'(\d+\.\d+)', p.detail)
            if m:
                return float(m.group(1))
            return 1.0
    return 1.0


def _extract_pillar_scores(pillars):
    scores = {}
    for p in pillars:
        if p.name in PILLAR_NAMES:
            scores[p.name] = p.score
    return scores


def _extract_penalties(pillars):
    penalties = {}
    for p in pillars:
        if p.name not in PILLAR_NAMES and p.name != "Data Quality Multiplier":
            penalties[p.name] = p.score
    return penalties


async def run(dry_run: bool = False):
    db = Prisma()
    await db.connect()
    logger.info("DB connected")

    companies = await db.company.find_many(
        where={"financialStatements": {"some": {}}},
        include={
            "financialStatements": True,
            "vestnikEvents": True,
            "companyEvents": True,
        },
    )

    scoreable = [c for c in companies if len(c.financialStatements) >= 2]
    print(f"Companies with ≥2 statements: {len(scoreable)} (of {len(companies)} with any)")

    if not scoreable:
        print("No scoreable companies.")
        await db.disconnect()
        return

    results = []
    errors = 0
    start = time.time()

    for i, company in enumerate(scoreable):
        try:
            sorted_stmts = sorted(company.financialStatements, key=lambda s: s.year or 0)
            for s in sorted_stmts:
                sanitize_cash_flow_fields(s)

            company_dict = {
                "ico": company.ico,
                "name": company.name,
                "legalForm": company.legalForm,
                "naceCode": company.naceCode or "",
                "financialStatements": [
                    {f: getattr(s, f, None) for f in STMT_FIELDS}
                    for s in sorted_stmts
                ],
                "vestnikEvents": [
                    {"eventType": e.eventType, "severityLevel": e.severityLevel}
                    for e in (company.vestnikEvents or [])
                ],
                "companyEvents": [
                    {"source": e.source, "eventType": e.eventType, "severity": e.severity, "metadata": e.metadata, "createdAt": e.createdAt}
                    for e in (company.companyEvents or [])
                ],
            }

            trends = compute_financial_trends(sorted_stmts)

            # ── V2 scoring ──
            scorecard_v2 = compute_forensic_scorecard(company_dict, trends)
            ps_v2 = _extract_pillar_scores(scorecard_v2.pillars)
            dq_mult = _extract_dq_mult(scorecard_v2.pillars)
            penalties = _extract_penalties(scorecard_v2.pillars)
            base_score_v2 = sum(ps_v2.values())
            final_score_v2 = scorecard_v2.total_score
            dq_adj = int(round(base_score_v2 * dq_mult)) - base_score_v2 if dq_mult < 1.0 else 0
            penalty_total = sum(penalties.values())

            # ── V3 scoring ──
            scorecard_v3 = compute_forensic_scorecard_v3(company_dict, trends)
            ps_v3 = {p.name: p.score for p in scorecard_v3.pillars}

            # Data availability flags
            has_pnl = any(
                getattr(s, 'mainActivityRevenue', None) is not None or
                getattr(s, 'netProfitLoss', None) is not None
                for s in sorted_stmts
            )
            has_cashflow = any(
                getattr(s, 'operatingCashFlow', None) is not None
                for s in sorted_stmts
            )
            has_audit = any(
                getattr(s, 'auditorOpinion', None) is not None
                for s in sorted_stmts
            )

            results.append({
                "ico": company.ico,
                "name": company.name,
                "legalForm": company.legalForm,
                # V2
                "v2_finalScore": final_score_v2,
                "v2_baseScore": base_score_v2,
                "v2_dqMult": dq_mult,
                "v2_dqAdj": dq_adj,
                "v2_penaltyTotal": penalty_total,
                "v2_hardStop": scorecard_v2.hard_stop,
                "v2_riskCategory": scorecard_v2.risk_category,
                "v2_P1": ps_v2.get("Platobná schopnosť & Exekúcie", 0),
                "v2_P2": ps_v2.get("Finančné zdravie", 0),
                "v2_P3": ps_v2.get("Ziskovosť, Stabilita a Cash Flow", 0),
                "v2_P4": ps_v2.get("Rast & Trendová sila", 0),
                "v2_P5": ps_v2.get("Právna bezúhonnosť", 0),
                # V3
                "v3_finScore": scorecard_v3.financial_score,
                "v3_dqScore": scorecard_v3.data_quality_score,
                "v3_riskCat": scorecard_v3.risk_category,
                "v3_riskLevel": scorecard_v3.risk_level,
                "v3_entityType": scorecard_v3.entity_type,
                "v3_hardStop": scorecard_v3.hard_stop,
                "v3_P1": ps_v3.get("Platobná schopnosť & Exekúcie", 0),
                "v3_P2": ps_v3.get("Finančné zdravie", 0),
                "v3_P3": ps_v3.get("Ziskovosť, Stabilita a Cash Flow", 0),
                "v3_P4": ps_v3.get("Rast & Trendová sila", 0),
                "v3_P5": ps_v3.get("Právna bezúhonnosť", 0),
                # Common
                "stmtCount": len(sorted_stmts),
                "hasPnL": has_pnl,
                "hasCashFlow": has_cashflow,
                "hasAudit": has_audit,
            })

            if (i + 1) % 500 == 0:
                elapsed = time.time() - start
                print(f"  Progress: {i+1}/{len(scoreable)} ({(i+1)/elapsed:.0f}/s, errors={errors})")

        except Exception as e:
            errors += 1
            if errors <= 5:
                import traceback
                print(f"  ERROR {company.ico}: {e}")
                traceback.print_exc()
            continue

    elapsed = time.time() - start
    print(f"\nScoring complete: {len(results)} scored, {errors} errors, {elapsed:.1f}s\n")

    # ════════════════════════════════════════════════════════════════════════
    # A/B COMPARISON REPORT: V2 vs V3
    # ════════════════════════════════════════════════════════════════════════
    N = len(results)
    print("=" * 90)
    print("V2 vs V3 A/B COMPARISON REPORT")
    print("=" * 90)
    print(f"  Companies scored: {N} | Errors: {errors} | Elapsed: {elapsed:.1f}s")

    v2_final = [r["v2_finalScore"] for r in results]
    v2_base = [r["v2_baseScore"] for r in results]
    v3_fin = [r["v3_finScore"] for r in results]
    v3_dq = [r["v3_dqScore"] for r in results]

    # ── 1. Score Distribution Side-by-Side ──
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

    v2_buckets = _bucket(v2_final)
    v3_buckets = _bucket(v3_fin)

    print("\n── Score Distribution: V2 Final vs V3 Financial ──")
    print(f"  {'Bucket':8s} {'V2':>6} {'V2%':>6} {'V3':>6} {'V3%':>6}  {'Δ':>5}")
    print("  " + "-" * 45)
    for b in ["90-100", "80-89", "70-79", "60-69", "50-59", "40-49", "30-39", "20-29", "0-19"]:
        c2 = v2_buckets.get(b, 0)
        c3 = v3_buckets.get(b, 0)
        print(f"  {b:8s} {c2:6d} {c2/N*100:5.1f}% {c3:6d} {c3/N*100:5.1f}%  {c3-c2:+5d}")

    # ── 2. Risk Categories ──
    v2_risk = Counter(r["v2_riskCategory"] for r in results)
    v3_risk = Counter(r["v3_riskCat"] for r in results)
    print("\n── Risk Categories: V2 vs V3 ──")
    print(f"  {'Cat':5s} {'V2':>6} {'V2%':>6} {'V3':>6} {'V3%':>6}  {'Δ':>5}")
    print("  " + "-" * 40)
    for cat in ["AAA", "A", "B", "C"]:
        c2 = v2_risk.get(cat, 0)
        c3 = v3_risk.get(cat, 0)
        print(f"  {cat:5s} {c2:6d} {c2/N*100:5.1f}% {c3:6d} {c3/N*100:5.1f}%  {c3-c2:+5d}")

    # V3 Risk Levels
    v3_levels = Counter(r["v3_riskLevel"] for r in results)
    print("\n── V3 Risk Levels ──")
    for lvl in ["LOW", "MEDIUM", "HIGH", "CRITICAL"]:
        c = v3_levels.get(lvl, 0)
        print(f"  {lvl:10s} {c:5d} ({c/N*100:5.1f}%)")

    # ── 3. Percentile Comparison ──
    print("\n── Percentile Comparison ──")
    print(f"  {'Metric':20s} {'Min':>5} {'P10':>5} {'P25':>5} {'Med':>5} {'P75':>5} {'P90':>5} {'Max':>5} {'Mean':>6}")
    print("  " + "-" * 70)
    print(f"  {'V2 Base':20s} {min(v2_base):5d} {_pct(v2_base,10):5d} {_pct(v2_base,25):5d} {_pct(v2_base,50):5d} {_pct(v2_base,75):5d} {_pct(v2_base,90):5d} {max(v2_base):5d} {mean(v2_base):6.1f}")
    print(f"  {'V2 Final':20s} {min(v2_final):5d} {_pct(v2_final,10):5d} {_pct(v2_final,25):5d} {_pct(v2_final,50):5d} {_pct(v2_final,75):5d} {_pct(v2_final,90):5d} {max(v2_final):5d} {mean(v2_final):6.1f}")
    print(f"  {'V3 Financial':20s} {min(v3_fin):5d} {_pct(v3_fin,10):5d} {_pct(v3_fin,25):5d} {_pct(v3_fin,50):5d} {_pct(v3_fin,75):5d} {_pct(v3_fin,90):5d} {max(v3_fin):5d} {mean(v3_fin):6.1f}")
    print(f"  {'V3 Data Quality':20s} {min(v3_dq):5d} {_pct(v3_dq,10):5d} {_pct(v3_dq,25):5d} {_pct(v3_dq,50):5d} {_pct(v3_dq,75):5d} {_pct(v3_dq,90):5d} {max(v3_dq):5d} {mean(v3_dq):6.1f}")

    # ── 4. Per-Pillar Comparison ──
    print("\n── Per-Pillar Mean: V2 vs V3 ──")
    print(f"  {'Pillar':30s} {'V2 Mean':>8} {'V3 Mean':>8} {'Δ':>6}")
    print("  " + "-" * 55)
    for pname, v2k, v3k in [("P1 (Platobná schopnosť)", "v2_P1", "v3_P1"),
                              ("P2 (Finančné zdravie)", "v2_P2", "v3_P2"),
                              ("P3 (Ziskovosť/CF)", "v2_P3", "v3_P3"),
                              ("P4 (Rast & Trend)", "v2_P4", "v3_P4"),
                              ("P5 (Právna)", "v2_P5", "v3_P5")]:
        v2m = mean([r[v2k] for r in results])
        v3m = mean([r[v3k] for r in results])
        print(f"  {pname:30s} {v2m:8.1f} {v3m:8.1f} {v3m-v2m:+6.1f}")
    print(f"  {'TOTAL':30s} {mean(v2_final):8.1f} {mean(v3_fin):8.1f} {mean(v3_fin)-mean(v2_final):+6.1f}")

    # ── 5. Data Availability ──
    has_pnl_count = sum(1 for r in results if r["hasPnL"])
    has_cf_count = sum(1 for r in results if r["hasCashFlow"])
    has_audit_count = sum(1 for r in results if r["hasAudit"])
    print("\n── Data Availability ──")
    print(f"  Has P&L:       {has_pnl_count:5d} ({has_pnl_count/N*100:5.1f}%)")
    print(f"  Has Cash Flow: {has_cf_count:5d} ({has_cf_count/N*100:5.1f}%)")
    print(f"  Has Audit:     {has_audit_count:5d} ({has_audit_count/N*100:5.1f}%)")

    # V3 DQ Score distribution
    dq_buckets = Counter()
    for s in v3_dq:
        if s >= 80: dq_buckets["80-100"] += 1
        elif s >= 60: dq_buckets["60-79"] += 1
        elif s >= 40: dq_buckets["40-59"] += 1
        else: dq_buckets["0-39"] += 1
    print("\n── V3 Data Quality Score Distribution ──")
    for b in ["80-100", "60-79", "40-59", "0-39"]:
        c = dq_buckets.get(b, 0)
        print(f"  {b:8s} {c:5d} ({c/N*100:5.1f}%)")

    # ── 6. Segment Comparison ──
    segments = {"commercial": [], "public": [], "nonprofit": [], "other": []}
    for r in results:
        segments[r["v3_entityType"]].append(r)

    print("\n── Score by Segment: V2 vs V3 ──")
    print(f"  {'Segment':12s} {'N':>5} {'V2 Med':>7} {'V3 Med':>7} {'Δ Med':>6} {'V2 C%':>6} {'V3 C%':>6} {'V3 DQ':>6}")
    print("  " + "-" * 65)
    for sn in ["commercial", "public", "nonprofit", "other"]:
        rs = segments[sn]
        if not rs:
            continue
        nn = len(rs)
        v2_med = _pct([r["v2_finalScore"] for r in rs], 50)
        v3_med = _pct([r["v3_finScore"] for r in rs], 50)
        v2_c = sum(1 for r in rs if r["v2_riskCategory"] == "C") / nn * 100
        v3_c = sum(1 for r in rs if r["v3_riskCat"] == "C") / nn * 100
        v3_dq_avg = mean([r["v3_dqScore"] for r in rs])
        print(f"  {sn:12s} {nn:5d} {v2_med:7d} {v3_med:7d} {v3_med-v2_med:+6d} {v2_c:5.0f}% {v3_c:5.0f}% {v3_dq_avg:6.1f}")

    # ── 7. Legal Form Comparison ──
    by_form = defaultdict(list)
    for r in results:
        lf = r["legalForm"] or "(prázdne)"
        by_form[lf].append(r)

    print("\n── Score by Legal Form: V2 vs V3 ──")
    print(f"  {'Legal Form':30s} {'N':>5} {'V2 Med':>7} {'V3 Med':>7} {'Δ':>5} {'V2 C%':>6} {'V3 C%':>6} {'V3 DQ':>6}")
    print("  " + "-" * 80)
    for lf, rs in sorted(by_form.items(), key=lambda x: -len(x[1])):
        if len(rs) < 3:
            continue
        nn = len(rs)
        v2_med = _pct([r["v2_finalScore"] for r in rs], 50)
        v3_med = _pct([r["v3_finScore"] for r in rs], 50)
        v2_c = sum(1 for r in rs if r["v2_riskCategory"] == "C") / nn * 100
        v3_c = sum(1 for r in rs if r["v3_riskCat"] == "C") / nn * 100
        v3_dq_avg = mean([r["v3_dqScore"] for r in rs])
        print(f"  {lf:30s} {nn:5d} {v2_med:7d} {v3_med:7d} {v3_med-v2_med:+5d} {v2_c:5.0f}% {v3_c:5.0f}% {v3_dq_avg:6.1f}")

    # ── 8. Score by Statement Count ──
    print("\n── Score by Statement Count: V2 vs V3 ──")
    stmt_buckets = {"2": [], "3-4": [], "5+": []}
    for r in results:
        n = r["stmtCount"]
        if n == 2: stmt_buckets["2"].append(r)
        elif n <= 4: stmt_buckets["3-4"].append(r)
        else: stmt_buckets["5+"].append(r)

    print(f"  {'Stmts':8s} {'N':>5} {'V2 Med':>7} {'V3 Med':>7} {'Δ':>5} {'V3 DQ':>6}")
    print("  " + "-" * 40)
    for bn in ["2", "3-4", "5+"]:
        rs = stmt_buckets[bn]
        if not rs:
            continue
        nn = len(rs)
        v2_med = _pct([r["v2_finalScore"] for r in rs], 50)
        v3_med = _pct([r["v3_finScore"] for r in rs], 50)
        v3_dq_avg = mean([r["v3_dqScore"] for r in rs])
        print(f"  {bn:8s} {nn:5d} {v2_med:7d} {v3_med:7d} {v3_med-v2_med:+5d} {v3_dq_avg:6.1f}")

    # ── 9. Top 20 Safest — V3 ──
    print("\n── Top 20 Safest (V3 Financial Score, with P1-P5 + DQ) ──")
    print(f"  {'V3':>4} {'V2':>4} {'DQ':>4} {'P1':>4} {'P2':>4} {'P3':>4} {'P4':>4} {'P5':>4} {'Type':>10} {'ICO':>10} Name")
    print("  " + "-" * 90)
    for r in sorted(results, key=lambda x: -x["v3_finScore"])[:20]:
        print(f"  {r['v3_finScore']:4d} {r['v2_finalScore']:4d} {r['v3_dqScore']:4d} {r['v3_P1']:4d} {r['v3_P2']:4d} {r['v3_P3']:4d} {r['v3_P4']:4d} {r['v3_P5']:4d} {r['v3_entityType']:>10s} {r['ico']:>10s} {r['name'] or ''}")

    # ── 10. Top 20 Riskiest — V3 ──
    print("\n── Top 20 Riskiest (V3 Financial Score, with P1-P5 + DQ) ──")
    print(f"  {'V3':>4} {'V2':>4} {'DQ':>4} {'P1':>4} {'P2':>4} {'P3':>4} {'P4':>4} {'P5':>4} {'Type':>10} {'ICO':>10} Name")
    print("  " + "-" * 90)
    for r in sorted(results, key=lambda x: x["v3_finScore"])[:20]:
        print(f"  {r['v3_finScore']:4d} {r['v2_finalScore']:4d} {r['v3_dqScore']:4d} {r['v3_P1']:4d} {r['v3_P2']:4d} {r['v3_P3']:4d} {r['v3_P4']:4d} {r['v3_P5']:4d} {r['v3_entityType']:>10s} {r['ico']:>10s} {r['name'] or ''}")

    # ── 11. Biggest Score Changes (V2 → V3) ──
    deltas = [(r, r["v3_finScore"] - r["v2_finalScore"]) for r in results]
    print("\n── Top 20 Biggest Improvements (V2 → V3) ──")
    print(f"  {'V2':>4} {'V3':>4} {'Δ':>5} {'DQ':>4} {'Type':>10} {'ICO':>10} Name")
    print("  " + "-" * 70)
    for r, d in sorted(deltas, key=lambda x: -x[1])[:20]:
        print(f"  {r['v2_finalScore']:4d} {r['v3_finScore']:4d} {d:+5d} {r['v3_dqScore']:4d} {r['v3_entityType']:>10s} {r['ico']:>10s} {r['name'] or ''}")

    print("\n── Top 20 Biggest Decreases (V2 → V3) ──")
    print(f"  {'V2':>4} {'V3':>4} {'Δ':>5} {'DQ':>4} {'Type':>10} {'ICO':>10} Name")
    print("  " + "-" * 70)
    for r, d in sorted(deltas, key=lambda x: x[1])[:20]:
        print(f"  {r['v2_finalScore']:4d} {r['v3_finScore']:4d} {d:+5d} {r['v3_dqScore']:4d} {r['v3_entityType']:>10s} {r['ico']:>10s} {r['name'] or ''}")

    # ── 12. Hard stops ──
    hard_stops = [r for r in results if r["v3_hardStop"] or r["v2_hardStop"]]
    if hard_stops:
        print(f"\n── Hard Stops: {len(hard_stops)} ──")
        for r in hard_stops[:10]:
            print(f"  {r['ico']} {r['name'] or ''}")

    # ════════════════════════════════════════════════════════════════════════
    # CASE-STUDY REPORT — Detailed per-company analysis
    # ════════════════════════════════════════════════════════════════════════
    print("\n" + "=" * 90)
    print("CASE-STUDY REPORT — Detailed Per-Company Analysis")
    print("=" * 90)

    def _avail_str(r):
        flags = []
        flags.append("BS" if r.get("hasBalance", True) else "—")
        flags.append("P&L" if r["hasPnL"] else "—")
        flags.append("CF" if r["hasCashFlow"] else "—")
        flags.append("AU" if r["hasAudit"] else "—")
        return " ".join(flags)

    def _reason(r):
        """Determine reason for V2→V3 delta."""
        delta = r["v3_finScore"] - r["v2_finalScore"]
        reasons = []
        if r["v2_dqMult"] < 1.0:
            reasons.append(f"DQ×{r['v2_dqMult']:.2f} removed")
        if not r["hasPnL"]:
            reasons.append("No P&L → N/A not 0")
        if not r["hasCashFlow"]:
            reasons.append("No CF → N/A not 0")
        if r["v3_entityType"] != "commercial":
            reasons.append(f"Entity={r['v3_entityType']} (Altman N/A)")
        # P1 change
        p1_d = r["v3_P1"] - r["v2_P1"]
        if p1_d > 2:
            reasons.append(f"P1 +{p1_d} (renorm)")
        elif p1_d < -2:
            reasons.append(f"P1 {p1_d}")
        p2_d = r["v3_P2"] - r["v2_P2"]
        if p2_d > 2:
            reasons.append(f"P2 +{p2_d}")
        elif p2_d < -2:
            reasons.append(f"P2 {p2_d}")
        p3_d = r["v3_P3"] - r["v2_P3"]
        if p3_d > 2:
            reasons.append(f"P3 +{p3_d}")
        elif p3_d < -2:
            reasons.append(f"P3 {p3_d}")
        p4_d = r["v3_P4"] - r["v2_P4"]
        if p4_d > 2:
            reasons.append(f"P4 +{p4_d}")
        elif p4_d < -2:
            reasons.append(f"P4 {p4_d}")
        if not reasons:
            reasons.append("minimal change")
        return " | ".join(reasons)

    def _print_case(r, label=""):
        print(f"  {label}")
        print(f"    ICO: {r['ico']}  Name: {r['name'] or ''}")
        print(f"    Legal: {r['legalForm']}  Type: {r['v3_entityType']}  Stmts: {r['stmtCount']}")
        print(f"    V2: base={r['v2_baseScore']} final={r['v2_finalScore']} DQ×{r['v2_dqMult']:.2f} cat={r['v2_riskCategory']}")
        print(f"    V3: fin={r['v3_finScore']} DQ={r['v3_dqScore']} cat={r['v3_riskCat']} risk={r['v3_riskLevel']}")
        print(f"    P1: V2={r['v2_P1']} V3={r['v3_P1']}  P2: V2={r['v2_P2']} V3={r['v3_P2']}  P3: V2={r['v2_P3']} V3={r['v3_P3']}")
        print(f"    P4: V2={r['v2_P4']} V3={r['v3_P4']}  P5: V2={r['v2_P5']} V3={r['v3_P5']}")
        print(f"    Avail: [{_avail_str(r)}]  Δ={r['v3_finScore']-r['v2_finalScore']:+d}")
        print(f"    Reason: {_reason(r)}")
        print()

    # ── A. Top 20 Improvements ──
    print("\n── A. Top 20 Improvements (V2→V3) ──\n")
    for r in sorted(results, key=lambda x: -(x["v3_finScore"] - x["v2_finalScore"]))[:20]:
        _print_case(r, f"Δ=+{r['v3_finScore']-r['v2_finalScore']}")

    # ── B. Top 20 Regressions ──
    print("── B. Top 20 Regressions (V2→V3) ──\n")
    for r in sorted(results, key=lambda x: x["v3_finScore"] - x["v2_finalScore"])[:20]:
        _print_case(r, f"Δ={r['v3_finScore']-r['v2_finalScore']:+d}")

    # ── C. Top 20 Highest V3 ──
    print("── C. Top 20 Highest V3 Financial Score ──\n")
    for r in sorted(results, key=lambda x: -x["v3_finScore"])[:20]:
        _print_case(r, f"V3={r['v3_finScore']}")

    # ── D. Top 20 Lowest V3 (non-hard-stop) ──
    print("── D. Top 20 Lowest V3 Financial Score (excl. hard stop) ──\n")
    for r in sorted([x for x in results if not x["v3_hardStop"]], key=lambda x: x["v3_finScore"])[:20]:
        _print_case(r, f"V3={r['v3_finScore']}")

    # ── E. 20 Healthy Commercial (V3 ≥ 60, commercial) ──
    healthy_comm = [r for r in results if r["v3_entityType"] == "commercial" and r["v3_finScore"] >= 60]
    print(f"── E. 20 Healthy Commercial (V3≥60, n={len(healthy_comm)}) ──\n")
    for r in sorted(healthy_comm, key=lambda x: -x["v3_finScore"])[:20]:
        _print_case(r, f"V3={r['v3_finScore']}")

    # ── F. 20 Problematic Commercial (V3 < 40, commercial) ──
    prob_comm = [r for r in results if r["v3_entityType"] == "commercial" and r["v3_finScore"] < 40 and not r["v3_hardStop"]]
    print(f"── F. 20 Problematic Commercial (V3<40, n={len(prob_comm)}) ──\n")
    for r in sorted(prob_comm, key=lambda x: x["v3_finScore"])[:20]:
        _print_case(r, f"V3={r['v3_finScore']}")

    # ── G. 20 Obce (public, sample) ──
    obce = [r for r in results if r["legalForm"] == "Obec"]
    print(f"── G. 20 Obce (n={len(obce)}, sample by V3 score) ──\n")
    # Take 10 highest and 10 lowest
    obce_sorted = sorted(obce, key=lambda x: -x["v3_finScore"])
    for r in obce_sorted[:10]:
        _print_case(r, f"V3={r['v3_finScore']} (high)")
    print("    ... (10 lowest) ...\n")
    for r in obce_sorted[-10:]:
        _print_case(r, f"V3={r['v3_finScore']} (low)")

    # ── H. 20 Družstvá (sample) ──
    druz = [r for r in results if r["legalForm"] == "Družstvo"]
    print(f"── H. 20 Družstvá (n={len(druz)}, sample by V3 score) ──\n")
    druz_sorted = sorted(druz, key=lambda x: -x["v3_finScore"])
    for r in druz_sorted[:10]:
        _print_case(r, f"V3={r['v3_finScore']} (high)")
    print("    ... (10 lowest) ...\n")
    for r in druz_sorted[-10:]:
        _print_case(r, f"V3={r['v3_finScore']} (low)")

    # ── 13. Not scored ──
    all_companies = await db.company.count()
    no_stmts = all_companies - len(scoreable)
    print(f"\n── Companies NOT Scored ──")
    print(f"  Total in DB:          {all_companies}")
    print(f"  With ≥2 statements:   {len(scoreable)} (scored)")
    print(f"  With 0-1 statements:  {no_stmts} (not scored)")

    print("=" * 90)

    await db.disconnect()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Batch V3 scoring")
    parser.add_argument("--dry-run", action="store_true", help="Score without writing to DB")
    args = parser.parse_args()
    asyncio.run(run(dry_run=args.dry_run))
