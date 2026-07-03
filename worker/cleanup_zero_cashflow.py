"""
One-time cleanup: Convert existing operatingCashFlow=0 records to NULL.
Run: python3 -m worker.cleanup_zero_cashflow

Real companies don't have exactly 0 operating cash flow. The old LLM prompt
told the extractor to fill 0 when CF data was missing, creating false fraud flags.
"""
import asyncio
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import asyncpg
from src.config import settings


async def cleanup():
    conn = await asyncpg.connect(settings.database_url)
    try:
        for field in ("operatingCashFlow", "investingCashFlow", "financingCashFlow"):
            rows = await conn.fetch(
                f'SELECT id FROM "FinancialStatement" WHERE "{field}" = 0'
            )
            print(f"Found {len(rows)} statements with {field}=0")
            if rows:
                result = await conn.execute(
                    f'UPDATE "FinancialStatement" SET "{field}" = NULL WHERE "{field}" = 0'
                )
                print(f"  Updated: {result}")
        print("\nDone! All 0 cash flow values converted to NULL.")
    finally:
        await conn.close()


if __name__ == "__main__":
    asyncio.run(cleanup())
