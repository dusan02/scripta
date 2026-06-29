import asyncio
from playwright.async_api import async_playwright

async def test():
    async with async_playwright() as p:
        b = await p.chromium.launch()
        c = await b.new_context()
        page = await c.new_page()
        await page.goto("https://www.registeruz.sk/cruz-public/domain/accountingentity/simplesearch")
        try:
            await page.get_by_role('link', name='Povoliť všetko').click(timeout=3000)
        except:
            pass
        await page.get_by_role("textbox", name="Zadajte názov účtovnej").fill("46958819")
        await page.get_by_role("button", name="Vyhľadaj").first.click()
        await page.wait_for_timeout(2000)
        
        detail_links = await page.locator("a[href*='/cruz-public/domain/accountingentity/show/']").all()
        href = await detail_links[0].get_attribute("href")
        await page.goto("https://www.registeruz.sk" + href)
        await page.wait_for_timeout(2000)
        
        # Click the first row to expand
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
        
        # Click the 'Úč MUJ: Účtovná závierka' link
        links = await page.locator("a:has-text('Úč MUJ: Účtovná závierka')").all()
        if links:
            href_muj = await links[0].get_attribute("href")
            await page.goto("https://www.registeruz.sk" + href_muj)
            await page.wait_for_timeout(2000)
            
            # Check if there is a download button
            dl_btn = await page.locator("a:has-text('Stiahnuť'), a:has-text('Zobraziť')").all()
            print("Download buttons found:", len(dl_btn))
            
            html = await page.content()
            print("Page content length:", len(html))
            
            # check tabs
            tabs = await page.locator("a.nav-link").all()
            for t in tabs:
                print("TAB:", await t.inner_text())
                
        await b.close()

asyncio.run(test())
