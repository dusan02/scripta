from pathlib import Path
from src.pdf.compiler import PdfCompiler
from src.models import ScrapedSource

results_dir = Path("/Users/dusanbaran/Desktop/Projects/scripta/worker/test_results")
report_dir = results_dir / "test-vw-pdf3"
report_dir.mkdir(parents=True, exist_ok=True)

# Create a truly empty/corrupted PDF
(report_dir / "orsr_35757442.pdf").write_text("not a pdf")

sources = [
    ScrapedSource(source_type="ORSR", status="SUCCESS", file_path=str(report_dir / "orsr_35757442.pdf"), page_count=1, start_page=None, findings="Aktívna spoločnosť."),
]

compiler = PdfCompiler(results_dir)
try:
    final_path = compiler.compile(
        report_request_id="test-vw-pdf3",
        target_type="COMPANY",
        identifier="IČO 35757442",
        sources=sources,
    )
    print(f"OK: {final_path}")
except Exception as e:
    import traceback
    traceback.print_exc()
    print(f"ERROR: {e}")
