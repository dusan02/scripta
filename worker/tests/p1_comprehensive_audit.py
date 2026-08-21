"""
P1 Comprehensive Audit — 4 tests in one script:
  1. Fallback calibration (cross-tab + kvartil monotonicita)
  2. Top-100 / bottom-100 forensic audit + score/confidence divergencie
  3. Boundary audit 49/50, 69/70
  4. Score decile ranking validity (najdôležitejšie)

Loads population_results.json + enriches with DB financial ratios.

Usage:
    cd worker && python -m tests.p1_comprehensive_audit
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

DB_URL = "postgresql://verifa:verifa_dev_password@localhost:5432/verifa"


def _pct(arr, p):
    if not arr: return 0
    s = sorted(arr)
    idx = min(int(len(s) * p / 100), len(s) - 1)
    return s[idx]


def _safe_div(a, b):
    if a is None or b is None or b == 0: return None
    return a / b


async def main():
    print("╔" + "═"*78 + "╗")
    print("║" + " P1 COMPREHENSIVE AUDIT — 4 tests".center(78) + "║")
    print("║" + " Fallback cal | Top/Bottom 100 | Boundary | Decile".center(78) + "║")
    print("╚" + "═"*78 + "╝")

    # Load population results
    with open("tests/population_results.json") as f:
        pop = json.load(f)
    print(f"Loaded {len(pop)} companies from population_results.json")

    # Remove the 1 record with empty ICO
    pop = [r for r in pop if r["ico"]]
    print(f"Valid ICOs: {len(pop)}")

    # ════════════════════════════════════════════════════════════════════════════
    # ENRICH: Query DB for latest-year financial ratios
    # ════════════════════════════════════════════════════════════════════════════
    print("\nEnriching with DB financial ratios...")
    conn = await asyncpg.connect(DB_URL)

    icos = [r["ico"] for r in pop]
    # Process in batches of 500
    ratios_by_ico = {}
    batch_size = 500
    for i in range(0, len(icos), batch_size):
        batch = icos[i:i+batch_size]
        placeholders = ",".join(f"${j+1}" for j in range(len(batch)))
        rows = await conn.fetch(f"""
            SELECT DISTINCT ON (fs."companyIco")
                fs."companyIco",
                fs.year,
                fs."mainActivityRevenue"::float as revenue,
                fs."netProfitLoss"::float as profit,
                fs."totalAssets"::float as assets,
                fs.equity::float as equity,
                fs."shortTermLiabilities"::float as stl,
                fs."currentAssets"::float as ca,
                fs."operatingCashFlow"::float as ocf,
                fs."tradeReceivables"::float as receivables,
                fs."retainedEarnings"::float as retained
            FROM "FinancialStatement" fs
            WHERE fs."companyIco" IN ({placeholders})
            ORDER BY fs."companyIco", fs.year DESC
        """, *batch)
        for r in rows:
            rev = r["revenue"]
            profit = r["profit"]
            assets = r["assets"]
            equity = r["equity"]
            stl = r["stl"]
            ca = r["ca"]
            ocf = r["ocf"]
            receivables = r["receivables"]
            retained = r["retained"]

            ratios_by_ico[r["company_ico" if "company_ico" in r.keys() else "companyIco"]] = {
                "year": r["year"],
                "revenue": rev,
                "profit": profit,
                "assets": assets,
                "equity": equity,
                "stl": stl,
                "currentAssets": ca,
                "ocf": ocf,
                "receivables": receivables,
                "retained": retained,
                "roa_pct": _safe_div(profit, assets * 100) if profit is not None and assets else None,
                "roe_pct": _safe_div(profit, equity * 100) if profit is not None and equity and equity > 0 else None,
                "npm_pct": _safe_div(profit, rev * 100) if profit is not None and rev and rev > 0 else None,
                "equity_ratio": _safe_div(equity, assets) if equity is not None and assets else None,
                "debt_to_equity": _safe_div(assets - equity, equity) if equity is not None and equity > 0 and assets else None,
                "current_ratio": _safe_div(ca, stl) if ca is not None and stl and stl > 0 else None,
                "profitable": profit is not None and profit > 0,
                "positive_cf": ocf is not None and ocf > 0,
                "positive_equity": equity is not None and equity > 0,
            }
        if (i + batch_size) % 5000 == 0 or i + batch_size >= len(icos):
            print(f"  Enriched: {min(i+batch_size, len(icos))}/{len(icos)}")

    # Merge
    for r in pop:
        ico = r["ico"]
        if ico in ratios_by_ico:
            r.update(ratios_by_ico[ico])
        else:
            r["roa_pct"] = None
            r["roe_pct"] = None
            r["npm_pct"] = None
            r["equity_ratio"] = None
            r["debt_to_equity"] = None
            r["current_ratio"] = None
            r["profitable"] = None
            r["positive_cf"] = None
            r["positive_equity"] = None
            r["revenue"] = None
            r["profit"] = None
            r["equity"] = None
            r["assets"] = None

    enriched = sum(1 for r in pop if r.get("roa_pct") is not None)
    print(f"Enriched: {enriched}/{len(pop)} have ROA data")

    await conn.close()

    # ════════════════════════════════════════════════════════════════════════════
    # AUDIT 1: FALLBACK CALIBRATION
    # ════════════════════════════════════════════════════════════════════════════
    print(f"\n\n{'='*90}")
    print("AUDIT 1: FALLBACK CALIBRATION")
    print("="*90)

    # 1a. Cross-tab: Full P2 vs Fallback vs Data void
    groups = {
        "altman_piotroski": [r for r in pop if r["p2_method"] == "altman_piotroski"],
        "ratio_fallback": [r for r in pop if r["p2_method"] == "ratio_fallback"],
        "data_void": [r for r in pop if r["p2_method"] == "data_void"],
        "financial_inst": [r for r in pop if r["p2_method"] == "financial_institution"],
        "startup": [r for r in pop if r["p2_method"] == "startup"],
    }

    print(f"\n── 1a. Cross-tab: Full P2 vs Fallback vs Data void ──")
    print(f"  {'Method':22s} {'N':>6} {'MedP2':>6} {'MeanP2':>6} {'MedScore':>8} {'C%':>6} {'B%':>6} {'A%':>6} {'MedROA':>7} {'MedDE':>6} {'MedCR':>6} {'Prof%':>6}")
    for method in ["altman_piotroski", "ratio_fallback", "data_void", "financial_inst", "startup"]:
        rs = groups[method]
        if not rs: continue
        nn = len(rs)
        med_p2 = median([r["P2"] for r in rs])
        mean_p2 = mean([r["P2"] for r in rs])
        med_score = median([r["score"] for r in rs])
        c_pct = sum(1 for r in rs if r["cat"] == "C") / nn * 100
        b_pct = sum(1 for r in rs if r["cat"] == "B") / nn * 100
        a_pct = sum(1 for r in rs if r["cat"] in ("A", "AAA")) / nn * 100
        roas = [r["roa_pct"] for r in rs if r.get("roa_pct") is not None]
        des = [r["debt_to_equity"] for r in rs if r.get("debt_to_equity") is not None]
        crs = [r["current_ratio"] for r in rs if r.get("current_ratio") is not None]
        prof = [r["profitable"] for r in rs if r.get("profitable") is not None]
        med_roa = median(roas) if roas else 0
        med_de = median(des) if des else 0
        med_cr = median(crs) if crs else 0
        prof_pct = sum(1 for p in prof if p) / max(len(prof), 1) * 100
        print(f"  {method:22s} {nn:6d} {med_p2:6.0f} {mean_p2:6.1f} {med_score:8.0f} {c_pct:5.1f}% {b_pct:5.1f}% {a_pct:5.1f}% {med_roa:6.1f}% {med_de:5.1f} {med_cr:5.2f} {prof_pct:5.1f}%")

    # 1b. Fallback quartile monotonicity test
    print(f"\n── 1b. Fallback quartile monotonicity test ──")
    fb = groups["ratio_fallback"]
    # Build a simple quality composite: ROA + equity_ratio + (1/D/E) + CR + profitable
    def quality_score(r):
        q = 0
        roa = r.get("roa_pct")
        eq_r = r.get("equity_ratio")
        de = r.get("debt_to_equity")
        cr = r.get("current_ratio")
        prof = r.get("profitable")
        if roa is not None:
            if roa > 10: q += 4
            elif roa > 5: q += 3
            elif roa > 0: q += 2
            elif roa > -5: q += 1
        if eq_r is not None:
            if eq_r > 0.5: q += 4
            elif eq_r > 0.3: q += 3
            elif eq_r > 0.15: q += 2
            elif eq_r > 0: q += 1
        if de is not None:
            if de < 0.5: q += 4
            elif de < 1.0: q += 3
            elif de < 2.0: q += 2
            elif de < 5.0: q += 1
        if cr is not None:
            if cr > 2.0: q += 4
            elif cr > 1.5: q += 3
            elif cr > 1.0: q += 2
            elif cr > 0.5: q += 1
        if prof: q += 4
        return q

    fb_with_q = [(r, quality_score(r)) for r in fb]
    fb_with_q.sort(key=lambda x: x[1])

    # Split into quartiles
    n_fb = len(fb_with_q)
    q_size = n_fb // 4
    print(f"  N={n_fb}, quartile size={q_size}")
    print(f"  {'Quartile':10s} {'N':>5} {'QRange':>10} {'MedP2':>6} {'MedScore':>8} {'MedROA':>7} {'MedDE':>6} {'MedCR':>6} {'Prof%':>6} {'C%':>6}")

    monotonic_scores = []
    for qi in range(4):
        start = qi * q_size
        end = (qi + 1) * q_size if qi < 3 else n_fb
        qs = fb_with_q[start:end]
        rs = [x[0] for x in qs]
        q_vals = [x[1] for x in qs]
        nn = len(rs)
        med_p2 = median([r["P2"] for r in rs])
        med_score = median([r["score"] for r in rs])
        roas = [r["roa_pct"] for r in rs if r.get("roa_pct") is not None]
        des = [r["debt_to_equity"] for r in rs if r.get("debt_to_equity") is not None]
        crs = [r["current_ratio"] for r in rs if r.get("current_ratio") is not None]
        prof = [r["profitable"] for r in rs if r.get("profitable") is not None]
        med_roa = median(roas) if roas else 0
        med_de = median(des) if des else 0
        med_cr = median(crs) if crs else 0
        prof_pct = sum(1 for p in prof if p) / max(len(prof), 1) * 100
        c_pct = sum(1 for r in rs if r["cat"] == "C") / nn * 100
        q_range = f"{min(q_vals)}-{max(q_vals)}"
        print(f"  Q{qi+1:1d} (low)  {nn:5d} {q_range:>10} {med_p2:6.0f} {med_score:8.0f} {med_roa:6.1f}% {med_de:5.1f} {med_cr:5.2f} {prof_pct:5.1f}% {c_pct:5.1f}%")
        monotonic_scores.append(med_score)

    # Check monotonicity
    is_monotonic = all(monotonic_scores[i] <= monotonic_scores[i+1] for i in range(len(monotonic_scores)-1))
    print(f"\n  Monotonicity: {'✓ PASS' if is_monotonic else '✗ FAIL'}")
    print(f"  Quartile medians: {monotonic_scores}")
    if not is_monotonic:
        print(f"  ⚠ Fallback nie je monotónny — calibration bug!")

    # ════════════════════════════════════════════════════════════════════════════
    # AUDIT 2: TOP-100 / BOTTOM-100 + SCORE/CONFIDENCE DIVERGENCE
    # ════════════════════════════════════════════════════════════════════════════
    print(f"\n\n{'='*90}")
    print("AUDIT 2: TOP-100 / BOTTOM-100 + SCORE/CONFIDENCE DIVERGENCE")
    print("="*90)

    # 2a. Top 100
    pop_sorted_top = sorted(pop, key=lambda r: r["score"], reverse=True)
    top100 = pop_sorted_top[:100]
    print(f"\n── 2a. Top 100 (highest score) ──")
    print(f"  Score range: {top100[-1]['score']}-{top100[0]['score']}")
    print(f"  Median score: {median([r['score'] for r in top100]):.0f}")
    print(f"  Median confidence: {median([r['confidence'] for r in top100]):.0f}")
    print(f"  Cats: {Counter(r['cat'] for r in top100)}")
    print(f"  Median P1-P5: {median([r['P1'] for r in top100]):.0f} / {median([r['P2'] for r in top100]):.0f} / {median([r['P3'] for r in top100]):.0f} / {median([r['P4'] for r in top100]):.0f} / {median([r['P5'] for r in top100]):.0f}")
    print(f"  Median Altman: {median([r['altman'] for r in top100 if r['altman'] is not None]):.2f}" if any(r['altman'] is not None for r in top100) else "  Median Altman: N/A")
    print(f"  Median Piotroski: {median([r['piotroski'] for r in top100 if r['piotroski'] is not None]):.0f}" if any(r['piotroski'] is not None for r in top100) else "  Median Piotroski: N/A")
    print(f"  Median stmts: {median([r['stmtCount'] for r in top100]):.0f}")
    print(f"  Median ROA: {median([r['roa_pct'] for r in top100 if r.get('roa_pct') is not None]):.1f}%" if any(r.get('roa_pct') is not None for r in top100) else "  Median ROA: N/A")
    print(f"  P2 methods: {Counter(r['p2_method'] for r in top100)}")

    print(f"\n  Top 20 detail:")
    print(f"  {'#':>3} {'Score':>5} {'Cat':>3} {'Conf':>4} {'P1':>3} {'P2':>3} {'P3':>3} {'P4':>3} {'P5':>3} {'Alt':>6} {'Pio':>4} {'Stmts':>5} {'Method':>20s} {'ICO':>10s}")
    for i, r in enumerate(top100[:20]):
        alt = f"{r['altman']:.1f}" if r['altman'] is not None else "N/A"
        pio = f"{r['piotroski']:.0f}" if r['piotroski'] is not None else "N/A"
        print(f"  {i+1:3d} {r['score']:5d} {r['cat']:>3s} {r['confidence']:4d} {r['P1']:3d} {r['P2']:3d} {r['P3']:3d} {r['P4']:3d} {r['P5']:3d} {alt:>6s} {pio:>4s} {r['stmtCount']:5d} {r['p2_method']:>20s} {r['ico']:>10s}")

    # 2b. Bottom 100 (without hard stop)
    pop_sorted_bot = sorted([r for r in pop if not r["hardStop"]], key=lambda r: r["score"])
    bot100 = pop_sorted_bot[:100]
    print(f"\n── 2b. Bottom 100 (lowest score, no hard stop) ──")
    print(f"  Score range: {bot100[0]['score']}-{bot100[-1]['score']}")
    print(f"  Median score: {median([r['score'] for r in bot100]):.0f}")
    print(f"  Median confidence: {median([r['confidence'] for r in bot100]):.0f}")
    print(f"  Cats: {Counter(r['cat'] for r in bot100)}")
    print(f"  Median P1-P5: {median([r['P1'] for r in bot100]):.0f} / {median([r['P2'] for r in bot100]):.0f} / {median([r['P3'] for r in bot100]):.0f} / {median([r['P4'] for r in bot100]):.0f} / {median([r['P5'] for r in bot100]):.0f}")
    print(f"  Median Altman: {median([r['altman'] for r in bot100 if r['altman'] is not None]):.2f}" if any(r['altman'] is not None for r in bot100) else "  Median Altman: N/A")
    print(f"  Median Piotroski: {median([r['piotroski'] for r in bot100 if r['piotroski'] is not None]):.0f}" if any(r['piotroski'] is not None for r in bot100) else "  Median Piotroski: N/A")
    print(f"  Median stmts: {median([r['stmtCount'] for r in bot100]):.0f}")
    print(f"  Median ROA: {median([r['roa_pct'] for r in bot100 if r.get('roa_pct') is not None]):.1f}%" if any(r.get('roa_pct') is not None for r in bot100) else "  Median ROA: N/A")
    print(f"  P2 methods: {Counter(r['p2_method'] for r in bot100)}")

    print(f"\n  Bottom 20 detail:")
    print(f"  {'#':>3} {'Score':>5} {'Cat':>3} {'Conf':>4} {'P1':>3} {'P2':>3} {'P3':>3} {'P4':>3} {'P5':>3} {'Alt':>6} {'Pio':>4} {'Stmts':>5} {'Method':>20s} {'ICO':>10s}")
    for i, r in enumerate(bot100[:20]):
        alt = f"{r['altman']:.1f}" if r['altman'] is not None else "N/A"
        pio = f"{r['piotroski']:.0f}" if r['piotroski'] is not None else "N/A"
        print(f"  {i+1:3d} {r['score']:5d} {r['cat']:>3s} {r['confidence']:4d} {r['P1']:3d} {r['P2']:3d} {r['P3']:3d} {r['P4']:3d} {r['P5']:3d} {alt:>6s} {pio:>4s} {r['stmtCount']:5d} {r['p2_method']:>20s} {r['ico']:>10s}")

    # 2c. Score/Confidence divergence — most absurd combinations
    print(f"\n── 2c. Score/Confidence divergence (most absurd) ──")
    # High score + low confidence
    high_score_low_conf = sorted([r for r in pop if r["score"] >= 60 and r["confidence"] < 70], key=lambda r: r["confidence"])
    print(f"\n  High score (≥60) + Low confidence (<70): {len(high_score_low_conf)} companies")
    if high_score_low_conf:
        print(f"  {'Score':>5} {'Conf':>4} {'Cat':>3} {'P2':>3} {'Method':>20s} {'ICO':>10s}")
        for r in high_score_low_conf[:15]:
            print(f"  {r['score']:5d} {r['confidence']:4d} {r['cat']:>3s} {r['P2']:3d} {r['p2_method']:>20s} {r['ico']:>10s}")

    # Low score + high confidence
    low_score_high_conf = sorted([r for r in pop if r["score"] < 30 and r["confidence"] >= 90], key=lambda r: r["score"])
    print(f"\n  Low score (<30) + High confidence (≥90): {len(low_score_high_conf)} companies")
    if low_score_high_conf:
        print(f"  {'Score':>5} {'Conf':>4} {'Cat':>3} {'P1':>3} {'P2':>3} {'P3':>3} {'P4':>3} {'P5':>3} {'Alt':>6} {'Pio':>4} {'Method':>20s} {'ICO':>10s}")
        for r in low_score_high_conf[:15]:
            alt = f"{r['altman']:.1f}" if r['altman'] is not None else "N/A"
            pio = f"{r['piotroski']:.0f}" if r['piotroski'] is not None else "N/A"
            print(f"  {r['score']:5d} {r['confidence']:4d} {r['cat']:>3s} {r['P1']:3d} {r['P2']:3d} {r['P3']:3d} {r['P4']:3d} {r['P5']:3d} {alt:>6s} {pio:>4s} {r['p2_method']:>20s} {r['ico']:>10s}")

    # ════════════════════════════════════════════════════════════════════════════
    # AUDIT 3: BOUNDARY AUDIT 49/50, 69/70
    # ════════════════════════════════════════════════════════════════════════════
    print(f"\n\n{'='*90}")
    print("AUDIT 3: BOUNDARY AUDIT (49/50, 69/70)")
    print("="*90)

    boundaries = [
        (48, 49, "C/B boundary"),
        (50, 51, "B/A boundary (lower)"),
        (68, 69, "B/A boundary"),
        (70, 71, "A/AAA boundary (lower)"),
    ]

    for lo, hi, label in boundaries:
        print(f"\n── {label}: scores {lo}-{hi} ──")
        below = [r for r in pop if lo <= r["score"] <= lo]
        above = [r for r in pop if hi <= r["score"] <= hi]
        if not below and not above:
            print(f"  No companies at this boundary")
            continue

        print(f"  {'Side':6s} {'N':>5} {'MedScore':>8} {'MedConf':>7} {'MedROA':>7} {'MedDE':>6} {'MedCR':>6} {'MedAlt':>7} {'MedPio':>6} {'C%':>6} {'B%':>6} {'A%':>6}")
        for label2, rs in [(f"{lo}", below), (f"{hi}", above)]:
            if not rs: continue
            nn = len(rs)
            roas = [r["roa_pct"] for r in rs if r.get("roa_pct") is not None]
            des = [r["debt_to_equity"] for r in rs if r.get("debt_to_equity") is not None]
            crs = [r["current_ratio"] for r in rs if r.get("current_ratio") is not None]
            alts = [r["altman"] for r in rs if r["altman"] is not None]
            pios = [r["piotroski"] for r in rs if r["piotroski"] is not None]
            med_roa = f"{median(roas):.1f}%" if roas else "N/A"
            med_de = f"{median(des):.1f}" if des else "N/A"
            med_cr = f"{median(crs):.2f}" if crs else "N/A"
            med_alt = f"{median(alts):.2f}" if alts else "N/A"
            med_pio = f"{median(pios):.0f}" if pios else "N/A"
            c_pct = sum(1 for r in rs if r["cat"] == "C") / nn * 100
            b_pct = sum(1 for r in rs if r["cat"] == "B") / nn * 100
            a_pct = sum(1 for r in rs if r["cat"] in ("A", "AAA")) / nn * 100
            print(f"  {label2:6s} {nn:5d} {median([r['score'] for r in rs]):8.0f} {median([r['confidence'] for r in rs]):7.0f} {med_roa:>7s} {med_de:>6s} {med_cr:>6s} {med_alt:>7s} {med_pio:>6s} {c_pct:5.1f}% {b_pct:5.1f}% {a_pct:5.1f}%")

    # ════════════════════════════════════════════════════════════════════════════
    # AUDIT 4: SCORE DECILE RANKING VALIDITY
    # ════════════════════════════════════════════════════════════════════════════
    print(f"\n\n{'='*90}")
    print("AUDIT 4: SCORE DECILE RANKING VALIDITY (najdôležitejšie)")
    print("="*90)

    pop_sorted = sorted(pop, key=lambda r: r["score"])
    n = len(pop_sorted)
    decile_size = n // 10

    print(f"\n── Decile analysis (D1=lowest, D10=highest) ──")
    print(f"  {'Decile':7s} {'N':>5} {'ScoreRange':>12} {'MedROA':>7} {'MedROE':>7} {'MedNPM':>7} {'MedEqR':>7} {'MedDE':>6} {'MedCR':>6} {'MedAlt':>7} {'MedPio':>6} {'Prof%':>6} {'PosCF%':>7} {'PosEq%':>7}")

    decile_data = []
    for di in range(10):
        start = di * decile_size
        end = (di + 1) * decile_size if di < 9 else n
        ds = pop_sorted[start:end]
        nn = len(ds)

        def med(field):
            vals = [r[field] for r in ds if r.get(field) is not None]
            return median(vals) if vals else None

        roa = med("roa_pct")
        roe = med("roe_pct")
        npm = med("npm_pct")
        eqr = med("equity_ratio")
        de = med("debt_to_equity")
        cr = med("current_ratio")
        alt = med("altman")
        pio = med("piotroski")

        prof = [r["profitable"] for r in ds if r.get("profitable") is not None]
        pos_cf = [r["positive_cf"] for r in ds if r.get("positive_cf") is not None]
        pos_eq = [r["positive_equity"] for r in ds if r.get("positive_equity") is not None]

        prof_pct = sum(1 for p in prof if p) / max(len(prof), 1) * 100
        cf_pct = sum(1 for p in pos_cf if p) / max(len(pos_cf), 1) * 100
        eq_pct = sum(1 for p in pos_eq if p) / max(len(pos_eq), 1) * 100

        score_range = f"{ds[0]['score']}-{ds[-1]['score']}"

        def fmt(v, suffix=""):
            if v is None: return "N/A"
            if suffix == "%": return f"{v:.1f}%"
            if suffix == "f2": return f"{v:.2f}"
            if suffix == "f1": return f"{v:.1f}"
            return f"{v:.0f}"

        print(f"  D{di+1:1d}      {nn:5d} {score_range:>12} {fmt(roa,'%'):>7s} {fmt(roe,'%'):>7s} {fmt(npm,'%'):>7s} {fmt(eqr,'f2'):>7s} {fmt(de,'f1'):>6s} {fmt(cr,'f2'):>6s} {fmt(alt,'f2'):>7s} {fmt(pio):>6s} {prof_pct:5.1f}% {cf_pct:6.1f}% {eq_pct:6.1f}%")

        decile_data.append({
            "decile": di+1, "n": nn, "score_range": score_range,
            "roa": roa, "roe": roe, "npm": npm, "eqr": eqr, "de": de, "cr": cr,
            "alt": alt, "pio": pio, "prof_pct": prof_pct, "cf_pct": cf_pct, "eq_pct": eq_pct,
        })

    # Monotonicity check
    print(f"\n── Monotonicity check ──")
    metrics = [
        ("ROA", "roa", True),   # True = should increase
        ("ROE", "roe", True),
        ("NPM", "npm", True),
        ("Equity ratio", "eqr", True),
        ("D/E", "de", False),    # False = should decrease
        ("Current ratio", "cr", True),
        ("Altman Z", "alt", True),
        ("Piotroski", "pio", True),
        ("Profitable %", "prof_pct", True),
        ("Positive CF %", "cf_pct", True),
        ("Positive Equity %", "eq_pct", True),
    ]

    print(f"  {'Metric':20s} {'Direction':>10s} {'Monotonic?':>10s} {'D1':>8s} {'D5':>8s} {'D10':>8s}")
    all_pass = True
    for name, field, should_increase in metrics:
        vals = [d[field] for d in decile_data if d[field] is not None]
        if len(vals) < 8:
            print(f"  {name:20s} {'↑' if should_increase else '↓':>10s} {'N/A':>10s} {'—':>8s} {'—':>8s} {'—':>8s}")
            continue

        # Check monotonicity (allow 1 violation)
        violations = 0
        for i in range(len(vals)-1):
            if should_increase:
                if vals[i] > vals[i+1]: violations += 1
            else:
                if vals[i] < vals[i+1]: violations += 1

        is_mono = violations <= 1  # allow 1 violation
        status = "✓ PASS" if is_mono else "✗ FAIL"
        if not is_mono: all_pass = False

        d1 = f"{vals[0]:.2f}" if vals[0] is not None else "N/A"
        d5 = f"{vals[4]:.2f}" if len(vals) > 4 and vals[4] is not None else "N/A"
        d10 = f"{vals[-1]:.2f}" if vals[-1] is not None else "N/A"

        print(f"  {name:20s} {'↑' if should_increase else '↓':>10s} {status:>10s} {d1:>8s} {d5:>8s} {d10:>8s}")

    print(f"\n  Overall monotonicity: {'✓ PASS — score has discriminative power' if all_pass else '✗ FAIL — score may not discriminate well'}")

    # ════════════════════════════════════════════════════════════════════════════
    # SUMMARY
    # ════════════════════════════════════════════════════════════════════════════
    print(f"\n\n{'='*90}")
    print("SUMMARY")
    print("="*90)

    print(f"\n── Audit 1: Fallback Calibration ──")
    print(f"  Full P2 (altman_piotroski): N={len(groups['altman_piotroski'])}, med P2={median([r['P2'] for r in groups['altman_piotroski']]):.0f}, med score={median([r['score'] for r in groups['altman_piotroski']]):.0f}")
    print(f"  Fallback (ratio_fallback): N={len(groups['ratio_fallback'])}, med P2={median([r['P2'] for r in groups['ratio_fallback']]):.0f}, med score={median([r['score'] for r in groups['ratio_fallback']]):.0f}")
    print(f"  Monotonic: {'✓' if is_monotonic else '✗'}")

    print(f"\n── Audit 2: Top/Bottom 100 ──")
    print(f"  Top 100: score {top100[-1]['score']}-{top100[0]['score']}, med conf={median([r['confidence'] for r in top100]):.0f}")
    print(f"  Bottom 100: score {bot100[0]['score']}-{bot100[-1]['score']}, med conf={median([r['confidence'] for r in bot100]):.0f}")
    print(f"  High score + low conf: {len(high_score_low_conf)}")
    print(f"  Low score + high conf: {len(low_score_high_conf)}")

    print(f"\n── Audit 4: Decile Validity ──")
    print(f"  Overall: {'✓ PASS' if all_pass else '✗ FAIL'}")


if __name__ == "__main__":
    asyncio.run(main())
