import asyncio
import sys
from pathlib import Path
from playwright.async_api import async_playwright
from src.pdf.compiler import PdfCompiler
from src.models import ScrapedSource
from src.scrapers.registry import run_scrapers

async def main():
    results_dir = Path("/Users/dusanbaran/Desktop/Projects/scripta/worker/test_results")
    report_dir = results_dir / "test-vw-flow"
    report_dir.mkdir(parents=True, exist_ok=True)

    print("Launching browser...")
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)

        print("Running scrapers for ICO 52252256...")
        try:
            sources = await run_scrapers(
                sources=["ORSR", "ZRSR", "RPVS", "INSOLVENCY"],
                output_dir=report_dir,
                browser=browser,
                target_type="COMPANY",
                ico="52252256",
            )
        except Exception as e:
            print(f"Scraper error: {e}")
            import traceback
            traceback.print_exc()
            return
        finally:
            await browser.close()

    print(f"Got {len(sources)} sources:")
    for s in sources:
        print(f"  {s.source_type}: {s.status} | file={s.file_path} | pages={s.page_count} | findings={s.findings}")

    # Extrahujeme obchodné meno, ak ho niektorý úspešný scraper získal
    company_name = None
    for s in sources:
        if s.status == "SUCCESS" and getattr(s, "company_name", None):
            company_name = s.company_name
            break

    print("\nCompiling PDF...")
    compiler = PdfCompiler(results_dir)
    try:
        final_path = compiler.compile(
            report_request_id="test-vw-flow",
            target_type="COMPANY",
            identifier="IČO 52252256",
            sources=sources,
            company_name=company_name,
        )
        print(f"OK: {final_path}")
    except Exception as e:
        import traceback
        traceback.print_exc()
        print(f"ERROR: {e}")

asyncio.run(main())
