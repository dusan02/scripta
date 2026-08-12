"""LLM text sanitization — detects and cleans garbled/hallucinated text."""

import re


def _is_garbled(text: str) -> bool:
    if not text or len(text) < 10:
        return False
    # Cyrillic characters in Slovak text = garbled extraction
    cyrillic = sum(1 for c in text if '\u0400' <= c <= '\u04FF')
    # CJK characters
    cjk = sum(1 for c in text if '\u4e00' <= c <= '\u9fff')
    # Arabic
    arabic = sum(1 for c in text if '\u0600' <= c <= '\u06ff')
    non_latin = cyrillic + cjk + arabic
    if non_latin >= 3:
        return True
    # High ratio of non-alpha, non-space chars (garbled encoding)
    alpha = sum(1 for c in text if c.isalpha())
    if len(text) > 20 and alpha / len(text) < 0.4:
        return True
    return False


def sanitize_llm_text(text: str) -> str:
    """Sanitizuje LLM generovaný text pre PDF rendering.
    - Odstráni LaTeX $...$ syntax a nahradí ju plain textom
    - Opraví časté preklepy slovenských slov
    - Detekuje a nahradzuje garbled text z PDF extrakcie
    - Konvertuje Unicode znaky, ktoré by sa mohli skomiť
    """
    if not text:
        return text
    # Garbled text detection — PDF extraction artefacts with mixed scripts
    if _is_garbled(text):
        return ""
    # LaTeX $...$ → plain text (zachová vnútro)
    text = re.sub(r'\$([^$]+)\$', r'\1', text)
    # LaTeX ^{...} a _{...} → plain text
    text = re.sub(r'\^[\{]([^}]+)[\}]', r'\1', text)
    text = re.sub(r'\^\{([^}]+)\}', r'\1', text)
    text = re.sub(r'\\prime\\prime', "''", text)
    text = re.sub(r"\\prime", "'", text)
    text = re.sub(r"\\pm", "+/-", text)
    text = re.sub(r"\\times", "x", text)
    text = re.sub(r"\\leq", "<=", text)
    text = re.sub(r"\\geq", ">=", text)
    text = re.sub(r"\\neq", "!=", text)
    text = re.sub(r"\\approx", "~", text)
    # Bežné preklepy z LLM
    text = text.replace("dižnik", "dlžník").replace("dižníkov", "dlžníkov").replace("dižníci", "dlžníci")
    text = text.replace("dihoch", "dlhoch").replace("dihodobo", "dlhodobo")
    text = text.replace("poiožiek", "položiek").replace("poiožka", "položka")
    text = text.replace("bezúhonnost", "bezúhonnosť")
    text = text.replace("Interpretica", "Interpretácia")
    text = text.replace("Rezpečná", "Bezpečná")
    text = text.replace("Plotroski", "Piotroski")
    text = text.replace("Dövera", "Dôvera")
    text = re.sub(r'\bDöver', 'Dôver', text)  # all declensions: Dôvery, Dôverou, etc.
    text = re.sub(r'\bsüd', 'súd', text)      # all declensions: súdov, súdom, súdy, etc.
    text = re.sub(r'\bSüd', 'Súd', text)      # capitalized forms
    text = text.replace("Fimra", "Firma").replace("Fimia", "Firma")
    # Compound forms from scraper findings — health insurance dlžníci
    text = text.replace("Dôveradižníci", "Dôvera — dlžníci").replace("Dôvera-dižníci", "Dôvera — dlžníci")
    text = text.replace("Dôveradlžníci", "Dôvera — dlžníci").replace("Dôvera-dlžníci", "Dôvera — dlžníci")
    text = text.replace("VšZP-dižníci", "VšZP — dlžníci").replace("VšZPdižníci", "VšZP — dlžníci")
    text = text.replace("VšZP-dlžníci", "VšZP — dlžníci")
    text = text.replace("Union-dižníci", "Union — dlžníci").replace("Uniondižníci", "Union — dlžníci")
    text = text.replace("Union-dlžníci", "Union — dlžníci")
    text = text.replace("SP-dižníci", "SP — dlžníci").replace("SPdižníci", "SP — dlžníci")
    text = text.replace("SP-dlžníci", "SP — dlžníci")
    # Generic regex fallback — catches any remaining dižn* OCR artefacts not caught above
    text = re.sub(r'\bdižník\b', 'dlžník', text)
    text = re.sub(r'\bdižníkov\b', 'dlžníkov', text)
    text = re.sub(r'\bdižníci\b', 'dlžníci', text)
    text = re.sub(r'\bdižníkmi\b', 'dlžníkmi', text)
    text = re.sub(r'\bdižníkovi\b', 'dlžníkovi', text)
    text = re.sub(r'\bdat\b(?=\s*\))', 'dát', text)  # "dat)" → "dát)"
    text = re.sub(r'F-score:\s*(\d)/B\b', r'F-score: \1/8', text)
    # Restore diacritics lost in PDF extraction — common Slovak words
    text = text.replace("nema negativne", "nemá negatívne")
    text = text.replace("negativne zaznamy", "negatívne záznamy")
    text = text.replace("registri upadcov", "registri úpadcov")
    text = text.replace("zaznamy v registri", "záznamy v registri")
    # Force lowercase "ale" — LLM často ignoruje prompt inštrukciu
    text = re.sub(r'\bALE\b', 'ale', text)
    return text

