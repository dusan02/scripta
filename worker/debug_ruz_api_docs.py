import asyncio
from playwright.async_api import async_playwright

async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        page = await browser.new_page()
        await page.goto("https://www.registeruz.sk/cruz-public/home/api")
        content = await page.inner_text("body")
        print("Content:", content[:3000])
        await browser.close()

asyncio.run(main())
