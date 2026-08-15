import logging
import re
from datetime import datetime, timedelta
from typing import Optional

from src.models import OrsrForensics

logger = logging.getLogger(__name__)


def _count_section_changes(text: str, section_label: str) -> tuple[int, list[datetime]]:
    """Count historical changes in an ORSR section by counting (od: ... do: ...) patterns.

    Returns (change_count, list_of_start_dates).
    """
    if not text:
        return (0, [])

    section_start = text.find(section_label + ":")
    if section_start == -1:
        return (0, [])

    # Get section text — from label to next label
    after_section = text[section_start + len(section_label) + 1:]
    lines = after_section.split("\n")

    section_lines: list[str] = []
    _LABEL_RE = re.compile(r'^[A-ZÁ-Ž][a-zá-ž]+\s*[a-zá-ž]*:')
    _SUBLABELS = {"vznik funkcie", "konanie menom", "spôsob konania", "dátum aktualizácie"}
    for line in lines[1:]:
        stripped = line.strip()
        if not stripped:
            if section_lines:
                continue
            continue
        if _LABEL_RE.match(stripped) and len(stripped) < 60:
            if stripped.lower().split(":")[0].strip() in _SUBLABELS:
                section_lines.append(stripped)
                continue
            break
        section_lines.append(stripped)

    section_text = "\n".join(section_lines)

    # Count "vymazané" markers — each represents a person/entity leaving
    deleted_count = section_text.lower().count("vymazan")

    # Count (od: DD.MM.YYYY do: DD.MM.YYYY) patterns — each represents a change
    date_range_re = re.compile(r'\(od:\s*(\d{2})\.(\d{2})\.(\d{4})\s*(?:do:\s*(\d{2})\.(\d{2})\.(\d{4}))?\)')
    matches = date_range_re.findall(section_text)

    # Extract start dates for turnover analysis
    start_dates: list[datetime] = []
    for m in matches:
        try:
            d, mo, y = int(m[0]), int(m[1]), int(m[2])
            start_dates.append(datetime(y, mo, d))
        except (ValueError, IndexError):
            continue

    # Change count = number of date ranges + deleted markers
    # (each date range = a person/entity was added or removed)
    change_count = len(matches) + deleted_count

    return (change_count, start_dates)


def _determine_high_turnover(statutory_dates: list[datetime]) -> bool:
    """High turnover risk if >= 3 statutory changes in the last 2 years."""
    if not statutory_dates:
        return False
    cutoff = datetime.now() - timedelta(days=730)
    recent = [d for d in statutory_dates if d >= cutoff]
    return len(recent) >= 3


async def analyze_orsr_history(
    full_text: str,
    model: str = "",
    report_language: str = "sk",
) -> OrsrForensics:
    """Deterministická forenzná analýza Úplného výpisu z ORSR (bez LLM).

    Počíta zmeny štatutáru a sídla regexom z (od: ... do: ...) patternov.
    has_virtual_seat a has_foreign_statutory sa dopĺňajú v verdict_builder.py.
    """
    if not full_text:
        return OrsrForensics()

    try:
        statutory_count, statutory_dates = _count_section_changes(full_text, "Štatutárny orgán")
        address_count, _ = _count_section_changes(full_text, "Sídlo")
        high_turnover = _determine_high_turnover(statutory_dates)

        return OrsrForensics(
            statutory_changes_count=statutory_count,
            address_changes_count=address_count,
            has_virtual_seat=False,  # dopĺňa sa v verdict_builder.py
            has_foreign_statutory=False,  # dopĺňa sa v verdict_builder.py
            high_turnover_risk=high_turnover,
        )
    except Exception as e:
        logger.error(f"Error v analyze_orsr_history (deterministic): {e}")
        return OrsrForensics()
