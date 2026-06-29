import asyncio
from playwright.async_api import async_playwright

async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        # We can use APIRequestContext to send requests directly
        context = await browser.new_context()
        api_context = context.request
        resp = await api_context.get(
            "https://www.registeruz.sk/cruz-public/api/uctovna-jednotka?ico=46958819",
            headers={"Accept": "application/json"}
        )
        print("Status:", resp.status)
        print("Body:", await resp.text())
        await browser.close()

asyncio.run(main())
