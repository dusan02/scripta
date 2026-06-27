import asyncio
from playwright.async_api import async_playwright

async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        page = await browser.new_page()
        await page.goto("https://www.zrsr.sk/index")
        
        await page.wait_for_selector("altcha-widget", timeout=5000)
        
        html = await page.evaluate('''() => {
            const widget = document.querySelector('altcha-widget');
            return widget.innerHTML;
        }''')
        print("Widget HTML:")
        print(html)

        await browser.close()

asyncio.run(main())
