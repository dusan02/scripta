import asyncio
from playwright.async_api import async_playwright

async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        page = await browser.new_page()
        print("Navigating to zrsr.sk")
        await page.goto("https://www.zrsr.sk/")
        
        await page.fill("input#filter_ico", "31322832")
        
        print("Waiting for altcha widget")
        # Wait for the widget to appear
        await page.wait_for_selector("altcha-widget")
        
        # Click the checkbox inside the altcha widget
        # In ALTCHA, the checkbox has id 'altcha-checkbox' or we can just click the widget
        try:
            print("Clicking altcha widget")
            # Sometimes it's inside a shadow DOM, sometimes not. Let's just click the widget.
            await page.click("altcha-widget", timeout=5000)
            print("Waiting 5 seconds for PoW to calculate...")
            await page.wait_for_timeout(5000)
        except Exception as e:
            print("Failed to click altcha widget directly:", e)
            
        print("Submitting form")
        await page.click("input[name='cmdPotvrdit']")
        await page.wait_for_load_state("domcontentloaded")
        
        html = await page.content()
        if "Overte bezpečnostnú funkciu" in html:
            print("FAILED: Altcha was not verified.")
        else:
            print("SUCCESS: Form submitted!")
        
        with open("altcha_test.html", "w") as f:
            f.write(html)
            
        await browser.close()

asyncio.run(main())
