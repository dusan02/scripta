import asyncio
from playwright.async_api import async_playwright

async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        context = await browser.new_context(user_agent="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
        await context.add_init_script("Object.defineProperty(navigator, 'webdriver', {get: () => undefined})")
        page = await context.new_page()
        
        await page.goto("https://www.zrsr.sk/index")
        await page.fill("input#filter_ico", "36801577")
        await page.click("altcha-widget", timeout=5000)
        await page.wait_for_function('document.querySelector("input[name=\\"altcha\\"]") && document.querySelector("input[name=\\"altcha\\"]").value !== ""', timeout=10000)
        
        async with page.expect_navigation():
            await page.click("input[name='cmdPotvrdit']")
            
        await page.wait_for_selector("a.govuk-link[href*='/Detail/']", timeout=10000)
        link = page.locator("a.govuk-link[href*='/Detail/']").first
        
        async with page.expect_navigation(timeout=30000):
            await link.click()
            
        text = await page.inner_text("body")
        if "Odkaz je neplatný" in text:
            print("FAILED: Odkaz je neplatný")
        elif "Výpis zo živnostenského registra" in text:
            print("SUCCESS: Výpis načítaný")
        else:
            print("UNKNOWN", text[:200])

        await browser.close()

asyncio.run(main())
