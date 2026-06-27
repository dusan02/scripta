#!/usr/bin/env python3
"""Test Obchodný vestník scraper with IČO 52292517 (STREBAU)."""
import asyncio
import logging
import sys
from pathlib import Path

logging.basicConfig(
    level=logging.DEBUG,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)

async def main():
    from playwright.async_api import async_playwright
    from src.scrapers.obchodny_vestnik import ObchodnyVestnikScraper

    output_dir = Path("/tmp/ov_test")
    output_dir.mkdir(exist_ok=True)

    pw = await async_playwright().start()
    browser = await pw.chromium.launch(headless=False, args=["--disable-blink-features=AutomationDetected"])

    scraper = ObchodnyVestnikScraper(browser=browser)
    try:
        result = await scraper.run(
            output_dir=output_dir,
            target_type="COMPANY",
            ico="52292517",
        )
        print(f"\n=== RESULT ===")
        print(f"Status: {result.status}")
        print(f"Message: {result.status_message}")
        print(f"File: {result.file_path}")
        print(f"Pages: {result.page_count}")
        print(f"Findings:\n{result.findings[:500] if result.findings else 'None'}")
    finally:
        await scraper._close()
        await browser.close()
        await pw.stop()

asyncio.run(main())
