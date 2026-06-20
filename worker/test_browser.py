import asyncio
from playwright.async_api import async_playwright

async def main():
    print("⏳ Inicializujem Playwright...")
    async with async_playwright() as p:
        try:
            print("⏳ Spúšťam Chromium...")
            browser = await p.chromium.launch(headless=True)
            print("✅ Chromium úspešne beží!")
            await browser.close()
            print("✅ Prehliadač zatvorený. Všetko funguje.")
        except Exception as e:
            print(f"❌ Chyba pri spúšťaní Chromia:\n{e}")

if __name__ == "__main__":
    asyncio.run(main())
