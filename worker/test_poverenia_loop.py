"""Test Poverenia — priamy URL prístup pre rýchly loop."""
import asyncio
from playwright.async_api import async_playwright

ICOS = [
    "1384315", "36527319", "31323936", "36620319", "52252256", "36445266",
    "36269727", "45866040", "31695426", "35829231", "46645454", "36532045",
    "51738961", "35801999", "51750155", "35926261", "44318596", "43821987",
    "51489236", "50085981", "47241381", "36753505", "36458554", "36474568",
    "45949573", "31573681", "31350623", "36303348", "31672019", "34138609",
    "31666442", "47204052", "35837152", "36031216", "31361269", "53601033",
    "51157021", "34152024", "50674749", "46716645", "35709596", "54063523",
    "36032930", "48095176", "44266847", "36365742", "44328419", "31734260",
    "45361819", "35816970", "35850655", "31733280", "36203611", "31446884",
    "46822798", "44225067", "35918608", "36192309", "53931424", "46071776",
    "36464147", "36450847", "46863117", "51124327", "50898841", "48289990",
    "44214375", "51025396", "47410051", "50995707", "44795718", "44629281",
    "46406425", "45424527", "51410991", "36582735", "36560448", "46241752",
    "44428791", "36705691", "31417361", "47398922", "35828064", "47975938",
    "45720134", "44956444", "47703865", "36667773", "52334228", "54552036",
]

NO_RESULTS_MARKERS = [
    "nebolo nájdené žiadne poverenie",
    "neexistuje žiadne poverenie",
]

async def main():
    pw = await async_playwright().start()
    browser = await pw.chromium.launch(headless=True, args=['--disable-blink-features=AutomationDetected'])
    context = await browser.new_context(locale="sk-SK", viewport={"width": 1920, "height": 1080})
    page = await context.new_page()

    positive_found = []

    for i, ico in enumerate(ICOS):
        url = f"https://obcan.justice.sk/pilot/poverenia/vysledky-vyhladavania?ico={ico}&page=1"
        try:
            await page.goto(url, timeout=20000, wait_until="domcontentloaded")
            try:
                await page.wait_for_load_state("networkidle", timeout=8000)
            except Exception:
                pass

            body_text = await page.inner_text("body")
            lowered = body_text.lower()
            no_results = any(m in lowered for m in NO_RESULTS_MARKERS)
            has_table = await page.locator("table").count() > 0
            has_poverenie_link = await page.locator("a[href*='poverenie']").count() > 0

            if no_results:
                status = "NEGATÍVNY"
            elif has_table or has_poverenie_link:
                status = "POZITÍVNY ★"
                positive_found.append(ico)
                if len(positive_found) == 1:
                    await page.screenshot(path=f"poverenia_positive_{ico}.png", full_page=True)
                    print(f"  >>> Screenshot: poverenia_positive_{ico}.png")
                snippet = body_text[:1200]
                print(f"  >>> Snippet:\n{snippet}\n")
            else:
                status = "NEJASNÝ ?"
                snippet = body_text[:600]
                print(f"  >>> Snippet:\n{snippet}\n")

            print(f"[{i+1}/{len(ICOS)}] IČO {ico}: {status}")
        except Exception as e:
            print(f"[{i+1}/{len(ICOS)}] IČO {ico}: CHYBA — {e}")

    print(f"\n=== Výsledok ===")
    print(f"Testovaných: {len(ICOS)}")
    print(f"Pozitívne: {len(positive_found)}")
    if positive_found:
        print(f"IČO s poverením: {', '.join(positive_found)}")
    else:
        print("Žiadny pozitívny záznam nenájdený.")

    await browser.close()
    await pw.stop()

asyncio.run(main())
