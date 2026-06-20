import asyncio
from playwright.async_api import async_playwright

async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        page = await browser.new_page()
        
        # 1. ORSR (Eset ICO = 31333624)
        print("Fetching ORSR...")
        await page.goto("https://www.orsr.sk/hladaj_ico.asp?ICO=31333624&SID=0")
        orsr_html = await page.content()
        with open("orsr.html", "w", encoding="utf-8") as f:
            f.write(orsr_html)
            
        # 2. ZRSR
        print("Fetching ZRSR...")
        await page.goto("https://www.zrsr.sk/zr_ico.aspx")
        await page.fill("input[name='ICO']", "31333624")
        await page.click("input[type='submit']")
        await page.wait_for_load_state("networkidle")
        zrsr_html = await page.content()
        with open("zrsr.html", "w", encoding="utf-8") as f:
            f.write(zrsr_html)
            
        # 3. RU Justice
        print("Fetching RU Justice...")
        await page.goto("https://ru.justice.sk/ru-verejnost-web/pages/searchForm.xhtml")
        ru_html = await page.content()
        with open("ru_justice.html", "w", encoding="utf-8") as f:
            f.write(ru_html)
            
        await browser.close()
        print("Done.")

if __name__ == "__main__":
    asyncio.run(main())
