import asyncio
from playwright.async_api import async_playwright

async def run():
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        page = await browser.new_page()
        await page.goto("https://www.registeruz.sk/cruz-public/domain/accountingentity/show/85420") # Example, but let's do search
        
        await page.goto("https://www.registeruz.sk/cruz-public/domain/accountingentity/listsimplesearch")
        await page.get_by_role("textbox", name="Zadajte názov účtovnej").fill("31637051")
        await page.get_by_role("button", name="Vyhľadaj").first.click()
        await page.wait_for_timeout(2000)
        detail_links = await page.locator("a[href*='/cruz-public/domain/accountingentity/show/']").all()
        href = await detail_links[0].get_attribute("href")
        print(f"Detail URL: {href}")
        await page.goto("https://www.registeruz.sk" + href)
        await page.wait_for_timeout(2000)
        
        links = await page.locator("a").all_inner_texts()
        print("All link texts:")
        for t in links:
            if "Výročná" in t or "IFRS" in t or "Správa" in t or "Individuálna" in t:
                print(t.strip())
        
        await browser.close()

asyncio.run(run())
