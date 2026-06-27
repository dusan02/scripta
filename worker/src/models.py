from __future__ import annotations
import re
from typing import List, Optional
from pydantic import BaseModel, Field

# Slovenské akademické tituly pre očistu mena
ACADEMIC_TITLES = {
    "ing.", "mgr.", "mudr.", "mddr.", "mvdr.", "bc.", "bca.", "judr.",
    "phdr.", "rndr.", "pharmdr.", "thdr.", "thlic.", "paeddr.", "dr.",
    "prof.", "doc.", "akad.", "phd.", "dba", "edd.", "dsc.", "drsc.",
    "csc.", "dis.", "etds.", "mba",
}

ZIP_RE = re.compile(r'\b(\d{3}\s*\d{2})\b')


def strip_titles(raw_name: str) -> str:
    """Odstráni akademické tituly z mena, vráti len Meno Priezvisko."""
    words = raw_name.split()
    name_words = [w for w in words if w.lower().rstrip(".,") not in ACADEMIC_TITLES]
    return " ".join(name_words).strip()


class ReportTask(BaseModel):
    report_request_id: str
    target_type: str = Field(..., pattern="^COMPANY$")
    ico: str
    sources: List[str]
    orsr_extract_type: Optional[str] = "CURRENT"
    crz_date_from: Optional[str] = None  # YYYY-MM-DD or None for default 1 year


class PersonInfo(BaseModel):
    """Informácie o osobe extrahovanej z ORSR (štatutár, spoločník)."""
    raw_name: str           # Pôvodné meno s titulmi (Ing. Peter Kurucz, PhD.)
    clean_name: str         # Meno bez titulov (Peter Kurucz)
    city: Optional[str] = None
    zip_code: Optional[str] = None
    role: str               # "statutar" alebo "spolocnik"


class ScrapedSource(BaseModel):
    source_type: str
    status: str  # SUCCESS, FAILED, UNAVAILABLE
    status_message: Optional[str] = None
    file_path: Optional[str] = None
    page_count: Optional[int] = None
    start_page: Optional[int] = None
    findings: Optional[str] = None
    company_name: Optional[str] = None
    ic_dph: Optional[str] = None
    persons: Optional[List[PersonInfo]] = None

    @property
    def message(self) -> Optional[str]:  # backward compat alias
        return self.status_message
