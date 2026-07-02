import asyncio
from playwright.async_api import async_playwright

async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        page = await browser.new_page()
        await page.goto("https://www.registeruz.sk/cruz-public/domain/accountingentity/show/155944") # 155944 is probably not right. I'll search by IČO.
        await page.goto("https://www.registeruz.sk/cruz-public/domain/accountingentity/simplesearch")
        await page.fill('input[name="zaznam.ico"]', '36256013')
        await page.click('button[type="submit"]')
        await page.wait_for_timeout(2000)
        # click first result
        await page.click('a[href^="/cruz-public/domain/accountingentity/show/"]')
        await page.wait_for_timeout(2000)
        
        # Get all financial statements rows
        rows = await page.locator("tr").element_handles()
        for row in rows:
            text = await row.inner_text()
            if "závierka" in text.lower():
                print(text.replace('\n', ' | '))
        await browser.close()
asyncio.run(main())
