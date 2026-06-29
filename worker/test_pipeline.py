import asyncio
from src.pipeline import process_company

async def main():
    await process_company("54030617")

asyncio.run(main())
