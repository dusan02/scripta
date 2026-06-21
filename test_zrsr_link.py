import asyncio
from playwright.async_api import async_playwright

async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        page = await browser.new_page()
        await page.goto("https://www.zrsr.sk/")
        await page.fill("input#filter_ico", "31322832")
        await page.click("altcha-widget", timeout=5000)
        await page.wait_for_function('document.querySelector("input[name=\\"altcha\\"]") && document.querySelector("input[name=\\"altcha\\"]").value !== ""', timeout=10000)
        await page.click("input[name='cmdPotvrdit']")
        await page.wait_for_load_state("domcontentloaded")
        
        # Get link HTML
        html = await page.content()
        with open("test_zrsr_link.html", "w") as f:
            f.write(html)
        print("HTML written to test_zrsr_link.html")
        await browser.close()

asyncio.run(main())
