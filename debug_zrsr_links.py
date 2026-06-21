import asyncio
from playwright.async_api import async_playwright

async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        page = await browser.new_page()
        
        await page.goto("https://www.zrsr.sk/index")
        await page.fill("input#filter_ico", "36801577") # GEMO SLOVENSKO
        await page.click("altcha-widget", timeout=5000)
        await page.wait_for_function('document.querySelector("input[name=\\"altcha\\"]") && document.querySelector("input[name=\\"altcha\\"]").value !== ""', timeout=10000)
        
        async with page.expect_navigation():
            await page.click("input[name='cmdPotvrdit']")
            
        print("Waiting for detail links...")
        await page.wait_for_selector("a.govuk-link[href*='/Detail/']", timeout=10000)
        links = await page.locator("a.govuk-link[href*='/Detail/']").all()
        for i, link in enumerate(links):
            href = await link.get_attribute("href")
            text = await link.inner_text()
            print(f"Link {i}: {href} | Text: {text}")
        
        # Try clicking the last one if there are multiple
        if links:
            print("Clicking Link 0...")
            async with page.expect_navigation(timeout=30000):
                await links[0].click()
                
            text = await page.inner_text("body")
            print("DETAIL TEXT:", text[:200])

        await browser.close()

asyncio.run(main())
