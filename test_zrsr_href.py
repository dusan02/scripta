import asyncio
from playwright.async_api import async_playwright

async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        page = await browser.new_page()
        await page.goto("https://www.zrsr.sk/")
        await page.fill("input#filter_ico", "31384072")
        await page.click("altcha-widget", timeout=5000)
        await page.wait_for_function('document.querySelector("input[name=\\"altcha\\"]") && document.querySelector("input[name=\\"altcha\\"]").value !== ""', timeout=10000)
        
        async with page.expect_navigation():
            await page.click("input[name='cmdPotvrdit']")
            
        try:
            links = await page.locator("a[href*='Detail'], a[href*='detail']").all()
            for link in links:
                print(await link.get_attribute("href"))
        except Exception as e:
            print("Error:", e)
        
        await browser.close()

asyncio.run(main())
