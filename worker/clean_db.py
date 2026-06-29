import asyncio
import asyncpg
import os
from dotenv import load_dotenv

async def main():
    load_dotenv()
    conn = await asyncpg.connect(os.getenv("DATABASE_URL"))
    await conn.execute("DELETE FROM \"AuditorOpinion\" WHERE \"financialStatementId\" IN (SELECT id FROM \"FinancialStatement\" WHERE \"companyIco\" = '54819032')")
    await conn.execute("DELETE FROM \"NarrativeRiskAnalysis\" WHERE \"financialStatementId\" IN (SELECT id FROM \"FinancialStatement\" WHERE \"companyIco\" = '54819032')")
    await conn.execute("DELETE FROM \"FinancialStatement\" WHERE \"companyIco\" = '54819032'")
    await conn.close()

if __name__ == "__main__":
    asyncio.run(main())
