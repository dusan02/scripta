import asyncio
from playwright.async_api import async_playwright
async def test():
    async with async_playwright() as p:
        b = await p.chromium.launch()
        c = await b.new_context()
        page = await c.new_page()
        await page.goto("https://www.registeruz.sk/cruz-public/domain/accountingentity/show/10268418")
        await page.wait_for_timeout(2000)
        
        html = await page.evaluate("document.querySelector('tr') ? document.querySelector('tbody').innerHTML : ''")
        print(html[:2000])
        await b.close()
asyncio.run(test())
