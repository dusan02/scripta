import asyncio
from pathlib import Path
from PyPDF2 import PdfReader
from playwright.async_api import async_playwright

async def main():
    output = Path("/Users/dusanbaran/Desktop/Projects/scripta/worker/test_results/playwright_test.pdf")
    output.parent.mkdir(parents=True, exist_ok=True)
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        page = await browser.new_page()
        await page.goto("https://example.com")
        await page.pdf(path=str(output), format="A4", print_background=True)
        await browser.close()

    try:
        reader = PdfReader(str(output))
        print(f"OK: Playwright PDF has {len(reader.pages)} pages")
    except Exception as e:
        print(f"ERROR reading Playwright PDF: {type(e).__name__}: {e}")

asyncio.run(main())
