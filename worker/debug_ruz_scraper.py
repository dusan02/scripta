import asyncio
import logging
from pathlib import Path
from src.scrapers.ruz_scraper import download_ifrs_reports

logging.basicConfig(level=logging.INFO)

async def main():
    # Will download to assets_test/46958819
    files = await download_ifrs_reports("46958819", max_years=2, output_dir="assets_test")
    print("DOWNLOADED FILES:", files)

asyncio.run(main())
