import asyncio
import asyncpg
import os
from dotenv import load_dotenv

async def main():
    load_dotenv()
    conn = await asyncpg.connect(os.getenv("DATABASE_URL"))
    rows = await conn.fetch("SELECT \"year\", \"mainActivityRevenue\", \"netProfitLoss\" FROM \"FinancialStatement\" WHERE \"companyIco\" = '54819032'")
    for row in rows:
        print(dict(row))
    await conn.close()

if __name__ == "__main__":
    asyncio.run(main())
