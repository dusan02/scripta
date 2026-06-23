from pathlib import Path
from src.pdf.compiler import PdfCompiler
from src.models import ScrapedSource

results_dir = Path("/Users/dusanbaran/Desktop/Projects/scripta/worker/test_results")
results_dir.mkdir(parents=True, exist_ok=True)

# Simulujeme 4 zdroje ako keby boli SUCCESS (file_path=None -> start_page=None)
sources = [
    ScrapedSource(source_type="ORSR", status="SUCCESS", file_path=None, page_count=1, start_page=None, findings="Aktívna spoločnosť."),
    ScrapedSource(source_type="ZRSR", status="SUCCESS", file_path=None, page_count=1, start_page=None, findings="Aktívny záväzok."),
    ScrapedSource(source_type="RPVS", status="SUCCESS", file_path=None, page_count=1, start_page=None, findings="Subjekt je evidovaný."),
    ScrapedSource(source_type="INSOLVENCY", status="SUCCESS", file_path=None, page_count=1, start_page=None, findings="Subjekt nie je v insolvencii."),
]

compiler = PdfCompiler(results_dir)
try:
    final_path = compiler.compile(
        report_request_id="test-vw-pdf",
        target_type="COMPANY",
        identifier="IČO 35757442",
        sources=sources,
    )
    print(f"OK: {final_path}")
except Exception as e:
    import traceback
    traceback.print_exc()
    print(f"ERROR: {e}")
