import asyncio
from playwright.async_api import async_playwright

async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        page = await browser.new_page()
        print("Idem na ZRSR")
        await page.goto("https://www.zrsr.sk/index")
        print("Nacitane")
        html = await page.content()
        if "altcha-widget" in html:
            print("ALTCHA TAM JE")
        else:
            print("ALTCHA TAM NIE JE")
            
        print("Hladam ICO input")
        el = await page.query_selector("input#filter_ico")
        if el:
            print("Nasiel som filter_ico")
        else:
            print("NENASIEL SOM filter_ico")
            
        await browser.close()

asyncio.run(main())
