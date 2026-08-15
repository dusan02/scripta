"""
Unit tests pre deterministic ORSR forensic parser (orsr_forensic.py).

Pokrýva:
  - _count_section_changes() — counting (od: ... do: ...) patterns
  - _determine_high_turnover() — turnover risk threshold
  - analyze_orsr_history() — end-to-end on sample ORSR text
  - Edge cases: empty text, missing sections, vymazané markers
"""
import pytest
from datetime import datetime, timedelta
from src.agents.orsr_forensic import (
    _count_section_changes,
    _determine_high_turnover,
    analyze_orsr_history,
)


SAMPLE_ORSR_FULL = """Obchodné meno:
"Test Firma s.r.o."
Sídlo:
Testová 123
811 01 Bratislava
(od: 01.01.2020 do: 15.06.2021)
Nová 456
811 02 Bratislava
Štatutárny orgán:
Ing. Ján Prvý
(od: 15.03.2010)
Mgr. Peter Druhý
(od: 10.05.2015 do: 20.12.2020)
vymazaný
Ing. Ján Tretí
(od: 01.01.2021)
Základné imanie:
5 000,00 EUR
"""

SAMPLE_NO_SECTIONS = """
Some random text without ORSR sections.
No statutory body or address here.
"""

SAMPLE_EMPTY_STATUTORY = """Obchodné meno:
"Empty s.r.o."
Štatutárny orgán:
Konateľ koná samostatne
Sídlo:
Hlavná 1
811 01 Bratislava
"""


class TestCountSectionChanges:
    """Test _count_section_changes for statutory and address sections."""

    def test_statutory_with_date_ranges_and_vymazane(self):
        """3 date ranges + 1 vymazané = 4 changes."""
        count, dates = _count_section_changes(SAMPLE_ORSR_FULL, "Štatutárny orgán")
        assert count == 4  # 3 (od:...) patterns + 1 "vymazaný"
        assert len(dates) == 3
        # Check dates parsed correctly
        years = [d.year for d in dates]
        assert 2010 in years
        assert 2015 in years
        assert 2021 in years

    def test_address_with_date_range(self):
        """1 date range in Sídlo = 1 change."""
        count, dates = _count_section_changes(SAMPLE_ORSR_FULL, "Sídlo")
        assert count == 1
        assert len(dates) == 1
        assert dates[0].year == 2020

    def test_missing_section_returns_zero(self):
        """Section label not found → (0, [])."""
        count, dates = _count_section_changes(SAMPLE_NO_SECTIONS, "Štatutárny orgán")
        assert count == 0
        assert dates == []

    def test_empty_text_returns_zero(self):
        """Empty string → (0, [])."""
        count, dates = _count_section_changes("", "Štatutárny orgán")
        assert count == 0
        assert dates == []

    def test_section_without_date_ranges(self):
        """Section exists but no (od:...) patterns → 0 changes."""
        count, dates = _count_section_changes(SAMPLE_EMPTY_STATUTORY, "Štatutárny orgán")
        assert count == 0
        assert dates == []

    def test_multiple_vymazane_markers(self):
        """Multiple 'vymazané' without date ranges are counted."""
        text = """Štatutárny orgán:
Ján Prvý
vymazaný
Peter Druhý
vymazaný
"""
        count, _ = _count_section_changes(text, "Štatutárny orgán")
        assert count == 2  # 2 vymazané, 0 date ranges

    def test_section_stops_at_next_label(self):
        """Parser should not count date ranges from subsequent sections."""
        text = """Štatutárny orgán:
Ing. Ján Prvý
(od: 15.03.2010)
Sídlo:
Testová 123
(od: 01.01.2020)
"""
        count, dates = _count_section_changes(text, "Štatutárny orgán")
        assert count == 1  # Only the statutory (od:...) should count
        assert len(dates) == 1


class TestDetermineHighTurnover:
    """Test _determine_high_turnover threshold logic."""

    def test_three_recent_changes_is_high_risk(self):
        """3 changes within last 2 years → True."""
        now = datetime.now()
        dates = [now - timedelta(days=30), now - timedelta(days=100), now - timedelta(days=200)]
        assert _determine_high_turnover(dates) is True

    def test_two_recent_changes_is_not_high_risk(self):
        """2 changes within last 2 years → False (threshold is >=3)."""
        now = datetime.now()
        dates = [now - timedelta(days=30), now - timedelta(days=100)]
        assert _determine_high_turnover(dates) is False

    def test_old_changes_are_not_high_risk(self):
        """3 changes but all >2 years old → False."""
        old = datetime.now() - timedelta(days=800)
        dates = [old, old + timedelta(days=1), old + timedelta(days=2)]
        assert _determine_high_turnover(dates) is False

    def test_empty_list_is_not_high_risk(self):
        """No dates → False."""
        assert _determine_high_turnover([]) is False

    def test_mixed_old_and_recent(self):
        """2 old + 2 recent → only recent count, 2 < 3 → False."""
        now = datetime.now()
        old = now - timedelta(days=800)
        dates = [old, old, now - timedelta(days=30), now - timedelta(days=100)]
        assert _determine_high_turnover(dates) is False

    def test_mixed_old_and_three_recent(self):
        """1 old + 3 recent → 3 recent >= 3 → True."""
        now = datetime.now()
        old = now - timedelta(days=800)
        dates = [old, now - timedelta(days=10), now - timedelta(days=50), now - timedelta(days=100)]
        assert _determine_high_turnover(dates) is True


class TestAnalyzeOrsrHistory:
    """End-to-end tests for analyze_orsr_history."""

    @pytest.mark.asyncio
    async def test_full_text_returns_forensics(self):
        """Full ORSR text → correct forensic metrics."""
        result = await analyze_orsr_history(SAMPLE_ORSR_FULL)
        assert result.statutory_changes_count == 4
        assert result.address_changes_count == 1
        assert result.has_virtual_seat is False  # set by verdict_builder
        assert result.has_foreign_statutory is False  # set by verdict_builder
        # 3 statutory dates, but only 1 is recent (2021) → not high turnover
        assert result.high_turnover_risk is False

    @pytest.mark.asyncio
    async def test_empty_text_returns_defaults(self):
        """Empty text → all defaults (zeros and False)."""
        result = await analyze_orsr_history("")
        assert result.statutory_changes_count == 0
        assert result.address_changes_count == 0
        assert result.high_turnover_risk is False

    @pytest.mark.asyncio
    async def test_no_sections_returns_defaults(self):
        """Text without ORSR sections → all defaults."""
        result = await analyze_orsr_history(SAMPLE_NO_SECTIONS)
        assert result.statutory_changes_count == 0
        assert result.address_changes_count == 0

    @pytest.mark.asyncio
    async def test_high_turnover_detected(self):
        """3+ recent statutory changes → high_turnover_risk=True."""
        now = datetime.now()
        recent1 = now.strftime("%d.%m.%Y")
        recent2 = (now - timedelta(days=30)).strftime("%d.%m.%Y")
        recent3 = (now - timedelta(days=60)).strftime("%d.%m.%Y")
        text = f"""Štatutárny orgán:
Ing. Ján Prvý
(od: {recent1})
Mgr. Peter Druhý
(od: {recent2})
Ing. Ján Tretí
(od: {recent3})
Sídlo:
Hlavná 1
"""
        result = await analyze_orsr_history(text)
        assert result.statutory_changes_count == 3
        assert result.high_turnover_risk is True
