import asyncio
from playwright.async_api import async_playwright

async def test():
    async with async_playwright() as p:
        b = await p.chromium.launch()
        c = await b.new_context()
        page = await c.new_page()
        await page.goto("https://www.registeruz.sk/cruz-public/domain/accountingentity/show/10268418")
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
        links = await page.locator("a:has-text('účtovná závierka'), a:has-text('Účtovná závierka')").all()
        
        for link in links:
            href = await link.get_attribute("href")
            text = await link.inner_text()
            parent_text = await link.evaluate("node => { let el = node.closest('.item') || node.closest('tr'); return el ? el.innerText : ''; }")
            print(f"TEXT: {text}")
            print(f"HREF: {href}")
            print(f"PARENT: {parent_text[:50]}")
        await b.close()

asyncio.run(test())
