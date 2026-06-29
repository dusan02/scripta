import asyncio
from playwright.async_api import async_playwright

async def test():
    async with async_playwright() as p:
        b = await p.chromium.launch()
        c = await b.new_context()
        page = await c.new_page()
        # Direct URL from user's script: show/1506863 is for 2024
        await page.goto("https://www.registeruz.sk/cruz-public/domain/financialreport/show/1506863")
        await page.wait_for_timeout(2000)
        
        # Check if there is a download link anywhere
        html = await page.content()
        print("Page HTML contains 'attachment':", 'attachment' in html)
        print("Page HTML contains 'Stiahnuť':", 'Stiahnuť' in html)
        
        # Print all links
        links = await page.locator("a").all()
        for link in links:
            href = await link.get_attribute("href")
            text = await link.inner_text()
            if href and ('attachment' in href or 'download' in href):
                print(f"FOUND DL LINK: {text} -> {href}")
        await b.close()

asyncio.run(test())
