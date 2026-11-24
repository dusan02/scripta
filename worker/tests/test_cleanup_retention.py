"""Tests for P0.4 paid report retention in worker cleanup."""
from __future__ import annotations

import os
from datetime import datetime, timezone, timedelta
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from src import cleanup
from src.config import settings


def _old_report(
    report_id: str,
    status: str = "COMPLETED",
    result_file_path: str | None = None,
    age_days: int = 45,
    deleted_at: datetime | None = None,
    aware_tz: bool = True,
):
    now = datetime.now(timezone.utc) if aware_tz else datetime.now(timezone.utc).replace(tzinfo=None)
    return SimpleNamespace(
        id=report_id,
        status=status,
        resultFilePath=result_file_path,
        createdAt=now - timedelta(days=age_days),
        deletedAt=deleted_at,
    )


def _set_old_mtime(path: Path, days: int = 45) -> None:
    ts = datetime.now(timezone.utc).timestamp() - (days * 86400)
    os.utime(path, (ts, ts))


class TestPaidReportRetention:
    @pytest.mark.asyncio
    async def test_old_s3_paid_report_keeps_db_and_s3_cleans_only_scratch(self, tmp_path: Path):
        results_dir = tmp_path / "results"
        results_dir.mkdir()
        s3_dir = results_dir / "rep_s3_old"
        s3_dir.mkdir()
        (s3_dir / "intermediate.pdf").write_bytes(b"temp")
        _set_old_mtime(s3_dir, days=45)

        fake_db = MagicMock()
        fake_db.reportrequest.find_many = AsyncMock(
            return_value=[
                _old_report("rep_s3_old", "COMPLETED", "reports/rep_s3_old/evidence_binder.pdf", age_days=45, aware_tz=True),
            ]
        )
        fake_db.reportrequest.delete = AsyncMock()
        fake_db.reportrequest.delete_many = AsyncMock()

        with patch.object(settings, "results_dir", results_dir), \
             patch.object(settings, "cleanup_max_age_days", 30), \
             patch("src.cleanup.get_db", return_value=fake_db), \
             patch("src.s3_client.delete_report_file") as mock_s3_del:
            removed, db_cleared = await cleanup.cleanup_old_reports()

        assert removed == 1
        assert db_cleared == 0
        assert not s3_dir.exists()
        fake_db.reportrequest.delete.assert_not_awaited()
        fake_db.reportrequest.delete_many.assert_not_awaited()
        mock_s3_del.assert_not_called()

    @pytest.mark.asyncio
    async def test_old_local_paid_report_keeps_final_pdf_and_cleans_debug(self, tmp_path: Path):
        results_dir = tmp_path / "results"
        results_dir.mkdir()
        local_dir = results_dir / "rep_local_old"
        local_dir.mkdir()
        final_pdf = local_dir / "evidence_binder.pdf"
        final_pdf.write_bytes(b"%PDF-1.4")
        draft_pdf = local_dir / "section_draft.pdf"
        draft_pdf.write_bytes(b"draft")
        debug_dir = local_dir / "debug"
        debug_dir.mkdir()
        (debug_dir / "screen.png").write_bytes(b"png")
        _set_old_mtime(local_dir, days=45)

        # Also test COMPLETED report without resultFilePath stays preserved conservatively
        empty_path_dir = results_dir / "rep_empty_path"
        empty_path_dir.mkdir()
        empty_final = empty_path_dir / "evidence_binder.pdf"
        empty_final.write_bytes(b"%PDF-1.4")
        _set_old_mtime(empty_path_dir, days=45)

        fake_db = MagicMock()
        fake_db.reportrequest.find_many = AsyncMock(
            return_value=[
                _old_report("rep_local_old", "COMPLETED", "local://rep_local_old/evidence_binder.pdf", age_days=45),
                _old_report("rep_empty_path", "PARTIAL", None, age_days=45, aware_tz=False),
            ]
        )

        with patch.object(settings, "results_dir", results_dir), \
             patch.object(settings, "cleanup_max_age_days", 30), \
             patch("src.cleanup.get_db", return_value=fake_db):
            removed, db_cleared = await cleanup.cleanup_old_reports()

        assert removed == 0
        assert db_cleared == 0
        assert final_pdf.exists()
        assert not draft_pdf.exists()
        assert not debug_dir.exists()
        assert empty_final.exists()

    @pytest.mark.asyncio
    async def test_cleans_old_failed_and_orphan_skips_fresh_and_active(self, tmp_path: Path):
        results_dir = tmp_path / "results"
        results_dir.mkdir()

        failed_dir = results_dir / "rep_failed_old"
        failed_dir.mkdir()
        _set_old_mtime(failed_dir, days=45)

        orphan_dir = results_dir / "rep_orphan_old"
        orphan_dir.mkdir()
        _set_old_mtime(orphan_dir, days=45)

        processing_dir = results_dir / "rep_processing_old"
        processing_dir.mkdir()
        _set_old_mtime(processing_dir, days=45)

        fresh_dir = results_dir / "rep_s3_fresh"
        fresh_dir.mkdir()
        _set_old_mtime(fresh_dir, days=5)

        fake_db = MagicMock()
        fake_db.reportrequest.find_many = AsyncMock(
            return_value=[
                _old_report("rep_failed_old", "FAILED", None, age_days=45),
                _old_report("rep_processing_old", "PROCESSING", None, age_days=45),
                _old_report("rep_s3_fresh", "COMPLETED", "reports/rep_s3_fresh/evidence_binder.pdf", age_days=5),
            ]
        )
        fake_db.reportrequest.delete = AsyncMock()
        fake_db.reportrequest.delete_many = AsyncMock()

        with patch.object(settings, "results_dir", results_dir), \
             patch.object(settings, "cleanup_max_age_days", 30), \
             patch("src.cleanup.get_db", return_value=fake_db):
            removed, db_cleared = await cleanup.cleanup_old_reports()

        assert removed == 2
        assert db_cleared == 0
        assert not failed_dir.exists()
        assert not orphan_dir.exists()
        assert processing_dir.exists()
        assert fresh_dir.exists()
        fake_db.reportrequest.delete.assert_not_awaited()
        fake_db.reportrequest.delete_many.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_cleanup_excess_reports_is_noop_for_50_pack_buyers(self):
        fake_db = MagicMock()
        fake_db.query_raw = AsyncMock()
        fake_db.reportrequest.delete = AsyncMock()

        with patch("src.cleanup.get_db", return_value=fake_db), \
             patch("src.s3_client.delete_report_file") as mock_s3_del:
            removed, db_cleared = await cleanup.cleanup_excess_reports()

        assert (removed, db_cleared) == (0, 0)
        fake_db.query_raw.assert_not_called()
        fake_db.reportrequest.delete.assert_not_called()
        mock_s3_del.assert_not_called()

    @pytest.mark.asyncio
    async def test_recover_stale_reports_marks_processing_failed(self):
        fake_db = MagicMock()
        fake_db.reportrequest.find_many = AsyncMock(return_value=[SimpleNamespace(id="stuck_1")])
        fake_db.reportrequest.update_many = AsyncMock(return_value=1)

        with patch("src.cleanup.get_db", return_value=fake_db):
            recovered = await cleanup.recover_stale_reports()

        assert recovered == 1
        fake_db.reportrequest.update_many.assert_awaited_once_with(
            where={"id": {"in": ["stuck_1"]}},
            data={"status": "FAILED"},
        )
