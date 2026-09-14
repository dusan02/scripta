from pathlib import Path
from src.pdf.compiler import PdfCompiler
from src.models import ScrapedSource

results_dir = Path("/Users/dusanbaran/Desktop/Projects/scripta/worker/test_results")
results_dir.mkdir(parents=True, exist_ok=True)

# Create dummy PDF files for some sources
report_dir = results_dir / "test-vw-pdf2"
report_dir.mkdir(parents=True, exist_ok=True)

# Generate a simple PDF using reportlab
from reportlab.pdfgen import canvas
from reportlab.lib.pagesizes import A4

dummy_pdf = report_dir / "dummy.pdf"
c = canvas.Canvas(str(dummy_pdf), pagesize=A4)
c.drawString(100, 700, "Dummy PDF for testing")
c.save()

sources = [
    ScrapedSource(source_type="ORSR", status="SUCCESS", file_path=str(report_dir / "orsr_35757442.pdf"), page_count=1, start_page=None, findings="Aktívna spoločnosť."),
    ScrapedSource(source_type="ZRSR", status="SUCCESS", file_path=str(report_dir / "zrsr_35757442.pdf"), page_count=1, start_page=None, findings="Aktívny záväzok."),
    ScrapedSource(source_type="RPVS", status="SUCCESS", file_path=str(report_dir / "rpvs_35757442.pdf"), page_count=1, start_page=None, findings="Subjekt je evidovaný."),
    ScrapedSource(source_type="INSOLVENCY", status="SUCCESS", file_path=str(report_dir / "insolvency_35757442.pdf"), page_count=1, start_page=None, findings="Subjekt nie je v insolvencii."),
]

compiler = PdfCompiler(results_dir)
try:
    final_path = compiler.compile(
        report_request_id="test-vw-pdf2",
        target_type="COMPANY",
        identifier="IČO 35757442",
        sources=sources,
    )
    print(f"OK: {final_path}")
except Exception as e:
    import traceback
    traceback.print_exc()
    print(f"ERROR: {e}")
