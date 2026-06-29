import asyncio
from playwright.async_api import async_playwright
import json

async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        page = await browser.new_page()
        # GET company detail
        resp = await page.goto("https://www.registeruz.sk/cruz-public/api/uctovna-jednotka?ico=46958819")
        data = await resp.json()
        print("Company:", json.dumps(data, indent=2)[:500])
        
        # Take the first idUctovnychZavierok
        if "idUctovnychZavierok" in data and data["idUctovnychZavierok"]:
            zavierka_id = data["idUctovnychZavierok"][-1]
            print("\nFetching Zavierka:", zavierka_id)
            resp = await page.goto(f"https://www.registeruz.sk/cruz-public/api/uctovna-zavierka?id={zavierka_id}")
            zavierka = await resp.json()
            print("Zavierka:", json.dumps(zavierka, indent=2)[:500])
            
            if "idUctovnychVykazov" in zavierka and zavierka["idUctovnychVykazov"]:
                vykaz_id = zavierka["idUctovnychVykazov"][0]
                print("\nFetching Vykaz:", vykaz_id)
                resp = await page.goto(f"https://www.registeruz.sk/cruz-public/api/uctovny-vykaz?id={vykaz_id}")
                vykaz = await resp.json()
                print("Vykaz:", json.dumps(vykaz, indent=2)[:1000])

        await browser.close()

asyncio.run(main())
