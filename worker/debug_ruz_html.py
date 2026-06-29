import asyncio
from playwright.async_api import async_playwright

async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        page = await browser.new_page()
        # Direct link to one of the statements for 46958819 (we can search it first)
        await page.goto("https://www.registeruz.sk/cruz-public/domain/accountingentity/show/3638061")
        # Let's find the link to the accounting document
        links = await page.locator("a:has-text('účtovná závierka'), a:has-text('Účtovná závierka')").all()
        for link in links:
            href = await link.get_attribute("href")
            text = await link.inner_text()
            print(f"Found link: {text} -> {href}")
            if href and "/accountingdocument/show/" in href:
                print("Navigating to document...")
                await page.goto("https://www.registeruz.sk" + href)
                await page.wait_for_timeout(2000)
                print("Page title:", await page.title())
                content = await page.content()
                with open("debug_doc.html", "w") as f:
                    f.write(content)
                break
        await browser.close()

asyncio.run(main())
