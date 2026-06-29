import os
import re
import fitz
from pathlib import Path

def extract_core_financials(pdf_path: str) -> str:
    """
    Reads a PDF financial statement and extracts the core pages up to the Notes section.
    Saves the extracted pages to a temporary PDF and returns its file path.
    This optimized PDF is ready for Multimodal LLM ingestion.
    """
    doc = fitz.open(pdf_path)
    
    notes_pattern = re.compile(
        r"(?i)^\s*[\d\.\s]*(?:NOTES|POZNÁMKY).*?(?:FINANCIAL STATEMENTS|ÚČTOVNEJ ZÁVIERKE)"
    )
    
    pages_to_extract = []
    found_notes = False
    
    for i in range(len(doc)):
        page = doc[i]
        text = page.get_text("text")
        lines = text.strip().split('\n')
        
        if i > 1:
            non_empty_lines = [line.strip() for line in lines if line.strip()]
            for j in range(min(15, len(non_empty_lines))):
                if notes_pattern.search(non_empty_lines[j]):
                    found_notes = True
                    break
        
        if found_notes:
            break
            
        pages_to_extract.append(i)
        
        if i >= 14:  # Hard limit: cut at page 15 (0-indexed 14)
            break
            
    # Vytvorenie nového PDF s orezanými stranami
    out_doc = fitz.open()
    for page_num in pages_to_extract:
        out_doc.insert_pdf(doc, from_page=page_num, to_page=page_num)
        
    doc.close()
    
    if len(out_doc) == 0:
        out_doc.close()
        return ""
        
    # Uložíme do dočasného súboru v rovnakej zložke ako originál
    original_path = Path(pdf_path)
    temp_pdf_path = original_path.with_name(f"{original_path.stem}_sliced.pdf")
    
    out_doc.save(str(temp_pdf_path))
    out_doc.close()
    
    return str(temp_pdf_path)
