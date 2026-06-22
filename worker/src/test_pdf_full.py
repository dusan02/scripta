import asyncio
from pathlib import Path
from PyPDF2 import PdfReader
from src.pdf.compiler import PdfCompiler
from src.models import ScrapedSource
from playwright.async_api import async_playwright

async def main():
    results_dir = Path("/Users/dusanbaran/Desktop/Projects/scripta/worker/test_results")
    report_dir = results_dir / "test-vw-full"
    report_dir.mkdir(parents=True, exist_ok=True)

    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        # Generate 4 real PDFs via Playwright
        pages = []
        for i, name in enumerate(["orsr", "zrsr", "rpvs", "insolvency"]):
            page = await browser.new_page()
            await page.goto("https://example.com")
            pdf_path = report_dir / f"{name}_35757442.pdf"
            await page.pdf(path=str(pdf_path), format="A4", print_background=True)
            pages.append(page)
        for page in pages:
            await page.close()
        await browser.close()

    sources = [
        ScrapedSource(source_type="ORSR", status="SUCCESS", file_path=str(report_dir / "orsr_35757442.pdf"), page_count=1, start_page=None, findings="Aktívna spoločnosť."),
        ScrapedSource(source_type="ZRSR", status="SUCCESS", file_path=str(report_dir / "zrsr_35757442.pdf"), page_count=1, start_page=None, findings="Aktívny záväzok."),
        ScrapedSource(source_type="RPVS", status="SUCCESS", file_path=str(report_dir / "rpvs_35757442.pdf"), page_count=1, start_page=None, findings="Subjekt je evidovaný."),
        ScrapedSource(source_type="INSOLVENCY", status="SUCCESS", file_path=str(report_dir / "insolvency_35757442.pdf"), page_count=1, start_page=None, findings="Subjekt nie je v insolvencii."),
    ]

    compiler = PdfCompiler(results_dir)
    try:
        final_path = compiler.compile(
            report_request_id="test-vw-full",
            target_type="COMPANY",
            identifier="IČO 35757442",
            sources=sources,
        )
        print(f"OK: {final_path}")
        # Verify final PDF
        reader = PdfReader(str(final_path))
        print(f"Final PDF has {len(reader.pages)} pages")
    except Exception as e:
        import traceback
        traceback.print_exc()
        print(f"ERROR: {e}")

asyncio.run(main())
