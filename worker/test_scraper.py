import asyncio
from prisma import Prisma
import httpx
import os
from dotenv import load_dotenv

load_dotenv()

async def main():
    db = Prisma()
    await db.connect()
    user = await db.user.find_first()
    
    # We will just run the ifrs downloader function directly to see its output
    from src.scrapers.ifrs_downloader import download_ifrs_reports
    
    # First, let's create a directory
    os.makedirs(f"assets/31699847", exist_ok=True)
    
    files = await download_ifrs_reports("31699847", max_years=3, output_dir=f"assets/31699847")
    print("STIAHNUTE SUBORY:")
    for f in files:
        print(f)
            
    await db.disconnect()

asyncio.run(main())
