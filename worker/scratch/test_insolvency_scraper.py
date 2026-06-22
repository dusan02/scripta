import asyncio
import sys
from pathlib import Path
from playwright.async_api import async_playwright

sys.path.append(str(Path(__file__).resolve().parent.parent))

from src.scrapers.insolvency import InsolvencyScraper

async def main():
    results_dir = Path(__file__).resolve().parent.parent / "test_results"
    results_dir.mkdir(parents=True, exist_ok=True)
    
    print("Launching browser...")
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        scraper = InsolvencyScraper(browser=browser)
        
        ico = "35826487"
        print(f"Running insolvency scraper for ICO {ico}...")
        try:
            result = await scraper.run(target_type="COMPANY", ico=ico, output_dir=results_dir)
            print("Scraper completed successfully!")
            print(f"Status: {result.status}")
            print(f"Status Message: {result.status_message}")
            print(f"File Path: {result.file_path}")
            print(f"Findings: {result.findings}")
        except Exception as e:
            print(f"Error: {e}")
            import traceback
            traceback.print_exc()
        finally:
            await browser.close()

if __name__ == "__main__":
    asyncio.run(main())
