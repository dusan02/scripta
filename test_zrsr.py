import asyncio
from playwright.async_api import async_playwright

async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        page = await browser.new_page()
        await page.goto("https://www.zrsr.sk/")
        
        await page.fill("input#filter_ico", "31322832")
        await page.click("input[name='cmdPotvrdit']")
        await page.wait_for_load_state("domcontentloaded")
        
        html = await page.content()
        with open("zrsr_result.html", "w") as f:
            f.write(html)
            
        await browser.close()

asyncio.run(main())
