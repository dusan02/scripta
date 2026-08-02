import os
import pytest
import fitz
from src.pdf_ingestion import extract_core_financials

@pytest.fixture
def dummy_pdf_path(tmp_path):
    # Create a dummy PDF with 10 pages where page 5 is the Notes section.
    # Each page has enough text to exceed the 1000-char scanned-PDF threshold.
    pdf_path = tmp_path / "dummy_financials.pdf"
    doc = fitz.open()

    # Core statements (Pages 0-4) — ~200 chars each = ~1000 total
    for i in range(5):
        page = doc.new_page()
        text = f"Core Financial Statement Page {i+1}\n" + ("X" * 200)
        page.insert_text((50, 50), text)

    # Notes section starts at Page 5
    page = doc.new_page()
    page.insert_text((50, 50), "Company XYZ\nNOTES TO THE FINANCIAL STATEMENTS\n1. General Information\n" + ("Y" * 200))

    # More Notes (Pages 6-9)
    for i in range(4):
        page = doc.new_page()
        page.insert_text((50, 50), f"More Notes Page {i+7}\n" + ("Z" * 200))

    doc.save(str(pdf_path))
    doc.close()

    return str(pdf_path)

def test_extract_core_financials(dummy_pdf_path):
    result = extract_core_financials(dummy_pdf_path)

    # Function returns a path to a sliced PDF file (or None for scanned PDFs)
    assert result is not None, "extract_core_financials should return a file path for text-based PDF"
    assert result.endswith(".pdf"), f"Expected a .pdf path, got: {result}"
    assert "_sliced" in result, f"Expected _sliced in filename, got: {result}"

    # Verify the sliced PDF contains core pages but not notes
    import fitz
    sliced_doc = fitz.open(result)
    all_text = ""
    for i in range(len(sliced_doc)):
        all_text += sliced_doc[i].get_text("text")
    sliced_doc.close()

    # Should contain core statement pages
    assert "Core Financial Statement Page 1" in all_text, "Sliced PDF should contain page 1"
    assert "Core Financial Statement Page 5" in all_text, "Sliced PDF should contain page 5"

    # Should NOT contain the Notes section
    assert "NOTES TO THE FINANCIAL STATEMENTS" not in all_text, "Notes should be excluded"
    assert "More Notes Page 7" not in all_text, "Notes pages should be excluded"
