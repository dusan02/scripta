import asyncio
from src.pipeline import process_company

async def main():
    await process_company("46958819")

asyncio.run(main())
