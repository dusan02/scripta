"""
Regression test for ScoringSnapshot save bug.

Bug: 'NarrativeRiskAnalysis' object has no attribute 'get'
     — verdict_builder.py stored Prisma/Pydantic models in dicts,
       then called .get() on them as if they were dicts.

Fix: Convert models to dicts via model_dump() before storing in narrative_by_year.
"""
import json
import hashlib

import pytest

from src.agents.narrative import NarrativeRiskAnalysis as PydanticNarrative
from src.agents.notes_forensic import NotesRiskAnalysis as PydanticNotes


def test_pydantic_narrative_dict_conversion():
    """Pydantic NarrativeRiskAnalysis → dict via model_dump()."""
    nr = PydanticNarrative(
        management_changes="Žiadne zmeny",
        litigation_risks="Žiadne spory",
        going_concern_doubts=False,
        planned_investments="Žiadne",
        profitability_explanation="Stabilná ziskovosť",
        forensic_red_flags=[],
        synthesis="Firma je stabilná.",
    )
    assert hasattr(nr, "model_dump")
    d = nr.model_dump()
    assert isinstance(d, dict)
    # Pydantic model uses snake_case
    assert d.get("going_concern_doubts") is False
    # .get() works on dict (would fail on Pydantic model)
    assert d.get("going_concern_doubts") is False


def test_pydantic_notes_dict_conversion():
    """Pydantic NotesRiskAnalysis → dict via model_dump()."""
    notes = PydanticNotes(
        related_party_transactions="Žiadne",
        off_balance_sheet_liabilities=None,
        contingent_risks="Prebiehajúci spor",
        significant_investments="Nová výrobná linka 8.2 mil. EUR",
        financing_activities="Investičný úver 15 mil. EUR od SLSP",
        acquisitions_and_disposals=None,
        provisions_and_reserves="Rezerva na záruky 1.2 mil. EUR",
        restructuring_activities=None,
        capital_changes=None,
        subsequent_events="Akvizícia konkurenta po súvahovom dni",
    )
    assert hasattr(notes, "model_dump")
    d = notes.model_dump()
    assert isinstance(d, dict)
    assert d.get("related_party_transactions") == "Žiadne"


def test_bug_reproduction_get_on_model():
    """Reproduce the exact bug: .get() on Pydantic model raises AttributeError."""
    nr = PydanticNarrative(
        management_changes="Zmena",
        litigation_risks="Súdny spor",
        going_concern_doubts=True,
        planned_investments=None,
        profitability_explanation="Pokles",
        forensic_red_flags=["flag1"],
        synthesis="Stres.",
    )

    # OLD (buggy): store Pydantic model directly in dict
    narrative_buggy = [{"rok": 2023, "narrativeRisk": nr}]

    # .get() on Pydantic model raises AttributeError
    with pytest.raises(AttributeError):
        _ = (narrative_buggy[0].get("narrativeRisk") or {}).get("going_concern_doubts")

    # NEW (fixed): convert to dict first
    nr_dict = nr.model_dump() if hasattr(nr, "model_dump") else nr
    narrative_fixed = [{"rok": 2023, "narrativeRisk": nr_dict}]

    # .get() works on dict
    result = (narrative_fixed[0].get("narrativeRisk") or {}).get("going_concern_doubts")
    assert result is True


def test_input_hash_computation():
    """Verify input hash computation succeeds with fixed pattern."""
    nr = PydanticNarrative(
        management_changes="Zmena konateľa",
        litigation_risks=None,
        going_concern_doubts=True,
        planned_investments=None,
        profitability_explanation="Stabilná",
        forensic_red_flags=[],
        synthesis="OK",
    )
    notes = PydanticNotes(
        related_party_transactions="Áno, transakcie s dcérskou firmou",
        off_balance_sheet_liabilities=None,
        contingent_risks=None,
    )

    # Fixed pattern: convert to dict
    nr_dict = nr.model_dump() if hasattr(nr, "model_dump") else nr
    notes_dict = notes.model_dump() if hasattr(notes, "model_dump") else notes

    narrative_by_year = [{"rok": 2023, "narrativeRisk": nr_dict}]
    notes_by_year = [{"rok": 2023, "notesRisk": notes_dict}]

    # Hash computation pattern from verdict_builder.py
    _hash_input = json.dumps({
        "ico": "00214973",
        "base_score": 91,
        "is_consolidated": False,
        "narrative": [
            {
                "rok": e.get("rok"),
                "gc": (e.get("narrativeRisk") or {}).get("going_concern_doubts"),
                "lit": (e.get("narrativeRisk") or {}).get("litigation_risks"),
            }
            for e in narrative_by_year if isinstance(e, dict)
        ],
        "notes": [
            {
                "rok": e.get("rok"),
                "rpt": (e.get("notesRisk") or {}).get("related_party_transactions"),
                "cr": (e.get("notesRisk") or {}).get("contingent_risks"),
                "obs": (e.get("notesRisk") or {}).get("off_balance_sheet_liabilities"),
            }
            for e in notes_by_year if isinstance(e, dict)
        ],
        "events": [],
    }, sort_keys=True, default=str)

    _input_hash = hashlib.sha256(_hash_input.encode()).hexdigest()[:16]
    assert len(_input_hash) == 16
    assert isinstance(_input_hash, str)


def test_dict_passthrough_no_conversion():
    """If narrativeRisk is already a dict (e.g. from model_dump earlier), no conversion needed."""
    nr_dict = {"going_concern_doubts": True, "litigation_risks": None}
    # hasattr(dict, "model_dump") is False, so the fix passes it through
    result = nr_dict if not hasattr(nr_dict, "model_dump") else nr_dict.model_dump()
    assert isinstance(result, dict)
    assert result.get("going_concern_doubts") is True
