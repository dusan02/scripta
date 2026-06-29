import asyncio
from src.scrapers.ruz_scraper import get_company_data

async def main():
    data = await get_company_data("31333532")
    if data:
        for stmt in data.financialStatements:
            print(f"Year {stmt.year}: Rev={stmt.mainActivityRevenue}, Profit={stmt.netProfitLoss}, Equity={stmt.equity}, Assets={stmt.totalAssets}")
            
asyncio.run(main())
