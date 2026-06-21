import asyncio
from playwright.async_api import async_playwright

async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        page = await browser.new_page()
        
        await page.goto("https://www.zrsr.sk/")
        await page.fill("input#filter_ico", "36801577") # GEMO SLOVENSKO
        await page.click("altcha-widget", timeout=5000)
        await page.wait_for_function('document.querySelector("input[name=\\"altcha\\"]") && document.querySelector("input[name=\\"altcha\\"]").value !== ""', timeout=10000)
        
        async with page.expect_navigation():
            await page.click("input[name='cmdPotvrdit']")
            
        print("Waiting for detail link...")
        try:
            link = await page.wait_for_selector("a.govuk-link[href*='/Detail/'], a.govuk-link[href*='/detail/']", timeout=10000)
            href = await link.get_attribute("href")
            print("Clicking:", href)
            async with page.expect_navigation(timeout=30000):
                await link.click()
                
            text = await page.inner_text("body")
            print("DETAIL TEXT:", text[:200])
        except Exception as e:
            print("Detail link error:", e)
        
        await browser.close()

asyncio.run(main())
