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
    # English IFRS headings
    r"^\s*notes\s+to\s+the\s+financial",
    r"^\s*notes\s+to\s+the\s+consolidated",
    r"^\s*notes\s+to\s+the\s+annual",
    r"^\s*(?:\d+\.?\s+)?explanatory\s+notes",
    r"^\s*(?:\d+\.?\s+)?significant\s+accounting\s+policies",
    r"^\s*(?:\d+\.?\s+)?summary\s+of\s+significant",
    r"^\s*(?:\d+\.?\s+)?notes\s*$",  # Just "Notes" as a standalone heading
    r"^\s*(?:\d+\.?\s+)?reporting\s+entity",  # Common first IFRS note
    r"^\s*(?:\d+\.?\s+)?general\s+information",  # Common first IFRS note
    # Slovak headings
    r"^\s*poznámky\s+k\s+(?:individuálnej|konsolidovanej|účtovnej)",
    r"^\s*poznámky\s+k\s+účtovnej\s+závierke",
    r"^\s*poznámky\s*$",  # Just "Poznámky" as standalone heading
    r"^\s*príloha\s+k\s+(?:individuálnej|konsolidovanej|účtovnej)",  # Príloha k účtovnej závierke
    r"^\s*príloha\s*$",  # Just "Príloha"
    r"^\s*zásady\s+účtovania",
    r"^\s*prehľad\s+dôležitých\s+účtovných",
    r"^\s*(?:\d+\.?\s+)?všeobecné\s+informácie",  # Common first SK note
    r"^\s*(?:\d+\.?\s+)?informácie\s+o\s+(?:spoločnosti|subjekte)",  # Common first SK note
]
_NOTES_COMPILED = [re.compile(p, re.IGNORECASE | re.MULTILINE) for p in _NOTES_START_SIGNALS]

# Maximálny počet strán pre rôzne typy závierok (centralized in config.py)
# Read dynamically — pdf_max_pages_ifrs and pdf_max_pages_absolute_limit are @property (Expert Mode aware)
_MAX_PAGES_SK_GAAP = settings.pdf_max_pages_sk_gaap


def _get_max_pages_ifrs() -> int:
    return settings.pdf_max_pages_ifrs


def _get_max_pages_absolute() -> int:
    return settings.pdf_max_pages_absolute_limit


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

    # Scanned PDF detection: ak celý PDF má < 1000 znakov textu, je to naskenovaný dokument.
    # V takom prípade neorezávaj — pošleme celý PDF do Gemini Vision (model vie čítať obrázky).
    if total_pages >= 10:
        all_text = preview_text
        for i in range(min(10, total_pages), total_pages):
            all_text += doc[i].get_text("text")
        if len(all_text.strip()) < 1000:
            doc.close()
            logger.info(
                f"[PDF] {os.path.basename(pdf_path)} | SCANNED PDF ({total_pages} pages, {len(all_text.strip())} chars) "
                f"— skipping slicing, sending full PDF to Gemini Vision"
            )
            return None  # None = nepoužiť sliced verziu, pošli celý PDF

    max_pages = _get_max_pages_ifrs() if is_ifrs else _MAX_PAGES_SK_GAAP

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


def slice_narrative_pdf(pdf_path: str, max_pages: int = 50) -> str:
    """
    Inteligentne oreže výročnú správu (VS) pre narrative extraction.

    Pôvodná logika (slepý limit 20 strán) mohla stratiť dôležité informácie
    (litigation, financing, subsequent events, akvizície) nachádzajúce sa
    na stranách 40-70 veľkých IFRS výročných správ.

    Nová logika (2026-08):
    - ≤ max_pages (default 50): vráti None → celý PDF sa pošle do LLM
    - > max_pages: inteligentný slicing:
      * Vždy zachovať prvých 15 strán (executive summary, management report)
      * Keyword-based detection pre neskoršie stránky (financing, investments,
        acquisitions, litigation, subsequent events, going concern, strategy, risks)
      * Limit na max_pages (50) + deduplikácia
    - Scanned PDF (< 1000 chars): vždy celý PDF do Gemini Vision
    """
    if not pdf_path.lower().endswith(".pdf"):
        return None

    doc = fitz.open(pdf_path)
    total_pages = len(doc)

    if total_pages <= max_pages:
        doc.close()
        return None  # Netreba orezávať — pošleme celý PDF

    # Scanned PDF detection: ak PDF má < 1000 znakov textu, je to naskenovaný dokument.
    # Neorezávaj — pošleme celý PDF do Gemini Vision (model vie čítať obrázky).
    all_text = ""
    for i in range(total_pages):
        all_text += doc[i].get_text("text")
    if len(all_text.strip()) < 1000:
        doc.close()
        logger.info(
            f"[PDF VS] {os.path.basename(pdf_path)} | SCANNED PDF ({total_pages} pages, {len(all_text.strip())} chars) "
            f"— skipping slicing, sending full PDF to Gemini Vision"
        )
        return None

    # ── Inteligentný slicing pre veľké VS (> 50 strán) ────────────────────
    # Vždy zachovať prvých 15 strán (executive summary, management report,
    # strategy, business development). Potom keyword scan pre zvyšné stránky.
    front_pages = 15
    narrative_section_keywords = re.compile(
        r"(?i)"
        # Financing / úvery / dlh
        r"(financovan|úver|uver|dlhopis|bond|loan|borrowing|credit\s+facility"
        r"|refinanc|leasing|lízing|interest[-\s]bearing|debt\s+to"
        r"|capital\s+structure|financ(?:ial|ing)\s+(risk|policy|strategy))"
        # Investments / CAPEX
        r"|(invest[íi]c|obstaran|CAPEX|capital\s+expenditure"
        r"|acquisition\s+of\s+(PPE|property|equipment|intangible)"
        r"|purchase\s+of\s+(property|equipment|machinery)"
        r"|investment\s+(plan|program|commitment|property))"
        # Acquisitions / disposals / business combinations
        r"|(akviz[íi]c|prevzat|k[úu]pa\s+(spoločn|podniku|podiel)"
        r"|predaj\s+(spoločn|podniku|podiel|dcérsk|akci[íi])"
        r"|business\s+combination|acquisition|disposal"
        r"|consolidat(?:ion|ed)\s+(acquisition|investment|subsidiar))"
        # Litigation / súdne spory / právne riziká
        r"|(súdn\w+\s+spor|litigation|legal\s+proceed|súdny\s+disput"
        r"|claim|dispute|arbitration|contingent\s+liabilit"
        r"|kontingent|pr[áa]vne\s+rizik|legal\s+risk)"
        # Subsequent events / udalosti po súvahovom dni
        r"|(udalost(?:i|iam)?\s+po|po\s+súvahov(?:om|ej)\s+dn"
        r"|subsequent\s+event|events\s+after\s+(reporting|balance\s+sheet)"
        r"|post[-\s]balance\s+sheet|non[-\s]adjusting)"
        # Going concern / continuity
        r"|(going\s+concern|continuit|pokračov(?:an|ov)\s+(?:v\s+činnost|podnikan)"
        r"|upadnut|insolvenc|reštruktural|bankrot|likvidác"
        r"|going\s+concern\s+(risk|doubt|uncertaint))"
        # Strategy / outlook / future plans
        r"|(strat[ée]g|outlook|future\s+(plan|development|outlook|prospect)"
        r"|pl[áa]novan(?:é|ie|á)\s+(invest|rozvoj|expanz|akviz)"
        r"|rozvoj\s+(podnikan|obchod|výrob|trh)"
        r"|pl[áa]n\s+(rozvoja|investíci|expanz))"
        # Risk factors / riziká
        r"|(risk\s+factor|hlavn[ée]\s+rizik[áa]|kľúčov[ée]\s+rizik[áa]"
        r"|pr[íi]nos(?:né|ové)\s+rizik|risk\s+management"
        r"|riadenie\s+rizik|risk(?:s|y)\s+(and|a)\s+(challenge|uncertaint))"
        # Management / governance / zmeny
        r"|(management\s+report|spr[áa]va\s+(predstavenstv|manažment|konateľ)"
        r"|zmen[ay]\s+(v\s+predstavenstv|v\s+manažment|štatut[áa]r)"
        r"|board\s+of\s+(director|governor)|governance|corporate\s+governance)"
        # Restructuring / reorganization
        r"|(reštrukturaliz[áa]c|reorganiz[áa]c|transform[áa]c"
        r"|restructuring|reorganization)"
        # Capital changes / emisia akcií
        r"|(nav[ýy]š(?:en(?:ie|ia)|ov)\s+kapit[áa]l|emis(?:ia|ie)\s+(akci[íi]|cenn[ýy]ch)"
        r"|capital\s+increase|share\s+issuance|rights\s+issue"
        r"|registered\s+capital|základn[ée]\s+imanie)"
    )

    relevant_pages = set(range(min(front_pages, total_pages)))
    keyword_hits = 0
    for i in range(front_pages, total_pages):
        page_text = doc[i].get_text("text")
        if narrative_section_keywords.search(page_text):
            relevant_pages.add(i)
            keyword_hits += 1
            # Pridáme 1 stranu pred a po pre kontext
            if i > 0:
                relevant_pages.add(i - 1)
            if i < total_pages - 1:
                relevant_pages.add(i + 1)

    pages_to_extract = sorted(relevant_pages)
    # Hard limit: max_pages (50) — ak je viac, odrežeme z konca
    if len(pages_to_extract) > max_pages:
        pages_to_extract = pages_to_extract[:max_pages]

    new_pdf_path = pdf_path.replace(".pdf", "_sliced_vs.pdf")
    new_doc = fitz.open()
    for page_num in pages_to_extract:
        new_doc.insert_pdf(doc, from_page=page_num, to_page=page_num)

    new_doc.save(new_pdf_path)
    new_doc.close()
    doc.close()

    logger.info(
        f"[PDF VS Slicing] {os.path.basename(pdf_path)} | "
        f"INTELLIGENT | strán_celkom={total_pages} | "
        f"front_pages={min(front_pages, total_pages)} | "
        f"keyword_hits={keyword_hits} | "
        f"extrahovaných={len(pages_to_extract)}"
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
    min_notes_page = (settings.pdf_ifrs_min_notes_page - 10) if is_ifrs else settings.pdf_sk_gaap_min_notes_page

    for i in range(min_notes_page, total_pages):
        page_text = doc[i].get_text("text")
        if _is_notes_page(page_text):
            notes_start_page = i
            break

    if notes_start_page == -1:
        # Fallback: notes are always at the end of financial statements.
        # If we can't find the heading, use the last 30 pages (or all pages if < 30).
        fallback_start = max(0, total_pages - 30)
        logger.info(
            f"[PDF Notes Slicing] {os.path.basename(pdf_path)} | "
            f"NO NOTES HEADING FOUND — using fallback: last {total_pages - fallback_start} pages (from page {fallback_start})"
        )
        notes_start_page = fallback_start

    # ── Keyword-based slicing ──────────────────────────────────────────────
    # Kľúčové slová pre forenznú analýzu — slovenské aj anglické varianty
    forensic_keywords = re.compile(
        r"(?i)"
        r"(spriaznen|sprevoden|prepojen[áé]\s+osob|related\s+part"
        r"|podsúvah|off[\s-]?balance|ručen|guarantee|kontingent"
        r"|contingent|súdn\w+\s+spor|litigation|legal\s+proceed"
        r"|sankc|pokut|porušen|daňov[áé]\s+kontrol|tax\s+audit"
        r"|insolvenc|reštruktural|bankrot|likvidác"
        r"|zástavn|pledge|collateral|záložn"
        r"|nedoplat|arrears|tax\s+debt|daňov[ýé]\s+d[lh]"
        r"|environmental|enviro|emis|CO2|carbon"
        r"|antikorup|corrupt|bribe|úplat)"
    )

    # ── Narrative/business keywords (P0 rozšírenie 2026-08) ───────────────
    # Zachytáva informácie, ktoré sú v Notes PDF, ale pôvodný forensic filter
    # ich neobsahoval: CAPEX, financovanie, subsequent events, rezervy,
    # akvizície, navýšenie kapitálu, reštrukturalizácia.
    # Bez tohto sa tieto informácie nikdy nedostanú do LLM inputu.
    narrative_keywords = re.compile(
        r"(?i)"
        # CAPEX / investície / obstaranie majetku
        r"(invest[íi]c|obstaran|dlhodob[ýý]\s+(majetok|nehmotn|hmotn)"
        r"|CAPEX|capital\s+expenditure|acquisition\s+of\s+(PPE|property)"
        r"|purchase\s+of\s+(property|equipment|machinery|intangible)"
        r"|pr[íi]cun\s+invest|prírastok|nadobudnut)"
        # Úvery / financovanie / refinancovanie / leasing / dlhopisy
        r"|(úver|uver|financovan|refinanc|dlhopis|bond|loan|borrowing"
        r"|bankov[ýý]\s+úver|leasing|lízing|hire\s+purchase"
        r"|credit\s+facility|term\s+loan|financial\s+liabilit)"
        # Subsequent events / udalosti po súvahovom dni
        r"|(udalost(?:i|iam)?\s+po|po\s+súvahov(?:om|ej)\s+dn"
        r"|subsequent\s+event|events\s+after\s+(reporting|balance\s+sheet)"
        r"|non[-\s]adjusting|post[-\s]balance)"
        # Rezervy / provisions (okrem kontingent — ten je v forensic)
        r"|(rezerv(?:a|y|ou|ám)?\s+(?:na|z)|tvorba\s+rezerv"
        r"|provision\s+for|reserve\s+for|rezervov(?:an[áé]|anie))"
        # Akvizície / predaje / business combinations
        r"|(akviz[íi]c|prevzat|k[úu]pa\s+(spoločn|podniku|podiel)"
        r"|predaj\s+(spoločn|podniku|podiel|dcérsk|akci[íi])"
        r"|business\s+combination|acquisition\s+(of|costs)"
        r"|disposal\s+(of|group)|consolidat(?:ion|ed)\s+(acquisition|investment))"
        # Navýšenie kapitálu / emisia akcií
        r"|(nav[ýy]š(?:en(?:ie|ia)|ov)\s+kapit[áa]l|emis(?:ia|ie)\s+(akci[íi]|cenn[ýy]ch)"
        r"|capital\s+increase|share\s+issuance|rights\s+issue"
        r"|registered\s+capital|základn[ée]\s+imanie)"
        # Reštrukturalizácia (širšie než forensic — aj prevádzková)
        r"|(reštrukturaliz[áa]c|reorganiz[áa]c|transform[áa]c"
        r"|restructuring|reorganization)"
    )

    relevant_pages = set()
    for i in range(notes_start_page, total_pages):
        page_text = doc[i].get_text("text")
        if forensic_keywords.search(page_text) or narrative_keywords.search(page_text):
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
            f"KEYWORD-BASED (forensic+narrative) | od_strany={notes_start_page} | "
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


def format_page_range(pages: list[int]) -> str:
    """
    Konvertuje zoznam strán na kompaktný reťazec.
    Príklad: [1,2,3,5,6,7,10] → "1-3,5-7,10"
    Prázdny zoznam → ""
    """
    if not pages:
        return ""
    sorted_pages = sorted(set(pages))
    ranges = []
    start = sorted_pages[0]
    end = sorted_pages[0]
    for p in sorted_pages[1:]:
        if p == end + 1:
            end = p
        else:
            ranges.append(f"{start}-{end}" if start != end else str(start))
            start = p
            end = p
    ranges.append(f"{start}-{end}" if start != end else str(start))
    return ",".join(ranges)


def get_sliced_pdf_page_range(pdf_path: str) -> str:
    """
    Vráti page range string pre sliced PDF (napr. "1-15" alebo "1-3,5-7,10").
    Pre sliced PDF sú strány 1-indexed (prvá strana sliced PDF = strana 1).
    """
    try:
        doc = fitz.open(pdf_path)
        pages = list(range(1, len(doc) + 1))
        doc.close()
        return format_page_range(pages)
    except Exception:
        return ""

