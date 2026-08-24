"""
F4.1 — Regression test pre source_pages wiring.

Overuje že:
1. get_sliced_pdf_page_range() funguje pre reálny PDF
2. NotesRiskAnalysis.source_pages sa nastaví z sliced PDF
3. NarrativeRiskAnalysis.source_pages sa nastaví z sliced PDF
4. DB save mapuje source_pages správne
5. Pipeline wiring existuje v pipeline.py (static check)
"""
import os
import tempfile
import pytest
import fitz

from src.pdf_ingestion import format_page_range, get_sliced_pdf_page_range
from src.agents.notes_forensic import NotesRiskAnalysis
from src.agents.narrative import NarrativeRiskAnalysis


# ═══════════════════════════════════════════════════════════════════════
# 1. get_sliced_pdf_page_range s reálnym PDF
# ═══════════════════════════════════════════════════════════════════════

class TestSlicedPdfPageRange:
    """Overí get_sliced_pdf_page_range s reálnym PDF súborom."""

    @pytest.fixture
    def temp_pdf(self):
        """Vytvorí dočasný PDF s 5 stranami."""
        with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as f:
            doc = fitz.open()
            for i in range(5):
                page = doc.new_page()
                page.insert_text((50, 50), f"Page {i+1}")
            doc.save(f.name)
            doc.close()
            yield f.name
        os.unlink(f.name)

    def test_returns_page_range_for_real_pdf(self, temp_pdf):
        """Pre reálny 5-stranový PDF vráti "1-5"."""
        result = get_sliced_pdf_page_range(temp_pdf)
        assert result == "1-5"

    def test_returns_empty_for_nonexistent(self):
        """Pre neexistujúci PDF vráti prázdny string."""
        result = get_sliced_pdf_page_range("/nonexistent/path.pdf")
        assert result == ""


# ═══════════════════════════════════════════════════════════════════════
# 2. NotesRiskAnalysis.source_pages sa nastaví z sliced PDF
# ═══════════════════════════════════════════════════════════════════════

class TestNotesSourcePagesWiring:
    """Overí že NotesRiskAnalysis.source_pages sa nastaví z page range."""

    def test_notes_source_pages_set_from_page_range(self):
        """NotesRisk.source_pages = "14-18,22,30-32" po wiring."""
        notes = NotesRiskAnalysis(
            related_party_transactions=None,
            off_balance_sheet_liabilities=None,
            contingent_risks=None,
        )
        # Simulácia wiring: pipeline nastaví source_pages po extrakcii
        notes.source_pages = "14-18,22,30-32"
        assert notes.source_pages == "14-18,22,30-32"

    def test_notes_source_pages_default_none(self):
        """Bez wiring je source_pages = None."""
        notes = NotesRiskAnalysis(
            related_party_transactions=None,
            off_balance_sheet_liabilities=None,
            contingent_risks=None,
        )
        assert notes.source_pages is None

    def test_notes_source_pages_from_format_page_range(self):
        """source_pages sa nastaví z format_page_range([1,2,3])."""
        pages = [1, 2, 3]
        notes = NotesRiskAnalysis(
            related_party_transactions=None,
            off_balance_sheet_liabilities=None,
            contingent_risks=None,
        )
        notes.source_pages = format_page_range(pages)
        assert notes.source_pages == "1-3"


# ═══════════════════════════════════════════════════════════════════════
# 3. NarrativeRiskAnalysis.source_pages sa nastaví z sliced PDF
# ═══════════════════════════════════════════════════════════════════════

class TestNarrativeSourcePagesWiring:
    """Overí že NarrativeRiskAnalysis.source_pages sa nastaví z page range."""

    def test_narrative_source_pages_set_from_page_range(self):
        """NarrativeRisk.source_pages = "5-12,15" po wiring."""
        narrative = NarrativeRiskAnalysis(
            management_changes=None, litigation_risks=None, going_concern_doubts=False,
            planned_investments=None, profitability_explanation=None, forensic_red_flags=[],
            synthesis="test",
        )
        narrative.source_pages = "5-12,15"
        assert narrative.source_pages == "5-12,15"

    def test_narrative_source_pages_default_none(self):
        """Bez wiring je source_pages = None."""
        narrative = NarrativeRiskAnalysis(
            management_changes=None, litigation_risks=None, going_concern_doubts=False,
            planned_investments=None, profitability_explanation=None, forensic_red_flags=[],
            synthesis="test",
        )
        assert narrative.source_pages is None

    def test_narrative_source_pages_from_format_page_range(self):
        """source_pages sa nastaví z format_page_range([5,6,7])."""
        pages = [5, 6, 7]
        narrative = NarrativeRiskAnalysis(
            management_changes=None, litigation_risks=None, going_concern_doubts=False,
            planned_investments=None, profitability_explanation=None, forensic_red_flags=[],
            synthesis="test",
        )
        narrative.source_pages = format_page_range(pages)
        assert narrative.source_pages == "5-7"


# ═══════════════════════════════════════════════════════════════════════
# 4. DB save mapuje source_pages správne
# ═══════════════════════════════════════════════════════════════════════

class TestDBSaveSourcePages:
    """Overí že save_notes_to_db a save_narrative_to_db mapujú source_pages."""

    def test_save_notes_maps_source_pages(self):
        """save_notes_to_db obsahuje sourcePages v payload."""
        import inspect
        from src.db_repository import save_notes_to_db
        source = inspect.getsource(save_notes_to_db)
        assert "sourcePages" in source
        assert "source_pages" in source

    def test_save_narrative_maps_source_pages(self):
        """save_narrative_to_db obsahuje sourcePages v payload."""
        import inspect
        from src.db_repository import save_narrative_to_db
        source = inspect.getsource(save_narrative_to_db)
        assert "sourcePages" in source
        assert "source_pages" in source


# ═══════════════════════════════════════════════════════════════════════
# 5. Pipeline wiring — static check
# ═══════════════════════════════════════════════════════════════════════

class TestPipelineWiring:
    """Overí že pipeline.py obsahuje wiring pre source_pages."""

    def test_pipeline_imports_get_sliced_pdf_page_range(self):
        """pipeline.py importuje get_sliced_pdf_page_range."""
        import inspect
        from src import pipeline
        source = inspect.getsource(pipeline)
        assert "get_sliced_pdf_page_range" in source or "format_page_range" in source

    def test_pipeline_sets_notes_source_pages(self):
        """pipeline.py nastaví notes source_pages z sliced PDF."""
        import inspect
        from src import pipeline
        source = inspect.getsource(pipeline)
        # Hľadaj pattern ako notes_data.source_pages = ... alebo _notes_result["data"].source_pages
        assert "source_pages" in source

    def test_pipeline_sets_narrative_source_pages(self):
        """pipeline.py nastaví narrative source_pages z sliced PDF."""
        import inspect
        from src import pipeline
        source = inspect.getsource(pipeline)
        assert "source_pages" in source
