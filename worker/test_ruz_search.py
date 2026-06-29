import asyncio
from playwright.async_api import async_playwright
async def test():
    async with async_playwright() as p:
        b = await p.chromium.launch()
        c = await b.new_context()
        page = await c.new_page()
        await page.goto("https://www.registeruz.sk/cruz-public/domain/accountingentity/listsimplesearch")
        await page.get_by_role("textbox", name="Zadajte názov účtovnej").fill("54030617")
        await page.get_by_role("button", name="Vyhľadaj").first.click()
        await page.wait_for_timeout(2000)
        detail_links = await page.locator("a[href*='/cruz-public/domain/accountingentity/show/']").all()
        href = await detail_links[0].get_attribute("href")
        print(href)
        await b.close()
asyncio.run(test())
