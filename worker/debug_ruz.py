import asyncio
from playwright.async_api import async_playwright

async def debug():
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        page = await browser.new_page()
        print("Navigating...")
        await page.goto("https://www.registeruz.sk/cruz-public/domain/accountingentity/listsimplesearch")
        try:
            await page.get_by_role("link", name="Odmietnuť").click(timeout=3000)
        except:
            pass
        await page.get_by_role("textbox", name="Zadajte názov účtovnej").fill("31322832")
        await page.get_by_role("button", name="Vyhľadaj").first.click()
        await page.wait_for_timeout(2000)
        
        detail_links = await page.locator("a[href*='/cruz-public/domain/accountingentity/show/']").all()
        href = await detail_links[0].get_attribute("href")
        print("Detail href:", href)
        await page.goto("https://www.registeruz.sk" + href)
        await page.wait_for_timeout(2000)
        
        links = await page.evaluate("() => Array.from(document.querySelectorAll('a')).map(a => a.textContent.trim() + ' | ' + a.href)")
        for l in links:
            if "ávierk" in l or "práva" in l:
                print(l)
        await browser.close()

if __name__ == "__main__":
    asyncio.run(debug())
