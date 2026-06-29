import asyncio
from src.pipeline import process_company
import logging
from dotenv import load_dotenv

logging.basicConfig(level=logging.INFO)

async def main():
    load_dotenv()
    await process_company("54819032", "test_report_123")

asyncio.run(main())
