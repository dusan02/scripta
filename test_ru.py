import asyncio
from playwright.async_api import async_playwright

async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        page = await browser.new_page()
        
        await page.goto("https://ru.justice.sk/ru-verejnost-web/pages/home.xhtml", wait_until="domcontentloaded")
        
        await page.fill("input[id*='searchQuery']", "31322832")
        
        async with page.expect_navigation(timeout=30000):
            await page.click("a[id*='searchBoxForm:search']")
            
        await page.wait_for_timeout(2000)
        
        # Check if there is an element for no results
        html = await page.content()
        with open("ru_results.html", "w") as f:
            f.write(html)
        print("HTML written to ru_results.html")
        await browser.close()

asyncio.run(main())
