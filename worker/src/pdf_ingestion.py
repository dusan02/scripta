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
    if re.search(r"(?i)(?:^\s*obsah\s*[:\n]|^\s*contents\s*[:\n])", page_text, re.MULTILINE):
        return False
        
    for line in page_text.split('\n'):
        for pattern in _NOTES_COMPILED:
            if pattern.search(line):
                # Skontrolujeme, či riadok s "poznámkami" nie je súčasťou obsahu (TOC)
                # Obsah často vyzerá ako: "Poznámky k účtovnej závierke ....... 15"
                if re.search(r'(?:\.{3,}|\t{2,})\s*\d*', line) or re.search(r'\s{5,}\d+\s*$', line):
                    continue
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


def chunk_pdf_by_pages(pdf_path: str, chunk_size: int = 5, overlap: int = 1, max_pages: int = 60) -> list[dict]:
    """
    Rozdelí PDF na n-stránkové chunky (súčasne vytvorí fyzické dočasné PDF súbory) s prekrytím.
    Vracia zoznam slovníkov s metadátami, ktoré sa posielajú do LLM.
    """
    if not pdf_path or not pdf_path.lower().endswith(".pdf"):
        return []

    try:
        doc = fitz.open(pdf_path)
    except Exception as e:
        logger.warning(f"Nepodarilo sa otvoriť PDF pre chunking {pdf_path}: {e}")
        return []

    total_pages = min(len(doc), max_pages)
    
    if total_pages == 0:
        doc.close()
        return []

    chunks = []
    chunk_id = 1
    
    step = chunk_size - overlap
    if step <= 0:
        step = 1

    for start_page in range(0, total_pages, step):
        end_page = min(start_page + chunk_size, total_pages)
        if start_page >= end_page:
            break
            
        out_doc = fitz.open()
        for page_num in range(start_page, end_page):
            out_doc.insert_pdf(doc, from_page=page_num, to_page=page_num)
            
        original_path = Path(pdf_path)
        temp_pdf_path = original_path.with_name(f"{original_path.stem}_chunk_{chunk_id}.pdf")
        out_doc.save(str(temp_pdf_path))
        out_doc.close()
        
        chunks.append({
            "pdf_path": str(temp_pdf_path),
            "chunk_id": chunk_id,
            "page_range": list(range(start_page + 1, end_page + 1)),
            "source_pdf": os.path.basename(pdf_path)
        })
        
        chunk_id += 1
        
        if end_page == total_pages:
            break

    doc.close()
    return chunks


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

def slice_notes_pdf(pdf_path: str, max_notes_pages: int = 25) -> str:
    """
    Vyhľadá začiatok Poznámok (Notes) a vyextrahuje relevantné strany do nového PDF.

    Používa keyword-based slicing: namiesto slepého orezania prvých 25 strán
    skenuje celý dokument pre kľúčové slová (spriaznené osoby, podsúvahové záväzky,
    kontingentné riziká) a extrahuje len tie strany + 1 stranu kontextu.
    Fallback na pôvodných 25 strán ak sa kľúčové slová nenájdu.
    """
    if not pdf_path.lower().endswith(".pdf"):
        return None

    doc = fitz.open(pdf_path)
    total_pages = len(doc)
    if total_pages == 0:
        doc.close()
        return None

    # Najprv detekujeme typ závierky, aby sme vedeli kde začať hľadať poznámky
    preview_text = ""
    for i in range(min(10, total_pages)):
        preview_text += doc[i].get_text("text")
    is_ifrs = _detect_ifrs_from_text(preview_text)

    if not is_ifrs and len(preview_text.strip()) < 50 and total_pages >= settings.pdf_scanned_min_pages:
        is_ifrs = True

    notes_start_page = -1
    min_notes_page = settings.pdf_ifrs_min_notes_page if is_ifrs else settings.pdf_sk_gaap_min_notes_page

    for i in range(min_notes_page, total_pages):
        page_text = doc[i].get_text("text")
        if _is_notes_page(page_text):
            notes_start_page = i
            break

    if notes_start_page == -1:
        doc.close()
        return None

    # ── Keyword-based slicing ──────────────────────────────────────────────
    # Kľúčové slová pre forenznú analýzu — slovenské aj anglické varianty
    forensic_keywords = re.compile(
        r"(?i)"
        r"(spriaznen|sprevoden|prepojen[áé]\s+osob|related\s+part"
        r"|podsúvah|off[\s-]?balance|ručen|guarantee|kontingent"
        r"|contingent|súdn\w+\s+spor|litigation|legal\s+proceed)"
    )

    relevant_pages = set()
    for i in range(notes_start_page, total_pages):
        page_text = doc[i].get_text("text")
        if forensic_keywords.search(page_text):
            relevant_pages.add(i)
            # Pridáme 1 stranu pred a po pre kontext
            if i > notes_start_page:
                relevant_pages.add(i - 1)
            if i < total_pages - 1:
                relevant_pages.add(i + 1)

    new_pdf_path = pdf_path.replace(".pdf", "_sliced_notes.pdf")
    new_doc = fitz.open()

    if relevant_pages:
        # Keyword-based: extrahuj len relevantné strany
        pages_to_extract = sorted(relevant_pages)
        # Limit na max_notes_pages + 10 (keyword-based môže byť o niečo viac)
        hard_limit = max_notes_pages + 10
        if len(pages_to_extract) > hard_limit:
            pages_to_extract = pages_to_extract[:hard_limit]

        for page_num in pages_to_extract:
            new_doc.insert_pdf(doc, from_page=page_num, to_page=page_num)

        logger.info(
            f"[PDF Notes Slicing] {os.path.basename(pdf_path)} | "
            f"KEYWORD-BASED | od_strany={notes_start_page} | "
            f"relevantných_strán={len(pages_to_extract)} | "
            f"strany={pages_to_extract[:10]}{'...' if len(pages_to_extract) > 10 else ''}"
        )
    else:
        # Fallback: pôvodná logika — prvých 25 strán od začiatku Notes
        end_page = min(notes_start_page + max_notes_pages, total_pages)
        for i in range(notes_start_page, end_page):
            new_doc.insert_pdf(doc, from_page=i, to_page=i)

        logger.info(
            f"[PDF Notes Slicing] {os.path.basename(pdf_path)} | "
            f"FALLBACK (no keywords) | od_strany={notes_start_page} | "
            f"extrahovaných={end_page - notes_start_page}"
        )

    new_doc.save(new_pdf_path)
    new_doc.close()
    doc.close()

    return new_pdf_path


# ── Keyword-based PDF text extraction pre Chief Auditora ────────────────────
# Namiesto posielania celého PDF textu (môže byť 200K+ tokenov pre Slovnaft),
# extrahujeme len riadky obsahujúce forenzné kľúčové slová + kontext.

_FORENSIC_PDF_KEYWORDS = re.compile(
    r"(?i)"
    r"(?:dlh|záväzok|exekúc|konkurz|likvidác|reštruktural"
    r"|nesplaten|nedoplat|daňový|poisťov"
    r"|súd|spor|príkaz|rozsudok|upadnut|úpadca"
    r"|insolv|bankrot|odklon|vyrovnan"
    r"|poveren|exekútor|exekút"
    r"|diskvalif|zákaz|obmedzen"
    r"|ručiteľ|záruka|garant)"
)

_CONTEXT_LINES = 5
_MAX_CHUNKS_PER_PDF = 50
_MAX_CHARS_PER_PDF = 30_000


def extract_relevant_pdf_chunks(pdf_path: str) -> str:
    """
    Extrahuje len forenzne relevantné časti z PDF textu.
    Pre každý riadok s kľúčovým slovom pridá N riadkov nad a pod pre kontext.
    Vracia textový string alebo prázdny string ak PDF nemá relevantný obsah.
    """
    try:
        doc = fitz.open(pdf_path)
    except Exception as e:
        logger.warning(f"Nepodarilo sa otvoriť PDF {pdf_path}: {e}")
        return ""

    full_text = ""
    for page in doc:
        full_text += page.get_text("text")
    doc.close()

    if not full_text.strip():
        return ""

    lines = full_text.split("\n")
    relevant_line_indices = set()
    for i, line in enumerate(lines):
        if _FORENSIC_PDF_KEYWORDS.search(line):
            start = max(0, i - _CONTEXT_LINES)
            end = min(len(lines), i + _CONTEXT_LINES + 1)
            for j in range(start, end):
                relevant_line_indices.add(j)

    if not relevant_line_indices:
        return full_text[:2000].strip()

    chunks = []
    sorted_indices = sorted(relevant_line_indices)
    prev = -1
    chunk_count = 0

    for idx in sorted_indices:
        if chunk_count >= _MAX_CHUNKS_PER_PDF:
            chunks.append("\n[... ďalšie výskyty vynechané ...]\n")
            break
        if prev >= 0 and idx > prev + 1:
            chunks.append("\n[... vynechaný text ...]\n")
        chunks.append(lines[idx])
        prev = idx
        chunk_count += 1

    result = "\n".join(chunks).strip()
    if len(result) > _MAX_CHARS_PER_PDF:
        result = result[:_MAX_CHARS_PER_PDF] + "\n[... text skrátený ...]\n"

    return result

