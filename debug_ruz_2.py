import asyncio
from playwright.async_api import async_playwright

async def run():
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        page = await browser.new_page()
        await page.goto("https://www.registeruz.sk/cruz-public/domain/accountingentity/listsimplesearch")
        await page.get_by_role("textbox", name="Zadajte názov účtovnej").fill("31637051")
        await page.get_by_role("button", name="Vyhľadaj").first.click()
        await page.wait_for_timeout(2000)
        detail_links = await page.locator("a[href*='/cruz-public/domain/accountingentity/show/']").all()
        href = await detail_links[0].get_attribute("href")
        await page.goto("https://www.registeruz.sk" + href)
        await page.wait_for_timeout(2000)
        
        # Expand all "Výročné"
        await page.evaluate("""() => {
            document.querySelectorAll("tr").forEach(row => {
                if (row.textContent.includes("Výročná") || row.textContent.includes("Výročné")) {
                    const collapseBtn = row.querySelector("span.js-collapse.icon-collapsed");
                    if (collapseBtn) collapseBtn.click();
                }
            });
        }""")
        await page.wait_for_timeout(2000)
        
        links = await page.locator("a").all_inner_texts()
        print("After expanding Výročná:")
        for t in links:
            if "Výročná" in t or "VS" in t:
                print(t.strip())
        
        await browser.close()

asyncio.run(run())
