"""Headed test pre Register účtovných závierok (registeruz.sk).

Spustí scraper s viditeľným browserom (headless=False) aby si videl
celý flow: search → result → tabs → PDF generácie.

Použitie:
    cd worker && python scratch/test_ruz_headed.py
"""
import asyncio
import sys
from pathlib import Path

# Pridaj worker/ do path (src je package)
_worker = str(Path(__file__).resolve().parent.parent)
sys.path.insert(0, _worker)

# Importuj ako src.scrapers package
from playwright.async_api import async_playwright
from src.scrapers.registeruz import RegisterUzScraper


async def main():
    ico = "31322832"  # Tesco Stores SR
    output_dir = Path("/tmp/ruz_test")
    output_dir.mkdir(parents=True, exist_ok=True)

    print(f"[TEST] RUZ headed test pre IČO: {ico}")
    print(f"[TEST] Output dir: {output_dir}")

    # Spustime browser v headed mode
    async with async_playwright() as p:
        browser = await p.chromium.launch(
            headless=False,
            args=['--disable-blink-features=AutomationDetected'],
        )

        scraper = RegisterUzScraper(browser=browser)

        try:
            result = await scraper.run(ico=ico, output_dir=output_dir)
            print(f"\n[RESULT] Status: {result.status}")
            print(f"[RESULT] File: {result.file_path}")
            print(f"[RESULT] Pages: {result.page_count}")
            print(f"[RESULT] Message: {result.status_message}")
            print(f"[RESULT] Findings: {result.findings}")

            if result.file_path and Path(result.file_path).exists():
                size = Path(result.file_path).stat().st_size
                print(f"[RESULT] PDF size: {size} bytes ({size/1024:.1f} KB)")
            else:
                print("[RESULT] ⚠️ Žiadny PDF súbor!")

        finally:
            await scraper._close()
            await browser.close()

    print("\n[TEST] Hotovo.")


if __name__ == "__main__":
    asyncio.run(main())
