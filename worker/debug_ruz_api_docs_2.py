import asyncio
from playwright.async_api import async_playwright
import re

async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        page = await browser.new_page()
        await page.goto("https://www.registeruz.sk/cruz-public/home/api")
        content = await page.inner_text("body")
        # Extract endpoints looking like /api/...
        endpoints = re.findall(r'/api/[a-zA-Z0-9\-\/]+', content)
        print("Endpoints found:")
        for e in set(endpoints):
            print(e)
        
        # Let's see the section for "Služby pre detaily"
        idx = content.find("Služby pre detaily")
        if idx != -1:
            print("\nDetails section:")
            print(content[idx:idx+3000])
        await browser.close()

asyncio.run(main())
