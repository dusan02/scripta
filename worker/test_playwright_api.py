import asyncio
from playwright.async_api import async_playwright

async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        page = await browser.new_page()
        await page.goto("https://www.registeruz.sk/cruz-public/api/uctovne-zavierky?ico=54819032")
        text = await page.locator("body").inner_text()
        print(text)
        await browser.close()

asyncio.run(main())
