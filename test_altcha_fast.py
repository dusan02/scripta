import asyncio
import time
from playwright.async_api import async_playwright

async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        page = await browser.new_page()
        await page.goto("https://www.zrsr.sk/")
        
        await page.fill("input#filter_ico", "31322832")
        
        await page.wait_for_selector("altcha-widget")
        await page.click("altcha-widget", timeout=5000)
        
        t0 = time.time()
        print("Waiting for altcha hidden input to be filled...")
        # wait for hidden input to have a value
        await page.wait_for_function('document.querySelector("input[name=\\"altcha\\"]") && document.querySelector("input[name=\\"altcha\\"]").value !== ""', timeout=10000)
        t1 = time.time()
        print(f"Altcha solved in {t1-t0:.2f} seconds!")
        
        await browser.close()

asyncio.run(main())
