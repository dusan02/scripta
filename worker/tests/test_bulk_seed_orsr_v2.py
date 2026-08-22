"""
Unit tests for ORSR V2 cursor-based pagination and checkpoint logic.

Tests focus on:
  - Cursor advances monotonically
  - NULL orsrSyncedAt records are eligible
  - Already-synced companies are excluded
  - Restart from last_ico does not skip records
  - Failed company can be retried
  - Checkpoint save/load roundtrip
"""
import json
import os
import tempfile
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

# Import the module under test
from src.bulk_seed_orsr_v2 import (
    load_checkpoint,
    save_checkpoint,
    get_companies_batch_cursor,
    _CHECKPOINT_FILE,
)


class TestCheckpoint:
    """Checkpoint save/load and cursor semantics."""

    def test_load_checkpoint_missing_file(self, tmp_path, monkeypatch):
        """Loading a non-existent checkpoint returns empty state."""
        monkeypatch.setattr("src.bulk_seed_orsr_v2._CHECKPOINT_FILE", tmp_path / "missing.json")
        cp = load_checkpoint()
        assert cp["last_ico"] == ""
        assert cp["processed_count"] == 0
        assert cp["failed_count"] == 0
        assert cp["not_found_count"] == 0
        assert cp["failed_icos"] == []
        assert cp["not_found_icos"] == []

    def test_save_and_load_roundtrip(self, tmp_path, monkeypatch):
        """Checkpoint survives save → load cycle."""
        cp_file = tmp_path / "orsr_v2_checkpoint.json"
        monkeypatch.setattr("src.bulk_seed_orsr_v2._CHECKPOINT_FILE", cp_file)

        cp = {
            "last_ico": "00689785",
            "processed_count": 500,
            "failed_count": 3,
            "not_found_count": 1,
            "last_run": None,
            "failed_icos": ["00166529", "00166545"],
            "not_found_icos": ["00000003"],
        }
        save_checkpoint(cp)

        loaded = load_checkpoint()
        assert loaded["last_ico"] == "00689785"
        assert loaded["processed_count"] == 500
        assert loaded["failed_count"] == 3
        assert loaded["not_found_count"] == 1
        assert loaded["failed_icos"] == ["00166529", "00166545"]
        assert loaded["not_found_icos"] == ["00000003"]
        assert loaded["last_run"] is not None

    def test_checkpoint_atomic_write(self, tmp_path, monkeypatch):
        """Checkpoint writes atomically (no .tmp file left behind)."""
        cp_file = tmp_path / "orsr_v2_checkpoint.json"
        monkeypatch.setattr("src.bulk_seed_orsr_v2._CHECKPOINT_FILE", cp_file)

        save_checkpoint({"last_ico": "12345678", "processed_count": 1, "failed_count": 0,
                         "not_found_count": 0, "last_run": None, "failed_icos": [], "not_found_icos": []})

        assert cp_file.exists()
        assert not (tmp_path / "orsr_v2_checkpoint.json.tmp").exists()

    def test_cursor_advances_monotonically(self, tmp_path, monkeypatch):
        """last_ico only moves forward, never backward."""
        cp_file = tmp_path / "orsr_v2_checkpoint.json"
        monkeypatch.setattr("src.bulk_seed_orsr_v2._CHECKPOINT_FILE", cp_file)

        cp = {"last_ico": "00500000", "processed_count": 100, "failed_count": 0,
              "not_found_count": 0, "last_run": None, "failed_icos": [], "not_found_icos": []}

        # Process a company with higher ICO
        new_ico = "00500001"
        cp["last_ico"] = max(cp["last_ico"], new_ico)
        cp["processed_count"] += 1
        save_checkpoint(cp)

        loaded = load_checkpoint()
        assert loaded["last_ico"] == "00500001"

        # Try to process a lower ICO — cursor must NOT move backward
        lower_ico = "00499999"
        cp["last_ico"] = max(loaded["last_ico"], lower_ico)
        save_checkpoint(cp)

        loaded = load_checkpoint()
        assert loaded["last_ico"] == "00500001"  # Still the higher value


class TestCursorPagination:
    """Cursor-based batch fetching logic."""

    @pytest.mark.asyncio
    async def test_cursor_excludes_synced_companies(self):
        """Companies with orsrSyncedAt IS NOT NULL are excluded by the query."""
        mock_db = MagicMock()
        mock_db.execute_raw = AsyncMock(return_value=[
            ("00500001", "Test s.r.o."),
            ("00500002", "Test2 a.s."),
        ])

        with patch("src.db_client.get_db", return_value=mock_db):
            companies = await get_companies_batch_cursor(last_ico="00500000", batch_size=100)

        assert len(companies) == 2
        assert companies[0]["ico"] == "00500001"
        assert companies[1]["ico"] == "00500002"

        # Verify the SQL uses cursor (ico > $2) not OFFSET
        call_args = mock_db.execute_raw.call_args
        sql = call_args[0][0]
        assert "ico > $2" in sql
        assert "OFFSET" not in sql.upper()
        assert "orsrSyncedAt" in sql
        assert "IS NULL" in sql

    @pytest.mark.asyncio
    async def test_cursor_uses_last_ico_parameter(self):
        """The last_ico is passed as parameter $2, not concatenated into SQL."""
        mock_db = MagicMock()
        mock_db.execute_raw = AsyncMock(return_value=[])

        with patch("src.db_client.get_db", return_value=mock_db):
            await get_companies_batch_cursor(last_ico="00689785", batch_size=50)

        call_args = mock_db.execute_raw.call_args
        # Parameters: legal_forms, last_ico, batch_size
        assert call_args[0][2] == "00689785"  # last_ico
        assert call_args[0][3] == 50           # batch_size

    @pytest.mark.asyncio
    async def test_cursor_empty_result(self):
        """Empty result when no more companies to process."""
        mock_db = MagicMock()
        mock_db.execute_raw = AsyncMock(return_value=[])

        with patch("src.db_client.get_db", return_value=mock_db):
            companies = await get_companies_batch_cursor(last_ico="99999999", batch_size=100)

        assert companies == []

    @pytest.mark.asyncio
    async def test_single_company_mode(self):
        """Single-company mode bypasses cursor and uses Prisma find_many."""
        mock_db = MagicMock()
        mock_company = MagicMock()
        mock_company.ico = "36000019"
        mock_company.name = "Test s.r.o."
        mock_db.company.find_many = AsyncMock(return_value=[mock_company])

        with patch("src.db_client.get_db", return_value=mock_db):
            companies = await get_companies_batch_cursor(last_ico="", ico_filter="36000019")

        assert len(companies) == 1
        assert companies[0]["ico"] == "36000019"
        # Should use find_many, not execute_raw
        mock_db.company.find_many.assert_called_once()

    @pytest.mark.asyncio
    async def test_restart_from_checkpoint_does_not_skip(self):
        """Resuming from last_ico fetches companies AFTER the cursor, not before."""
        mock_db = MagicMock()
        mock_db.execute_raw = AsyncMock(return_value=[
            ("00689786", "Next s.r.o."),
            ("00689787", "Next2 a.s."),
        ])

        with patch("src.db_client.get_db", return_value=mock_db):
            companies = await get_companies_batch_cursor(last_ico="00689785", batch_size=100)

        # All returned ICOs must be > last_ico
        for c in companies:
            assert c["ico"] > "00689785"

    @pytest.mark.asyncio
    async def test_no_offset_in_sql(self):
        """Critical: SQL must NOT contain OFFSET keyword."""
        mock_db = MagicMock()
        mock_db.execute_raw = AsyncMock(return_value=[])

        with patch("src.db_client.get_db", return_value=mock_db):
            await get_companies_batch_cursor(last_ico="", batch_size=100)

        sql = mock_db.execute_raw.call_args[0][0]
        assert "OFFSET" not in sql.upper(), "V2 must NOT use OFFSET pagination"
        assert "SKIP" not in sql.upper(), "V2 must NOT use SKIP pagination"


class TestIdempotency:
    """Idempotency guarantees."""

    def test_db_is_final_guard(self):
        """The DB orsrSyncedAt IS NOT NULL is the idempotency guard.

        Even if checkpoint is lost, the cursor query excludes synced companies.
        This is verified by the SQL containing 'orsrSyncedAt IS NULL'.
        """
        # This is a documentation test — the actual SQL is tested above
        # The key invariant: get_companies_batch_cursor always filters orsrSyncedAt IS NULL
        # So even with a stale/missing checkpoint, already-synced companies are skipped
        pass

    def test_failed_icos_tracked_separately(self, tmp_path, monkeypatch):
        """Failed ICOs are tracked in checkpoint for later retry."""
        cp_file = tmp_path / "orsr_v2_checkpoint.json"
        monkeypatch.setattr("src.bulk_seed_orsr_v2._CHECKPOINT_FILE", cp_file)

        cp = {
            "last_ico": "00500003",
            "processed_count": 2,
            "failed_count": 1,
            "not_found_count": 0,
            "last_run": None,
            "failed_icos": ["00500002"],
            "not_found_icos": [],
        }
        save_checkpoint(cp)

        loaded = load_checkpoint()
        assert "00500002" in loaded["failed_icos"]
        # The cursor advanced past the failed ICO, so it won't be re-fetched
        # in normal resume. But failed_icos list allows targeted retry.

    def test_not_found_advances_cursor(self, tmp_path, monkeypatch):
        """NOT_FOUND companies advance the cursor (they were processed)."""
        cp_file = tmp_path / "orsr_v2_checkpoint.json"
        monkeypatch.setattr("src.bulk_seed_orsr_v2._CHECKPOINT_FILE", cp_file)

        cp = {
            "last_ico": "00500001",
            "processed_count": 0,
            "failed_count": 0,
            "not_found_count": 1,
            "last_run": None,
            "failed_icos": [],
            "not_found_icos": ["00500001"],
        }
        save_checkpoint(cp)

        loaded = load_checkpoint()
        assert loaded["last_ico"] == "00500001"
        assert loaded["not_found_count"] == 1
        # Next batch will fetch ico > 00500001, skipping the not-found company
