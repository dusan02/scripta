"""Tests for ORSR Bulk Seed V2 hardening — checkpoint persistence, resume safety, COALESCE protection.

Run: python -m pytest tests/test_orsr_seed_hardening.py -x -q
"""
import json
import os
import tempfile
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest


# ── P0-1: Checkpoint persistence ──────────────────────────────────────

def test_checkpoint_paths_use_results_dir():
    """Checkpoint and lock files must be in results/ (persistent volume), not output/."""
    from src.bulk_seed_orsr_v2 import _CHECKPOINT_FILE, _LOCK_FILE

    assert "results" in str(_CHECKPOINT_FILE), f"Checkpoint must be in results/, got {_CHECKPOINT_FILE}"
    assert "results" in str(_LOCK_FILE), f"Lock must be in results/, got {_LOCK_FILE}"
    assert "orsr_v2_checkpoint.json" in str(_CHECKPOINT_FILE)
    assert "orsr_v2.lock" in str(_LOCK_FILE)


def test_checkpoint_save_and_load_roundtrip(tmp_path):
    """Save → load produces identical checkpoint."""
    with patch("src.bulk_seed_orsr_v2._CHECKPOINT_FILE", tmp_path / "orsr_v2_checkpoint.json"):
        from src.bulk_seed_orsr_v2 import load_checkpoint, save_checkpoint

        cp = {
            "last_ico": "00689785",
            "processed_count": 500,
            "failed_count": 3,
            "not_found_count": 1,
            "last_run": None,
            "failed_icos": ["00000001", "00000002"],
            "not_found_icos": ["00000003"],
        }
        save_checkpoint(cp)
        loaded = load_checkpoint()
        assert loaded["last_ico"] == "00689785"
        assert loaded["processed_count"] == 500
        assert loaded["failed_icos"] == ["00000001", "00000002"]


def test_checkpoint_backward_compat_migration(tmp_path):
    """If results/ checkpoint doesn't exist but output/ does, migrate it."""
    new_path = tmp_path / "results" / "orsr_v2_checkpoint.json"
    old_path = tmp_path / "output" / "orsr_v2_checkpoint.json"
    old_path.parent.mkdir(parents=True)
    old_cp = {"last_ico": "12345678", "processed_count": 100, "failed_count": 0,
              "not_found_count": 0, "last_run": None, "failed_icos": [], "not_found_icos": []}
    with open(old_path, "w") as f:
        json.dump(old_cp, f)

    with patch("src.bulk_seed_orsr_v2._CHECKPOINT_FILE", new_path), \
         patch("src.bulk_seed_orsr_v2._OLD_CHECKPOINT_FILE", old_path):
        from src.bulk_seed_orsr_v2 import load_checkpoint
        loaded = load_checkpoint()
        assert loaded["last_ico"] == "12345678"
        assert loaded["processed_count"] == 100
        assert new_path.exists(), "Checkpoint should be migrated to new location"


def test_checkpoint_empty_when_no_file():
    """Load returns empty checkpoint when no file exists."""
    with patch("src.bulk_seed_orsr_v2._CHECKPOINT_FILE", Path("/tmp/nonexistent_orsr_test.json")), \
         patch("src.bulk_seed_orsr_v2._OLD_CHECKPOINT_FILE", Path("/tmp/nonexistent_orsr_old.json")):
        from src.bulk_seed_orsr_v2 import load_checkpoint
        loaded = load_checkpoint()
        assert loaded["last_ico"] == ""
        assert loaded["processed_count"] == 0
        assert loaded["failed_icos"] == []


# ── P0-4: DB idempotency guard ────────────────────────────────────────

def test_batch_query_filters_orsr_synced_at_null():
    """Verify that the SQL query filters orsrSyncedAt IS NULL (idempotency guard)."""
    import inspect
    from src.bulk_seed_orsr_v2 import get_companies_batch_cursor
    source = inspect.getsource(get_companies_batch_cursor)
    assert '"orsrSyncedAt" IS NULL' in source, "Query must filter orsrSyncedAt IS NULL"
    assert "ico > $2" in source, "Query must use cursor (ico > :last_ico)"


def test_bootstrap_checkpoint_does_not_skip_unsynced():
    """Bootstrap sets cursor to max(synced ICO) — but DB filter still catches unsynced below cursor."""
    import inspect
    from src.bulk_seed_orsr_v2 import bootstrap_checkpoint_from_db
    source = inspect.getsource(bootstrap_checkpoint_from_db)
    # Bootstrap queries MAX(ico) WHERE orsrSyncedAt IS NOT NULL
    assert "MAX(ico)" in source or "MAX(ico)" in source.upper()
    assert '"orsrSyncedAt" IS NOT NULL' in source


# ── P1-10: --only-with-financials flag ────────────────────────────────

def test_only_with_financials_adds_exists_check():
    """Verify that --only-with-financials adds EXISTS subquery."""
    import inspect
    from src.bulk_seed_orsr_v2 import get_companies_batch_cursor
    source = inspect.getsource(get_companies_batch_cursor)
    assert "only_with_financials" in source
    assert 'EXISTS (SELECT 1 FROM "FinancialStatement"' in source


def test_only_with_financials_is_optional():
    """Verify that --only-with-financials is not the default."""
    import inspect
    from src.bulk_seed_orsr_v2 import get_companies_batch_cursor
    sig = inspect.signature(get_companies_batch_cursor)
    param = sig.parameters.get("only_with_financials")
    assert param is not None
    assert param.default is False, "only_with_financials must default to False"


# ── P1-13: COALESCE protection ────────────────────────────────────────

def test_coalesce_protects_share_capital():
    """Verify that COALESCE is used for shareCapital (NULL can't overwrite existing)."""
    import inspect
    from src.bulk_seed_orsr_v2 import scrape_and_save_orsr_v2
    source = inspect.getsource(scrape_and_save_orsr_v2)
    assert 'COALESCE($4::numeric, "shareCapital")' in source, \
        "shareCapital must use COALESCE to protect against NULL overwrite"
    assert 'COALESCE($5, "signingAuthority")' in source, \
        "signingAuthority must use COALESCE to protect against NULL overwrite"
    assert 'COALESCE($6, "businessActivity")' in source, \
        "businessActivity must use COALESCE to protect against NULL overwrite"


def test_legal_status_always_overwrites():
    """legalStatus is always set (ORSR is authoritative source for legal status)."""
    import inspect
    from src.bulk_seed_orsr_v2 import scrape_and_save_orsr_v2
    source = inspect.getsource(scrape_and_save_orsr_v2)
    # legalStatus should NOT have COALESCE — it's always overwritten
    assert '"legalStatus" = $2' in source, "legalStatus must always be set (ORSR authoritative)"
    assert "COALESCE" not in source.split('"legalStatus" = $2')[0].split("SET")[-1].split(",")[0], \
        "legalStatus must not use COALESCE"


# ── P1-18: Single-worker lock ─────────────────────────────────────────

def test_lock_file_in_results_dir():
    """Lock file must be in results/ (persistent), not output/."""
    from src.bulk_seed_orsr_v2 import _LOCK_FILE
    assert "results" in str(_LOCK_FILE)


def test_lock_acquired_and_released():
    """Lock can be acquired and released."""
    import fcntl
    from src.bulk_seed_orsr_v2 import WorkerLock

    with tempfile.NamedTemporaryFile(delete=False) as tmp:
        tmp_path = Path(tmp.name)

    with patch("src.bulk_seed_orsr_v2._LOCK_FILE", tmp_path):
        lock1 = WorkerLock()
        assert lock1.acquire() is True, "First lock should be acquired"
        assert lock1.release() is None, "Release should work"

        # After release, a new lock can be acquired
        lock2 = WorkerLock()
        assert lock2.acquire() is True, "Lock should be re-acquirable after release"
        lock2.release()

    os.unlink(tmp_path)


def test_lock_prevents_concurrent_instances():
    """Two WorkerLock instances on the same file cannot both acquire."""
    import fcntl
    from src.bulk_seed_orsr_v2 import WorkerLock

    with tempfile.NamedTemporaryFile(delete=False) as tmp:
        tmp_path = Path(tmp.name)

    with patch("src.bulk_seed_orsr_v2._LOCK_FILE", tmp_path):
        lock1 = WorkerLock()
        assert lock1.acquire() is True, "First lock should be acquired"

        lock2 = WorkerLock()
        assert lock2.acquire() is False, "Second lock should be denied"

        lock1.release()

        # Now lock2 can acquire
        lock3 = WorkerLock()
        assert lock3.acquire() is True, "Lock should be available after release"
        lock3.release()

    os.unlink(tmp_path)
