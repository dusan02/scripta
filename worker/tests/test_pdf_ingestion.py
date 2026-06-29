import os
import pytest
import fitz
from src.pdf_ingestion import extract_core_financials

@pytest.fixture
def dummy_pdf_path(tmp_path):
    # Create a dummy PDF with 10 pages where page 5 is the Notes section
    pdf_path = tmp_path / "dummy_financials.pdf"
    doc = fitz.open()
    
    # Core statements (Pages 0-4)
    for i in range(5):
        page = doc.new_page()
        page.insert_text((50, 50), f"Core Financial Statement Page {i+1}")
        
    # Notes section starts at Page 5
    page = doc.new_page()
    page.insert_text((50, 50), "Company XYZ\nNOTES TO THE SEPARATE FINANCIAL STATEMENTS\n1. General Information")
    
    # More Notes (Pages 6-9)
    for i in range(4):
        page = doc.new_page()
        page.insert_text((50, 50), f"More Notes Page {i+7}")
        
    doc.save(str(pdf_path))
    doc.close()
    
    return str(pdf_path)

def test_extract_core_financials(dummy_pdf_path):
    result_md = extract_core_financials(dummy_pdf_path)
    
    # The output should not be empty
    assert result_md.strip() != ""
    
    # It should contain the core statements
    assert "Core Financial Statement Page 1" in result_md
    assert "Core Financial Statement Page 5" in result_md
    
    # It should NOT contain the Notes section
    assert "NOTES TO THE SEPARATE FINANCIAL STATEMENTS" not in result_md
    assert "More Notes Page 7" not in result_md
