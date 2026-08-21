from __future__ import annotations
import re
from datetime import datetime
from typing import List, Optional
from pydantic import BaseModel, Field

# Slovenské akademické tituly pre očistu mena
ACADEMIC_TITLES = {
    "ing", "mgr", "mudr", "mddr", "mvdr", "bc", "bca", "judr",
    "phdr", "rndr", "pharmdr", "thdr", "thlic", "paeddr", "dr",
    "prof", "doc", "akad", "phd", "dba", "edd", "dsc", "drsc",
    "csc", "dis", "etds", "mba",
    "ll.m", "ll.b", "ll.d", "j.d",
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
    rozhodnutia_date_from: Optional[str] = None  # YYYY-MM-DD or None for default 1 year
    vestnik_date_from: Optional[str] = None  # YYYY-MM-DD or None for default 1 year
    report_language: Optional[str] = "sk"  # sk | en | de
    attachments_config: Optional[dict[str, bool]] = None  # kategória → on/off; None = default


class PersonInfo(BaseModel):
    """Informácie o osobe extrahovanej z ORSR (štatutár, spoločník)."""
    raw_name: str           # Pôvodné meno s titulmi (Ing. Peter Kurucz, PhD.)
    clean_name: str         # Meno bez titulov (Peter Kurucz)
    city: Optional[str] = None
    zip_code: Optional[str] = None
    role: str               # "statutar" | "spolocnik" | "dozorna_rada"
    capital_contribution: Optional[float] = None  # Vklad v EUR (pre spoločníkov)
    capital_paid: Optional[float] = None           # Splatené v EUR
    function_start: Optional[datetime] = None      # Dátum vzniku funkcie (z ORSR "(od: ...)")
    function_end: Optional[datetime] = None        # Dátum zániku funkcie (z ORSR "(do: ...)")
    is_active: bool = True                          # False = bývalý štatutár/spoločník


class OrsrForensics(BaseModel):
    """Forenzná analýza historických dát z ORSR."""
    statutory_changes_count: int = 0
    address_changes_count: int = 0
    has_virtual_seat: bool = False
    has_foreign_statutory: bool = False
    high_turnover_risk: bool = False

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
    raw_data: Optional[list] = None  # Štruktúrované dáta z API (JSON) — pre PDF Reader Agent
    full_extract_text: Optional[str] = None  # Celý text "Úplného výpisu" pre ORSR Forensics
    checked_at: Optional[str] = None  # ISO timestamp when scraper finished (for PDF transparency)
    # ── ORSR structured fields (for bulk seeding) ──
    share_capital: Optional[float] = None       # Základné imanie v EUR
    signing_authority: Optional[str] = None     # Konanie menom spoločnosti
    business_activity: Optional[str] = None     # Predmet podnikania (činnosti)

    @property
    def message(self) -> Optional[str]:  # backward compat alias
        return self.status_message
