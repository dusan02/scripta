import asyncio
from playwright.async_api import async_playwright
async def test():
    async with async_playwright() as p:
        b = await p.chromium.launch()
        c = await b.new_context()
        page = await c.new_page()
        await page.goto("https://www.registeruz.sk/cruz-public/domain/accountingentity/listsimplesearch")
        await page.get_by_role("textbox", name="Zadajte názov účtovnej").fill("54030617") # any random SRO, wait let's just see
        await page.get_by_role("button", name="Vyhľadaj").first.click()
        await page.wait_for_timeout(2000)
        detail_links = await page.locator("a[href*='/cruz-public/domain/accountingentity/show/']").all()
        if not detail_links:
            print("No detail")
            return
        href = await detail_links[0].get_attribute("href")
        await page.goto("https://www.registeruz.sk" + href)
        await page.wait_for_timeout(2000)
        
        await page.evaluate("""() => {
            document.querySelectorAll('.item').forEach(item => {
                const a = item.querySelector('a.js-collapse');
                if (a && a.textContent.includes('Individuá')) {
                    const collapseBtn = a.querySelector('span.js-collapse.icon-collapsed');
                    if (collapseBtn) collapseBtn.click();
                    else a.click();
                }
            });
        }""")
        await page.wait_for_timeout(2000)
        links = await page.locator("a:has-text('účtovná závierka'), a:has-text('Účtovná závierka'), a:has-text('IFRS účtovná závierka'), a:has-text('Správa audítora')").all()
        for link in links:
            print(await link.inner_text())
        await b.close()
asyncio.run(test())
