import os
import re
import logging
import fitz
from pathlib import Path

from src.config import settings

logger = logging.getLogger(__name__)

# Rozšírený vzor pre poznámky — slovenčina aj angličtina
_NOTES_PATTERN = re.compile(
    r"(?i)^\s*[\d\.\s]*"
    r"(?:NOTES\s+TO|POZNÁMKY\s+K|EXPLANATORY\s+NOTES|NOTES\s+AND\s+DISCLOSURES)"
    r".*?(?:FINANCIAL\s+STATEMENTS?|ÚČTOVN[EÉ][JI]\s+ZÁVIERKE?|ANNUAL\s+ACCOUNTS?)?",
    re.MULTILINE,
)

# Kľúčové slová pre identifikáciu konca finančných tabuliek
# (strana s týmito slovami na začiatku je prvá strana poznámok — odrežeme pred ňou)
_NOTES_START_SIGNALS = [
    r"^\s*notes\s+to\s+the\s+financial",
    r"^\s*notes\s+to\s+the\s+consolidated",
    r"^\s*notes\s+to\s+the\s+annual",
    r"^\s*poznámky\s+k\s+(?:individuálnej|konsolidovanej|účtovnej)",
    r"^\s*(?:\d+\.?\s+)?explanatory\s+notes",
    r"^\s*(?:\d+\.?\s+)?significant\s+accounting\s+policies",
    r"^\s*(?:\d+\.?\s+)?summary\s+of\s+significant",
    r"^\s*zásady\s+účtovania",
    r"^\s*prehľad\s+dôležitých\s+účtovných",
]
_NOTES_COMPILED = [re.compile(p, re.IGNORECASE | re.MULTILINE) for p in _NOTES_START_SIGNALS]

# Maximálny počet strán pre rôzne typy závierok (centralized in config.py)
_MAX_PAGES_SK_GAAP = settings.pdf_max_pages_sk_gaap
_MAX_PAGES_IFRS = settings.pdf_max_pages_ifrs
_MAX_PAGES_ABSOLUTE = settings.pdf_max_pages_absolute


def _detect_ifrs_from_text(text: str) -> bool:
    """Rýchla detekcia IFRS z textu prvých pár strán."""
    text_lower = text.lower()
    return any(kw in text_lower for kw in (
        "international financial reporting standards",
        "ifrs",
        "ias ",
        "statement of financial position",
        "statement of comprehensive income",
        "medzinárodnými štandardmi pre finančné výkazníctvo",
        "medzinarodnymi standardmi pre financne vykaznictvo",
        "účtovná závierka zostavená v súlade",
        "v súlade s medzinárodnými",
        "výročná správa",
        "konsolidovan",
    ))


def _is_notes_page(page_text: str) -> bool:
    """Vráti True ak strana vyzerá ako začiatok poznámok."""
    # Vylúčime strany s obsahom (table of contents) — tie často obsahujú "Poznámky k účtovnej závierke" v zozname
    if re.search(r"(?i)(?:^\s*obsah\s*:|^\s*contents\s*:)", page_text, re.MULTILINE):
        return False
    for pattern in _NOTES_COMPILED:
        if pattern.search(page_text):
            return True
    return False


def extract_core_financials(pdf_path: str) -> str:
    """
    Číta PDF finančnej závierky a extrahuje kľúčové strany do nového PDF.
    Orezáva pri nájdení sekcie Poznámky / Notes.

    Vylepšenia oproti pôvodnej verzii:
    - Dynamický limit strán: SK GAAP = 20, IFRS = 60 (opravuje problém s ESET a inými IFRS firmami)
    - Rozšírený notes_pattern pre anglické závierky (Notes to the Financial Statements atď.)
    - Detekcia IFRS z textu prvých strán → automaticky zvýši limit
    - Zachováva pôvodné správanie pre TXT súbory (vráti None)
    """
    if not pdf_path.lower().endswith(".pdf"):
        return None

    doc = fitz.open(pdf_path)
    total_pages = len(doc)

    if total_pages == 0:
        doc.close()
        return ""

    # Detekujeme typ závierky z prvých 10 strán (veľké IFRS firmy majú marketing/ESG na prvých 5-10 stranách)
    preview_text = ""
    for i in range(min(10, total_pages)):
        preview_text += doc[i].get_text("text")
    is_ifrs = _detect_ifrs_from_text(preview_text)

    # Fallback pre scanned PDF (0 textu): ak má PDF 30+ strán a žiadny text, pravdepodobne je to
    # scanned IFRS výročná správa veľkej firmy — použijeme IFRS limit
    if not is_ifrs and len(preview_text.strip()) < 50 and total_pages >= settings.pdf_scanned_min_pages:
        is_ifrs = True
        logger.info(
            f"[PDF] {os.path.basename(pdf_path)} | Scanned PDF detected ({total_pages} pages, no text) — using IFRS mode"
        )

    max_pages = _MAX_PAGES_IFRS if is_ifrs else _MAX_PAGES_SK_GAAP

    pages_to_extract = []
    found_notes = False

    for i in range(total_pages):
        page = doc[i]
        text = page.get_text("text")

        # Kontrola na strane Poznámok
        # Pre IFRS závierky začíname hľadať poznámky neskôr (od strany 20),
        # aby sme predišli predčasnému orezaniu výkazov (napr. Kaufland má výkazy na str. 11-14).
        min_notes_page = settings.pdf_ifrs_min_notes_page if is_ifrs else settings.pdf_sk_gaap_min_notes_page
        
        if i >= min_notes_page and _is_notes_page(text):
            found_notes = True
            break

        pages_to_extract.append(i)

        # Dynamický limit
        if i >= max_pages - 1:
            break

    doc_type_label = "IFRS" if is_ifrs else "SK_GAAP"
    logger.info(
        f"[PDF] {os.path.basename(pdf_path)} | typ={doc_type_label} | "
        f"strán_celkom={total_pages} | extrahovaných={len(pages_to_extract)} | "
        f"poznámky_nájdené={found_notes}"
    )

    # Vytvorenie nového PDF s orezanými stranami
    out_doc = fitz.open()
    for page_num in pages_to_extract:
        out_doc.insert_pdf(doc, from_page=page_num, to_page=page_num)

    doc.close()

    if len(out_doc) == 0:
        out_doc.close()
        return ""

    original_path = Path(pdf_path)
    temp_pdf_path = original_path.with_name(f"{original_path.stem}_sliced.pdf")

    out_doc.save(str(temp_pdf_path))
    out_doc.close()

    return str(temp_pdf_path)


def slice_narrative_pdf(pdf_path: str, max_pages: int = 15) -> str:
    """
    Oreže výročnú správu (VS) na prvých X strán, pretože manažérska správa
    (naratíva) sa zvyčajne nachádza úplne na začiatku. Zvyšok (tabuľky) nepotrebujeme.
    """
    if not pdf_path.lower().endswith(".pdf"):
        return None

    doc = fitz.open(pdf_path)
    total_pages = len(doc)

    if total_pages <= max_pages:
        doc.close()
        return None # Netreba orezávať

    new_pdf_path = pdf_path.replace(".pdf", "_sliced_vs.pdf")
    new_doc = fitz.open()

    for i in range(max_pages):
        new_doc.insert_pdf(doc, from_page=i, to_page=i)

    new_doc.save(new_pdf_path)
    new_doc.close()
    doc.close()
    
    import logging
    logging.getLogger(__name__).info(
        f"[PDF VS Slicing] {os.path.basename(pdf_path)} | "
        f"strán_celkom={total_pages} | extrahovaných={max_pages}"
    )

    return new_pdf_path
