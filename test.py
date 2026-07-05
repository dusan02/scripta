"""Test Verifa Score v2 pre VW Slovakia (IČO 35757442)."""
import asyncio
import asyncpg
import sys
sys.path.insert(0, "worker")

from src.analytics import (
    compute_forensic_scorecard,
    compute_financial_trends,
    compute_piotroski_f_score,
    get_nace_weights,
)


async def main():
    pool = await asyncpg.create_pool(
        host="localhost", port=5432,
        user="scripta", password="scripta_dev_password", database="scripta",
        min_size=1, max_size=1,
    )
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            'SELECT ico, name, "naceCode", "naceText" FROM "Company" WHERE ico = $1',
            "35757442",
        )
        if not row:
            print("Company not found")
            return
        nace = row["naceCode"] or ""
        print(f"Company: {row['name']}")
        print(f"NACE: {nace}")
        print(f"NACE weights: {get_nace_weights(nace)}")

        stmts = await conn.fetch(
            'SELECT * FROM "FinancialStatement" WHERE "companyIco" = $1 ORDER BY year',
            "35757442",
        )
        print(f"Statements: {len(stmts)} years")
        for s in stmts:
            print(f"  {s['year']}: assets={s['totalAssets']}, equity={s['equity']}, "
                  f"profit={s['netProfitLoss']}, cf={s['operatingCashFlow']}, "
                  f"rev={s['mainActivityRevenue']}")

        events = await conn.fetch(
            'SELECT "eventType", "severityLevel", "publishedAt", summary '
            'FROM "VestnikEvent" WHERE "companyIco" = $1',
            "35757442",
        )
        print(f"Vestnik events: {len(events)}")

        # Load auditor opinions
        audit_rows = await conn.fetch(
            'SELECT ao."opinionType", ao."financialStatementId", fs.year '
            'FROM "AuditorOpinion" ao '
            'JOIN "FinancialStatement" fs ON ao."financialStatementId" = fs.id '
            'WHERE fs."companyIco" = $1',
            "35757442",
        )
        audit_by_year = {r["year"]: r["opinionType"] for r in audit_rows}
        print(f"Auditor opinions: {len(audit_rows)}")
        for y, t in audit_by_year.items():
            print(f"  {y}: {t}")

        stmts_list = [
            {
                "year": s["year"],
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
                "auditorOpinion": {"opinionType": audit_by_year.get(s["year"])} if s["year"] in audit_by_year else None,
            }
            for s in stmts
        ]

        company_dict = {
            "ico": "35757442",
            "name": row["name"],
            "naceCode": nace,
            "naceText": row["naceText"],
            "financialStatements": stmts_list,
            "vestnikEvents": [
                {
                    "eventType": e["eventType"],
                    "severityLevel": e["severityLevel"],
                    "publishedAt": e["publishedAt"],
                    "summary": e["summary"],
                }
                for e in events
            ],
        }

        trends = compute_financial_trends(stmts_list)
        print(f"\nCAGR: {trends.get('cagr_revenue')}")
        print(f"Consecutive losses: {trends.get('consecutive_losses')}")

        pio = compute_piotroski_f_score(stmts_list)
        print(f"Piotroski: {pio}")

        result = compute_forensic_scorecard(company_dict, trends)
        print()
        print("=" * 60)
        print(f"VERIFA SCORE v{result.score_version}: {result.total_score}/100")
        print(f"Risk category: {result.risk_category}")
        print(f"Hard stop: {result.hard_stop}")
        print("=" * 60)
        for p in result.pillars:
            print(f"  {p.name}: {p.score}/{p.max_score} — {p.detail}")
        print()

    await pool.close()


if __name__ == "__main__":
    asyncio.run(main())
