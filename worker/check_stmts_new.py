import asyncio
import asyncpg
import os
from dotenv import load_dotenv

async def main():
    load_dotenv()
    conn = await asyncpg.connect(os.getenv("DATABASE_URL"))
    rows = await conn.fetch("SELECT * FROM \"FinancialStatement\" WHERE \"companyIco\" = '00686930' ORDER BY \"year\"")
    for r in rows:
        print(f"Rok: {r['year']}, Trzby: {r['mainActivityRevenue']}, Zisk: {r['netProfitLoss']}, Pohladavky: {r['tradeReceivables']}, Zavazky: {r['tradePayables']}, Dlh: {r['shortTermLiabilities'] + r['longTermLiabilities']}, Osobne_nakl: {r['staffCosts']}")
    await conn.close()

if __name__ == "__main__":
    asyncio.run(main())
