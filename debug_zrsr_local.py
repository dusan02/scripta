import asyncio
from playwright.async_api import async_playwright, TimeoutError

async def main():
    # Spúšťame prehliadač viditeľne (headless=False), aby si videl na vlastné oči, čo to robí
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True) # Spomalil som to (slow_mo), nech to stíhaš sledovať
        page = await browser.new_page()
        
        print("1. Navigujem na hlavnú stránku...")
        await page.goto("https://www.zrsr.sk/index")
        
        print("2. Vypĺňam IČO: 36801577 (GEMO SLOVENSKO)")
        await page.click("label[for='how-filtered-ico']", timeout=10000)
        await page.fill("input#filter_ico", "36801577")
        
        print("3. Riešim Altcha (Nie som robot)...")
        try:
            await page.click("altcha-widget", timeout=5000)
            # Čakáme, kým sa vygeneruje hash a vyplní do skrytého inputu
            await page.wait_for_function(
                'document.querySelector("input[name=\\"altcha\\"]") && document.querySelector("input[name=\\"altcha\\"]").value !== ""',
                timeout=10000
            )
            print("   Altcha úspešne vyriešená!")
        except Exception as e:
            print("   Altcha widget sa nenašiel alebo zlyhal:", e)

        print("4. Odosielam formulár a čakám na načítanie výsledkov...")
        async with page.expect_navigation(timeout=30000):
            await page.click("input[name='cmdPotvrdit']", timeout=10000)
            
        print("5. Hľadám odkaz na detail firmy...")
        try:
            # Čakáme kým sa renderuje výsledok
            await page.wait_for_selector("a.govuk-link[href*='Detail'], a.govuk-link[href*='detail']", timeout=10000)
            detail_link = page.locator("a.govuk-link[href*='Detail'], a.govuk-link[href*='detail']").first
            
            if await detail_link.count() > 0:
                href = await detail_link.get_attribute("href")
                print(f"   Našiel som odkaz: {href}")
                print("6. Klikám na detail a čakám na novú stránku...")
                
                async with page.expect_navigation(timeout=30000):
                    await detail_link.click(timeout=10000)
                
                print("7. Overujem, či sa správne načítal Výpis...")
                try:
                    await page.wait_for_selector("text=Výpis zo živnostenského registra", timeout=10000)
                    print("   ✅ Všetko OK! Výpis sa úspešne načítal.")
                except TimeoutError:
                    html = await page.content()
                    if "Odkaz je neplatný" in html:
                        print("   ❌ CHYBA: Štátny portál vrátil 'Odkaz je neplatný'.")
                    else:
                        print("   ⚠️ UPOZORNENIE: Stránka sa načítala, ale nenašiel sa text výpisu.")
            else:
                print("   ❌ CHYBA: Odkaz na detail sa nenašiel v DOMe.")
                
        except Exception as e:
            print("   ❌ CHYBA pri hľadaní detailu:", e)
            
        print("8. Vytváram PDF dôkaz (ukladám ako zrsr_debug_vypis.pdf)...")
        await page.emulate_media(media="screen")
        await page.pdf(
            path="zrsr_debug_vypis.pdf",
            format="A4",
            print_background=True,
            margin={"top": "20px", "right": "20px", "bottom": "20px", "left": "20px"}
        )
        print("   ✅ PDF úspešne uložené!")
            
        print("Hotovo! Prehliadač sa zatvorí o 5 sekúnd...")
        await page.wait_for_timeout(5000)
        await browser.close()

if __name__ == "__main__":
    asyncio.run(main())
