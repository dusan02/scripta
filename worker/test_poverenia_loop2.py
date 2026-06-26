"""Test Poverenia — priamy URL prístup pre rýchly loop."""
import asyncio
from playwright.async_api import async_playwright

ICOS = [
    "52835812", "54577667", "50447599", "51144930", "31609082", "46150307",
    "31433618", "47245689", "45948585", "44934939", "36580368", "36754994",
    "36191621", "31642314", "51320347", "35722371", "36327239", "47959614",
    "35901608", "44396996", "31389147", "51954761", "44266049", "36077631",
    "50584944", "48211311", "48216631", "35846925", "44609582", "36021296",
    "35878771", "50362534", "50293877", "36641791", "48061557", "36005932",
    "53051505", "36042153", "50096681", "36306410", "52063372", "47562498",
    "00679500", "36269620", "36588946", "36280208", "50453947", "44852550",
    "48170429", "46370196", "36513563", "47250101", "00633496", "35825979",
    "46995714", "45393877", "50359495", "46560998", "50567845", "35711019",
    "31404227", "54769019", "44819943", "47858630", "45586730", "45696721",
    "51477157", "44960859", "48093661", "31702791", "45865108", "36515426",
    "50639293", "44183143", "36336530", "55325751", "31728251", "52913643",
    "46558195", "52659984", "36576433", "50688278", "31620507", "51705044",
    "52215971", "36638064", "46225854", "35726270", "36650544", "46009663",
    "50706730", "36412597", "47898810", "36650757", "51424045", "44685203",
    "52882187", "34109919", "45937273", "36545732", "44287135", "36592595",
    "44626975", "46730010", "50693344", "44532474", "46138811", "52058611",
    "51801477", "36050342", "50193287", "47196793", "44758901", "36017086",
    "46766928", "46972641", "53745272", "36577057", "36339351", "44623577",
    "44720998", "36358037", "31712673", "47248211", "54154774", "47689081",
    "45511772", "45261687", "36449521", "36509981", "31722849", "34125302",
    "46948651", "36256561", "47384476", "31633072", "44991631", "36248959",
    "35853182", "46012117", "46489932", "53521498", "36328570", "52291120",
    "48155381", "36577588", "36343781", "50657348", "35707313", "31560172",
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
                if len(positive_found) <= 3:
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
