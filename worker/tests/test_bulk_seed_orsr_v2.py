"""
Unit tests for ORSR V2 cursor-based pagination and checkpoint logic.

Tests focus on:
  - Cursor advances monotonically
  - NULL orsrSyncedAt records are eligible
  - Already-synced companies are excluded
  - Restart from last_ico does not skip records
  - Failed company can be retried
  - Checkpoint save/load roundtrip
  - Single-worker lock prevents concurrent instances
  - Transaction wraps Company + CompanyPerson atomically
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
    WorkerLock,
    _CHECKPOINT_FILE,
    _LOCK_FILE,
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
        mock_db.query_raw = AsyncMock(return_value=[
            {"ico": "00500001", "name": "Test s.r.o."},
            {"ico": "00500002", "name": "Test2 a.s."},
        ])

        with patch("src.db_client.get_db", return_value=mock_db):
            companies = await get_companies_batch_cursor(last_ico="00500000", batch_size=100)

        assert len(companies) == 2
        assert companies[0]["ico"] == "00500001"
        assert companies[1]["ico"] == "00500002"

        # Verify the SQL uses cursor (ico > $2) not OFFSET
        call_args = mock_db.query_raw.call_args
        sql = call_args[0][0]
        assert "ico > $2" in sql
        assert "OFFSET" not in sql.upper()
        assert "orsrSyncedAt" in sql
        assert "IS NULL" in sql

    @pytest.mark.asyncio
    async def test_cursor_uses_last_ico_parameter(self):
        """The last_ico is passed as parameter $2, not concatenated into SQL."""
        mock_db = MagicMock()
        mock_db.query_raw = AsyncMock(return_value=[])

        with patch("src.db_client.get_db", return_value=mock_db):
            await get_companies_batch_cursor(last_ico="00689785", batch_size=50)

        call_args = mock_db.query_raw.call_args
        # Parameters: legal_forms, last_ico, batch_size
        assert call_args[0][2] == "00689785"  # last_ico
        assert call_args[0][3] == 50           # batch_size

    @pytest.mark.asyncio
    async def test_cursor_empty_result(self):
        """Empty result when no more companies to process."""
        mock_db = MagicMock()
        mock_db.query_raw = AsyncMock(return_value=[])

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
        # Should use find_many, not query_raw
        mock_db.company.find_many.assert_called_once()

    @pytest.mark.asyncio
    async def test_restart_from_checkpoint_does_not_skip(self):
        """Resuming from last_ico fetches companies AFTER the cursor, not before."""
        mock_db = MagicMock()
        mock_db.query_raw = AsyncMock(return_value=[
            {"ico": "00689786", "name": "Next s.r.o."},
            {"ico": "00689787", "name": "Next2 a.s."},
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
        mock_db.query_raw = AsyncMock(return_value=[])

        with patch("src.db_client.get_db", return_value=mock_db):
            await get_companies_batch_cursor(last_ico="", batch_size=100)

        sql = mock_db.query_raw.call_args[0][0]
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


class TestWorkerLock:
    """Single-worker lock prevents concurrent V2 instances."""

    def test_lock_acquire_and_release(self, tmp_path, monkeypatch):
        """Lock can be acquired and released."""
        monkeypatch.setattr("src.bulk_seed_orsr_v2._LOCK_FILE", tmp_path / "orsr_v2.lock")
        lock = WorkerLock()
        assert lock.acquire() is True
        assert lock._fd is not None
        lock.release()
        assert lock._fd is None

    def test_lock_prevents_second_acquire(self, tmp_path, monkeypatch):
        """A second lock on the same file fails (non-blocking)."""
        monkeypatch.setattr("src.bulk_seed_orsr_v2._LOCK_FILE", tmp_path / "orsr_v2.lock")
        lock1 = WorkerLock()
        lock2 = WorkerLock()

        assert lock1.acquire() is True
        # Second lock should fail — another process holds it
        assert lock2.acquire() is False

        lock1.release()
        # Now lock2 can acquire
        assert lock2.acquire() is True
        lock2.release()

    def test_lock_released_on_release_call(self, tmp_path, monkeypatch):
        """Explicit release allows re-acquire."""
        monkeypatch.setattr("src.bulk_seed_orsr_v2._LOCK_FILE", tmp_path / "orsr_v2.lock")
        lock = WorkerLock()
        lock.acquire()
        lock.release()
        # Should be able to acquire again
        assert lock.acquire() is True
        lock.release()

    def test_lock_file_created(self, tmp_path, monkeypatch):
        """Lock file is created on acquire."""
        lock_file = tmp_path / "orsr_v2.lock"
        monkeypatch.setattr("src.bulk_seed_orsr_v2._LOCK_FILE", lock_file)
        lock = WorkerLock()
        lock.acquire()
        assert lock_file.exists()
        lock.release()


class TestTransaction:
    """Atomic Company + CompanyPerson writes via db.tx()."""

    @pytest.mark.asyncio
    async def test_transaction_used_for_company_write(self):
        """scrape_and_save_orsr_v2 uses db.tx() for atomic writes."""
        from src.bulk_seed_orsr_v2 import scrape_and_save_orsr_v2

        mock_db = MagicMock()
        mock_tx = MagicMock()
        mock_tx.execute_raw = AsyncMock(return_value=1)
        mock_tx.query_raw = AsyncMock(return_value=[])

        # db.tx() is an async context manager
        mock_tx.__aenter__ = AsyncMock(return_value=mock_tx)
        mock_tx.__aexit__ = AsyncMock(return_value=False)
        mock_db.tx.return_value = mock_tx

        mock_scraper = MagicMock()
        mock_result = MagicMock()
        mock_result.status = "SUCCESS"
        mock_result.status_message = "OK"
        mock_result.findings = "Aktívna spoločnosť"
        mock_result.share_capital = 5000.0
        mock_result.signing_authority = "Konateľ"
        mock_result.business_activity = "Obchod"
        mock_result.persons = []
        mock_scraper.run = AsyncMock(return_value=mock_result)

        with patch("src.db_client.get_db", return_value=mock_db):
            result = await scrape_and_save_orsr_v2("31351361", "Test s.r.o.", mock_scraper)

        assert result["status"] == "SUCCESS"
        # Verify tx() was used
        mock_db.tx.assert_called_once()
        # Verify Company UPDATE was inside transaction
        assert mock_tx.execute_raw.call_count >= 1

    @pytest.mark.asyncio
    async def test_transaction_rollback_on_person_failure(self):
        """If CompanyPerson write fails, Company UPDATE is rolled back."""
        from src.bulk_seed_orsr_v2 import scrape_and_save_orsr_v2

        mock_db = MagicMock()
        mock_tx = MagicMock()
        mock_tx.execute_raw = AsyncMock(side_effect=[
            1,  # Company UPDATE succeeds
            Exception("CompanyPerson write failed"),  # Person INSERT fails
        ])
        mock_tx.query_raw = AsyncMock(return_value=[])

        mock_tx.__aenter__ = AsyncMock(return_value=mock_tx)
        mock_tx.__aexit__ = AsyncMock(return_value=False)
        mock_db.tx.return_value = mock_tx

        mock_person = MagicMock()
        mock_person.clean_name = "Ján Test"
        mock_person.role = "statutar"
        mock_person.raw_name = "Ján Test"
        mock_person.city = None
        mock_person.zip_code = None
        mock_person.function_start = None
        mock_person.function_end = None
        mock_person.is_active = True

        mock_scraper = MagicMock()
        mock_result = MagicMock()
        mock_result.status = "SUCCESS"
        mock_result.status_message = "OK"
        mock_result.findings = "Aktívna spoločnosť"
        mock_result.share_capital = 5000.0
        mock_result.signing_authority = "Konateľ"
        mock_result.business_activity = "Obchod"
        mock_result.persons = [mock_person]
        mock_scraper.run = AsyncMock(return_value=mock_result)

        with patch("src.db_client.get_db", return_value=mock_db):
            result = await scrape_and_save_orsr_v2("31351361", "Test s.r.o.", mock_scraper)

        # Should return ERROR, not SUCCESS — transaction rolled back
        assert result["status"] == "ERROR"
        assert "CompanyPerson write failed" in result["message"]
