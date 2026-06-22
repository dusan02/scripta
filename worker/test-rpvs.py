import asyncio
from playwright.async_api import async_playwright

async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        page = await browser.new_page()
        print("Navigating...")
        await page.goto("https://rpvs.gov.sk/rpvs", timeout=30000)
        
        ico = "35757442"
        print("Typing ICO...")
        search_input = page.locator("#partner_hladat_text")
        await search_input.wait_for(state="visible", timeout=10000)
        await search_input.fill(ico)

        print("Clicking search btn...")
        search_btn = page.locator(".input-group-btn-tt")
        await search_btn.click()
        
        print("Waiting for network...")
        await page.wait_for_load_state("networkidle", timeout=15000)

        table_rows = page.locator("table tbody tr")
        count = await table_rows.count()
        print(f"Found {count} rows")

        if count >= 1:
            first_link = table_rows.first.locator("a").first
            if await first_link.count() > 0:
                print("Clicking first link...")
                await first_link.click()
            else:
                print("Clicking table row...")
                await table_rows.first.click()
            
            await page.wait_for_load_state("networkidle", timeout=15000)
            print("Detail opened:", await page.title())

        await browser.close()

asyncio.run(main())
