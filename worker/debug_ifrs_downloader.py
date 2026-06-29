import asyncio
from src.scrapers.ifrs_downloader import download_ifrs_reports
import logging
logging.getLogger().setLevel(logging.INFO)

async def main():
    files = await download_ifrs_reports("31322832")
    print("Files downloaded:", files)

if __name__ == "__main__":
    asyncio.run(main())
