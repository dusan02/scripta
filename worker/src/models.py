from __future__ import annotations
from typing import List, Optional
from pydantic import BaseModel, Field


class ReportTask(BaseModel):
    report_request_id: str
    target_type: str = Field(..., pattern="^(COMPANY|PERSON)$")
    ico: Optional[str] = None
    name: Optional[str] = None
    surname: Optional[str] = None
    birth_date: Optional[str] = None
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
