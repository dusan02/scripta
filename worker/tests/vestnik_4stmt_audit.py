"""
P0 Dual Audit:
  1. Vestník coverage — koľko firiem má Vestník records, severity, dátumy, FK integrita
  2. 4-statement anomaly — prečo 127 firiem s 4 výkazmi má 37.8% C (vs 15.1% pre 3, 13.2% pre 5+)

Usage:
    cd worker && python -m tests.vestnik_4stmt_audit
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


async def main():
    print("╔" + "═"*78 + "╗")
    print("║" + " P0 DUAL AUDIT — Vestník Coverage + 4-Statement Anomaly".center(78) + "║")
    print("╚" + "═"*78 + "╝")

    conn = await asyncpg.connect(DB_URL)
    print("DB connected\n")

    # ════════════════════════════════════════════════════════════════════════════
    # PART 1: VESTNÍK COVERAGE AUDIT
    # ════════════════════════════════════════════════════════════════════════════
    print("="*90)
    print("PART 1: VESTNÍK COVERAGE AUDIT")
    print("="*90)

    # 1a. Total VestnikEvent records
    total_ve = await conn.fetchval('SELECT count(*) FROM "VestnikEvent"')
    print(f"\n── 1a. Total VestnikEvent records: {total_ve} ──")

    # 1b. Distinct companies in VestnikEvent
    distinct_ve = await conn.fetchval('SELECT count(DISTINCT "companyIco") FROM "VestnikEvent"')
    print(f"── 1b. Distinct companies with VestnikEvent: {distinct_ve} ──")

    # 1c. Total companies in DB
    total_companies = await conn.fetchval('SELECT count(*) FROM "Company"')
    print(f"── 1c. Total companies in DB: {total_companies} ──")

    # 1d. Scoreable companies (≥2 statements)
    scoreable = await conn.fetchval("""
        SELECT count(DISTINCT c.ico) FROM "Company" c
        JOIN "FinancialStatement" fs ON fs."companyIco" = c.ico
        GROUP BY c.ico HAVING count(fs.id) >= 2
    """)
    print(f"── 1d. Scoreable companies (≥2 stmts): {scoreable} ──")

    # 1e. VestnikEvent companies that are scoreable
    ve_scoreable = await conn.fetchval("""
        SELECT count(DISTINCT ve."companyIco") FROM "VestnikEvent" ve
        JOIN "Company" c ON c.ico = ve."companyIco"
        JOIN "FinancialStatement" fs ON fs."companyIco" = c.ico
        GROUP BY ve."companyIco" HAVING count(fs.id) >= 2
    """)
    print(f"── 1e. VestnikEvent companies that are scoreable: {ve_scoreable} ──")

    # 1f. VestnikEvent companies with <2 statements (not scoreable)
    ve_not_scoreable = await conn.fetchval("""
        SELECT count(DISTINCT ve."companyIco") FROM "VestnikEvent" ve
        WHERE ve."companyIco" NOT IN (
            SELECT c.ico FROM "Company" c
            JOIN "FinancialStatement" fs ON fs."companyIco" = c.ico
            GROUP BY c.ico HAVING count(fs.id) >= 2
        )
    """)
    print(f"── 1f. VestnikEvent companies NOT scoreable (<2 stmts): {ve_not_scoreable} ──")

    # 1g. VestnikEvent with companyIco that doesn't exist in Company (orphan FK)
    orphans = await conn.fetchval("""
        SELECT count(DISTINCT ve."companyIco") FROM "VestnikEvent" ve
        LEFT JOIN "Company" c ON c.ico = ve."companyIco"
        WHERE c.ico IS NULL
    """)
    print(f"── 1g. Orphan VestnikEvent (companyIco not in Company): {orphans} ──")

    # 1h. Severity distribution
    print(f"\n── 1h. VestnikEvent severity distribution ──")
    sev_rows = await conn.fetch("""
        SELECT "severityLevel", count(*) as cnt
        FROM "VestnikEvent"
        GROUP BY "severityLevel" ORDER BY cnt DESC
    """)
    for r in sev_rows:
        print(f"  {r['severityLevel'] or 'NULL':15s}: {r['cnt']:6d}")

    # 1i. eventType distribution
    print(f"\n── 1i. VestnikEvent eventType distribution ──")
    et_rows = await conn.fetch("""
        SELECT "eventType", count(*) as cnt
        FROM "VestnikEvent"
        GROUP BY "eventType" ORDER BY cnt DESC
        LIMIT 20
    """)
    for r in et_rows:
        print(f"  {r['eventType'] or 'NULL':30s}: {r['cnt']:6d}")

    # 1j. Date range
    print(f"\n── 1j. VestnikEvent date range ──")
    date_range = await conn.fetchrow("""
        SELECT min("publishedAt") as min_d, max("publishedAt") as max_d,
               count(*) FILTER (WHERE "publishedAt" IS NULL) as null_dates
        FROM "VestnikEvent"
    """)
    print(f"  Min publishedAt: {date_range['min_d']}")
    print(f"  Max publishedAt: {date_range['max_d']}")
    print(f"  NULL publishedAt: {date_range['null_dates']}")

    # 1k. VestnikEvent per company (distribution)
    print(f"\n── 1k. VestnikEvent per company (distribution) ──")
    per_company = await conn.fetch("""
        SELECT "companyIco", count(*) as cnt
        FROM "VestnikEvent"
        GROUP BY "companyIco" ORDER BY cnt DESC
        LIMIT 10
    """)
    for r in per_company:
        print(f"  ICO {r['companyIco']}: {r['cnt']} events")

    # 1l. CompanyEvent with source=VESTNIK (alternative storage)
    ce_vestnik = await conn.fetchval("""
        SELECT count(*) FROM "CompanyEvent" WHERE source = 'VESTNIK'
    """)
    print(f"\n── 1l. CompanyEvent with source=VESTNIK: {ce_vestnik} ──")

    ce_vestnik_distinct = await conn.fetchval("""
        SELECT count(DISTINCT "companyIco") FROM "CompanyEvent" WHERE source = 'VESTNIK'
    """)
    print(f"  Distinct companies: {ce_vestnik_distinct}")

    # 1m. CompanyEvent source distribution (all sources)
    print(f"\n── 1m. CompanyEvent source distribution (all) ──")
    src_rows = await conn.fetch("""
        SELECT source, count(*) as cnt, count(DISTINCT "companyIco") as distinct_icos
        FROM "CompanyEvent"
        GROUP BY source ORDER BY cnt DESC
    """)
    for r in src_rows:
        print(f"  {r['source'] or 'NULL':20s}: {r['cnt']:6d} events, {r['distinct_icos']:6d} companies")

    # 1n. CompanyEvent with source=ORSR (forensic)
    ce_orsr = await conn.fetchval("""
        SELECT count(*) FROM "CompanyEvent" WHERE source = 'ORSR'
    """)
    ce_orsr_distinct = await conn.fetchval("""
        SELECT count(DISTINCT "companyIco") FROM "CompanyEvent" WHERE source = 'ORSR'
    """)
    print(f"\n── 1n. CompanyEvent ORSR (forensic): {ce_orsr} events, {ce_orsr_distinct} companies ──")

    # 1o. Cross-check: VestnikEvent vs CompanyEvent VESTNIK overlap
    overlap = await conn.fetchval("""
        SELECT count(DISTINCT ve."companyIco") FROM "VestnikEvent" ve
        JOIN "CompanyEvent" ce ON ce."companyIco" = ve."companyIco" AND ce.source = 'VESTNIK'
    """)
    print(f"── 1o. Companies in BOTH VestnikEvent AND CompanyEvent(VESTNIK): {overlap} ──")

    # 1p. VestnikEvent with CRITICAL/HIGH that are scoreable
    critical_scoreable = await conn.fetchval("""
        SELECT count(DISTINCT ve."companyIco") FROM "VestnikEvent" ve
        WHERE ve."severityLevel" IN ('CRITICAL', 'HIGH')
        AND ve."companyIco" IN (
            SELECT c.ico FROM "Company" c
            JOIN "FinancialStatement" fs ON fs."companyIco" = c.ico
            GROUP BY c.ico HAVING count(fs.id) >= 2
        )
    """)
    print(f"── 1p. Scoreable companies with CRITICAL/HIGH VestnikEvent: {critical_scoreable} ──")

    # ════════════════════════════════════════════════════════════════════════════
    # PART 2: 4-STATEMENT ANOMALY
    # ════════════════════════════════════════════════════════════════════════════
    print(f"\n\n{'='*90}")
    print("PART 2: 4-STATEMENT ANOMALY")
    print("="*90)

    # Load population results
    try:
        with open("tests/population_results.json") as f:
            pop = json.load(f)
    except FileNotFoundError:
        print("ERROR: tests/population_results.json not found. Run population_audit first.")
        await conn.close()
        return

    # 2a. Statement count distribution
    stmt_counts = Counter(r["stmtCount"] for r in pop)
    print(f"\n── 2a. Statement count distribution ──")
    for n in sorted(stmt_counts.keys()):
        print(f"  {n:3d} stmts: {stmt_counts[n]:6d} companies")

    # 2b. Group: 3 vs 4 vs 5+ and compare key metrics
    groups = {"3": [], "4": [], "5+": [], "1-2": []}
    for r in pop:
        n = r["stmtCount"]
        if n <= 2: groups["1-2"].append(r)
        elif n == 3: groups["3"].append(r)
        elif n == 4: groups["4"].append(r)
        else: groups["5+"].append(r)

    print(f"\n── 2b. Comparison: 3 vs 4 vs 5+ statements ──")
    print(f"  {'Group':8s} {'N':>6} {'MedScore':>8} {'MedP1':>6} {'MedP2':>6} {'MedP3':>6} {'MedP4':>6} {'MedP5':>6} {'MedConf':>7} {'C%':>6}")
    for g in ["1-2", "3", "4", "5+"]:
        rs = groups[g]
        if not rs: continue
        nn = len(rs)
        print(f"  {g:8s} {nn:6d} {median([r['score'] for r in rs]):8.0f} "
              f"{median([r['P1'] for r in rs]):6.0f} {median([r['P2'] for r in rs]):6.0f} "
              f"{median([r['P3'] for r in rs]):6.0f} {median([r['P4'] for r in rs]):6.0f} "
              f"{median([r['P5'] for r in rs]):6.0f} {median([r['confidence'] for r in rs]):7.0f} "
              f"{sum(1 for r in rs if r['cat']=='C')/nn*100:5.1f}%")

    # 2c. Deep dive into 4-statement companies
    four_stmt_icos = [r["ico"] for r in groups["4"]]
    print(f"\n── 2c. Deep dive: 127 companies with 4 statements ──")

    if four_stmt_icos:
        # Get detailed data from DB
        placeholders = ",".join(f"${i+1}" for i in range(len(four_stmt_icos)))
        rows = await conn.fetch(f"""
            SELECT fs."companyIco", fs.year, fs."mainActivityRevenue", fs."netProfitLoss",
                   fs."totalAssets", fs.equity, fs."statementType", fs."isConsolidated",
                   fs."operatingCashFlow", fs."monthsInPeriod"
            FROM "FinancialStatement" fs
            WHERE fs."companyIco" IN ({placeholders})
            ORDER BY fs."companyIco", fs.year
        """, *four_stmt_icos)

        # Group by company
        by_ico = defaultdict(list)
        for r in rows:
            by_ico[r["companyIco"]].append(r)

        # Analyze
        print(f"\n  Total 4-stmt companies in DB: {len(by_ico)}")

        # 2c-1. Year range
        year_ranges = []
        for ico, stmts in by_ico.items():
            years = sorted([s["year"] for s in stmts])
            year_ranges.append((years[-1] - years[0], years[0], years[-1], years))

        gaps = [r[0] for r in year_ranges]
        print(f"\n  Year span (max_year - min_year):")
        print(f"    Mean: {mean(gaps):.1f}, Median: {median(gaps):.0f}")
        print(f"    Distribution: {Counter(gaps).most_common(10)}")

        # 2c-2. Last reporting year
        last_years = [r[2] for r in year_ranges]
        print(f"\n  Last reporting year distribution:")
        for y, c in sorted(Counter(last_years).items()):
            print(f"    {y}: {c}")

        # 2c-3. Statement types
        stmt_types = Counter()
        for ico, stmts in by_ico.items():
            for s in stmts:
                stmt_types[s["statementType"] or "NULL"] += 1
        print(f"\n  Statement type distribution:")
        for t, c in stmt_types.most_common():
            print(f"    {t:30s}: {c}")

        # 2c-4. Months in period (micro-format detection)
        months = Counter()
        for ico, stmts in by_ico.items():
            for s in stmts:
                m = s["monthsInPeriod"]
                if m is None: months["NULL"] += 1
                elif m == 12: months["12 (full)"] += 1
                else: months[f"{m} (partial)"] += 1
        print(f"\n  Months in period:")
        for m, c in months.most_common():
            print(f"    {m:20s}: {c}")

        # 2c-5. Revenue / equity / profitability
        revenues = []
        equities = []
        profits = []
        for ico, stmts in by_ico.items():
            latest = sorted(stmts, key=lambda s: s["year"])[-1]
            if latest["mainActivityRevenue"] is not None:
                revenues.append(float(latest["mainActivityRevenue"]))
            if latest["equity"] is not None:
                equities.append(float(latest["equity"]))
            if latest["netProfitLoss"] is not None:
                profits.append(float(latest["netProfitLoss"]))

        print(f"\n  Latest year financials (median):")
        print(f"    Revenue: {median(revenues):,.0f} €" if revenues else "    Revenue: N/A")
        print(f"    Equity:  {median(equities):,.0f} €" if equities else "    Equity: N/A")
        print(f"    Profit:  {median(profits):,.0f} €" if profits else "    Profit: N/A")

        # 2c-6. Profitability breakdown
        profitable = sum(1 for p in profits if p > 0)
        loss = sum(1 for p in profits if p <= 0)
        print(f"\n  Profitability (latest year):")
        print(f"    Profitable: {profitable}/{len(profits)} ({profitable/max(len(profits),1)*100:.1f}%)")
        print(f"    Loss:       {loss}/{len(profits)} ({loss/max(len(profits),1)*100:.1f}%)")

        # 2c-7. P2 method for 4-stmt companies
        four_stmt_pop = [r for r in pop if r["stmtCount"] == 4]
        p2_methods_4 = Counter(r["p2_method"] for r in four_stmt_pop)
        print(f"\n  P2 method for 4-stmt companies:")
        for m, c in p2_methods_4.most_common():
            print(f"    {m:25s}: {c}")

        # 2c-8. Altman/Piotroski for 4-stmt
        altman_na_4 = sum(1 for r in four_stmt_pop if r["altman"] is None)
        pio_na_4 = sum(1 for r in four_stmt_pop if r["piotroski"] is None)
        print(f"\n  Altman N/A: {altman_na_4}/{len(four_stmt_pop)} ({altman_na_4/len(four_stmt_pop)*100:.1f}%)")
        print(f"  Piotroski N/A: {pio_na_4}/{len(four_stmt_pop)} ({pio_na_4/len(four_stmt_pop)*100:.1f}%)")

        # 2c-9. NACE distribution for 4-stmt
        nace_4 = Counter(r["nace"][:2] for r in four_stmt_pop if r["nace"])
        print(f"\n  NACE distribution (top 10) for 4-stmt:")
        for n, c in nace_4.most_common(10):
            print(f"    {n}: {c}")

        # 2c-10. Company age (establishedAt)
        age_rows = await conn.fetch(f"""
            SELECT ico, "establishedAt" FROM "Company" WHERE ico IN ({placeholders})
        """, *four_stmt_icos)
        ages = []
        from datetime import datetime
        now = datetime.now()
        for r in age_rows:
            if r["establishedAt"]:
                age_years = (now - r["establishedAt"]).days / 365.25
                ages.append(age_years)
        if ages:
            print(f"\n  Company age (years from establishedAt):")
            print(f"    Mean: {mean(ages):.1f}, Median: {median(ages):.0f}")
            print(f"    P10: {_pct(ages,10):.0f}, P25: {_pct(ages,25):.0f}, P75: {_pct(ages,75):.0f}")

        # 2c-11. Compare with 3-stmt and 5+ companies
        print(f"\n  ── Comparison: 3 vs 4 vs 5+ ──")
        for gname, gicos in [("3", [r["ico"] for r in groups["3"][:50]]),
                              ("4", four_stmt_icos[:50]),
                              ("5+", [r["ico"] for r in groups["5+"][:50]])]:
            if not gicos: continue
            ph = ",".join(f"${i+1}" for i in range(len(gicos)))
            age_r = await conn.fetch(f"""
                SELECT ico, "establishedAt" FROM "Company" WHERE ico IN ({ph})
            """, *gicos)
            a = []
            for r in age_r:
                if r["establishedAt"]:
                    a.append((now - r["establishedAt"]).days / 365.25)
            if a:
                print(f"    {gname:5s}: median age = {median(a):.0f} years (N={len(a)})")

        # 2c-12. Are 4-stmt companies "stopped reporting"?
        # Check if latest year < 2023 (i.e. company stopped reporting)
        stopped = sum(1 for r in year_ranges if r[2] < 2023)
        active = sum(1 for r in year_ranges if r[2] >= 2023)
        print(f"\n  Reporting status:")
        print(f"    Active (latest ≥ 2023): {active}/{len(year_ranges)} ({active/len(year_ranges)*100:.1f}%)")
        print(f"    Stopped (latest < 2023): {stopped}/{len(year_ranges)} ({stopped/len(year_ranges)*100:.1f}%)")

        # 2c-13. Year gaps (e.g. 2018, 2019, 2020, 2022 — missing 2021)
        gap_companies = 0
        for ico, stmts in by_ico.items():
            years = sorted([s["year"] for s in stmts])
            for i in range(1, len(years)):
                if years[i] - years[i-1] > 1:
                    gap_companies += 1
                    break
        print(f"\n  Companies with year gaps: {gap_companies}/{len(by_ico)} ({gap_companies/len(by_ico)*100:.1f}%)")

        # 2c-14. Sample 10 companies with details
        print(f"\n  ── Sample 10 four-statement companies ──")
        print(f"  {'ICO':10s} {'Years':15s} {'Score':>5} {'Cat':>3} {'P2':>3} {'P4':>3} {'Conf':>4} {'Method':>20s}")
        for r in four_stmt_pop[:10]:
            ico = r["ico"]
            if ico in by_ico:
                years = sorted([s["year"] for s in by_ico[ico]])
                yr_str = f"{years[0]}-{years[-1]}"
            else:
                yr_str = "??"
            print(f"  {ico:10s} {yr_str:15s} {r['score']:5d} {r['cat']:>3s} {r['P2']:3d} {r['P4']:3d} {r['confidence']:4d} {r['p2_method']:>20s}")

    # ════════════════════════════════════════════════════════════════════════════
    # SUMMARY
    # ════════════════════════════════════════════════════════════════════════════
    print(f"\n\n{'='*90}")
    print("SUMMARY")
    print("="*90)

    print(f"\n── Vestník Coverage ──")
    print(f"  Total VestnikEvent records: {total_ve}")
    print(f"  Distinct companies with VestnikEvent: {distinct_ve}")
    print(f"  Total companies in DB: {total_companies}")
    print(f"  Scoreable companies: {scoreable}")
    print(f"  VestnikEvent companies that are scoreable: {ve_scoreable}")
    print(f"  VestnikEvent companies NOT scoreable: {ve_not_scoreable}")
    print(f"  Orphan FK (companyIco not in Company): {orphans}")
    print(f"  CompanyEvent(VESTNIK) records: {ce_vestnik}")
    print(f"  CompanyEvent(VESTNIK) distinct companies: {ce_vestnik_distinct}")
    print(f"  Scoreable with CRITICAL/HIGH VestnikEvent: {critical_scoreable}")

    print(f"\n── 4-Statement Anomaly ──")
    if four_stmt_icos:
        print(f"  N=127, Median score=46, C%=37.8%")
        print(f"  Year span median: {median(gaps):.0f} years")
        print(f"  Stopped reporting (<2023): {stopped}/{len(year_ranges)} ({stopped/len(year_ranges)*100:.1f}%)")
        print(f"  Companies with year gaps: {gap_companies}/{len(by_ico)} ({gap_companies/len(by_ico)*100:.1f}%)")
        print(f"  Profitable (latest): {profitable}/{len(profits)} ({profitable/max(len(profits),1)*100:.1f}%)")
        print(f"  P2 method: {dict(p2_methods_4.most_common())}")
        print(f"  Altman N/A: {altman_na_4}/{len(four_stmt_pop)}")
        print(f"  Piotroski N/A: {pio_na_4}/{len(four_stmt_pop)}")

    await conn.close()


if __name__ == "__main__":
    asyncio.run(main())
