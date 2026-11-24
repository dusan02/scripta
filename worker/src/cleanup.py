"""Cleanup old local worker scratch directories without deleting paid reports.

Retention policy (P0.4):
- Paid/generated ReportRequest DB rows, ReportSource rows, and S3 final PDFs
  are NEVER deleted by periodic age-based or count-based cleanup.
- cleanup_old_reports() removes only local worker scratch directories older than
  cleanup_max_age_days (after S3 archival, or for FAILED/CANCELLED/orphan dirs),
  preserving local:// fallback PDFs for active COMPLETED/PARTIAL reports.
- cleanup_excess_reports() is intentionally a no-op so multi-pack/50-report
  buyers never lose historical reports.
- recover_stale_reports() marks hung PROCESSING reports (> threshold) as FAILED.
"""
from __future__ import annotations

import asyncio
import logging
import shutil
from datetime import datetime, timezone, timedelta
from pathlib import Path
from typing import Optional, Tuple

from .config import settings
from .db_client import get_db

logger = logging.getLogger(__name__)


def _is_before_cutoff(dt: Optional[datetime], cutoff_naive_utc: datetime) -> Optional[bool]:
    """Compare aware or naive datetimes cleanly against naive UTC cutoff."""
    if dt is None:
        return None
    if dt.tzinfo is not None:
        dt = dt.astimezone(timezone.utc).replace(tzinfo=None)
    return dt < cutoff_naive_utc


async def _clean_local_scratch_only(report_dir: Path) -> None:
    """Remove debug/intermediate scratch artifacts while preserving evidence_binder.pdf."""
    debug_dir = report_dir / "debug"
    if debug_dir.exists() and debug_dir.is_dir():
        await asyncio.to_thread(shutil.rmtree, debug_dir, True)
    for pdf in report_dir.glob("*.pdf"):
        if pdf.name != "evidence_binder.pdf":
            pdf.unlink(missing_ok=True)


async def cleanup_old_reports() -> Tuple[int, int]:
    """Clean expired local worker scratch directories older than cleanup_max_age_days.

    Never deletes ReportRequest DB rows or S3 report PDFs.
    Returns (dirs_removed, db_rows_cleared) where db_rows_cleared is always 0.
    """
    results_dir = settings.results_dir
    if not results_dir.exists():
        return 0, 0

    child_dirs = [c for c in results_dir.iterdir() if c.is_dir()]
    if not child_dirs:
        return 0, 0

    cutoff = datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(days=settings.cleanup_max_age_days)
    cutoff_ts = datetime.now(timezone.utc).timestamp() - (settings.cleanup_max_age_days * 86400)
    removed = 0

    db = get_db()
    try:
        dir_ids = [c.name for c in child_dirs]
        reports = await db.reportrequest.find_many(
            where={"id": {"in": dir_ids}}
        )
        report_by_id = {r.id: r for r in reports}

        for child in child_dirs:
            try:
                mtime_older = child.stat().st_mtime < cutoff_ts
            except OSError:
                continue

            report = report_by_id.get(child.name)
            if report is None:
                # Orphan scratch directory without any ReportRequest record
                if mtime_older:
                    try:
                        await asyncio.to_thread(shutil.rmtree, child, True)
                        removed += 1
                        logger.info(f"[CLEANUP] Removed orphan scratch dir: {child.name}")
                    except Exception as e:
                        logger.warning(f"[CLEANUP] Failed to remove orphan dir {child.name}: {e}")
                continue

            created_old = _is_before_cutoff(getattr(report, "createdAt", None), cutoff)
            is_old = created_old if created_old is not None else mtime_older
            if not is_old:
                continue

            status = getattr(report, "status", None)
            deleted_at = getattr(report, "deletedAt", None)
            result_path = getattr(report, "resultFilePath", None) or ""

            # Never disturb jobs still queued or actively running
            if status in ("PENDING", "PROCESSING") and deleted_at is None:
                continue

            # Retain local final PDFs unless an S3 key is explicitly recorded
            has_s3_copy = bool(result_path) and not result_path.startswith("local://")
            if status in ("COMPLETED", "PARTIAL") and deleted_at is None and not has_s3_copy:
                try:
                    await _clean_local_scratch_only(child)
                except Exception as e:
                    logger.warning(f"[CLEANUP] Failed to clean scratch inside local report {child.name}: {e}")
                continue

            # For S3-archived completed reports, FAILED/CANCELLED, or soft-deleted reports,
            # removing only local worker scratch frees disk while keeping DB + S3 intact.
            try:
                await asyncio.to_thread(shutil.rmtree, child, True)
                removed += 1
                logger.info(f"[CLEANUP] Removed local scratch dir (DB + S3 retained): {child.name}")
            except Exception as e:
                logger.warning(f"[CLEANUP] Failed to remove dir {child.name}: {e}")

    except Exception as e:
        logger.error(f"[CLEANUP] Scratch cleanup error: {e}", exc_info=True)

    return removed, 0


async def cleanup_excess_reports() -> Tuple[int, int]:
    """No-op retention guard (P0.4): never delete user ReportRequest rows or S3 PDFs."""
    return 0, 0


async def recover_stale_reports() -> int:
    """Mark PROCESSING reports older than the configured threshold as FAILED.

    This handles cases where the worker crashed mid-task (OOM, SIGKILL).
    Returns count of recovered reports.
    """
    db = get_db()

    recovered = 0
    try:
        threshold_min = settings.stale_report_threshold_minutes
        cutoff = datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(minutes=threshold_min)
        stale_reports = await db.reportrequest.find_many(
            where={
                "status": "PROCESSING",
                "updatedAt": {"lt": cutoff},
                "deletedAt": None
            }
        )
        if stale_reports:
            ids = [r.id for r in stale_reports]
            recovered = await db.reportrequest.update_many(
                where={"id": {"in": ids}},
                data={"status": "FAILED"}
            )
            if recovered > 0:
                logger.warning(f"[CLEANUP] Marked {recovered} stale PROCESSING reports as FAILED")
    except Exception as e:
        logger.error(f"[CLEANUP] Stale recovery error: {e}", exc_info=True)
    finally:
        pass

    return recovered


async def _cleanup_loop() -> None:
    """Run cleanup periodically (age-based + count-based + stale recovery)."""
    interval = settings.cleanup_interval_hours * 60 * 60
    # First run after 60s, then on schedule
    await asyncio.sleep(60)
    while True:
        try:
            stale = await recover_stale_reports()
            removed_age, db_age = await cleanup_old_reports()
            removed_excess, db_excess = await cleanup_excess_reports()
            total_removed = removed_age + removed_excess
            total_db = db_age + db_excess
            if total_removed or stale:
                logger.info(
                    f"[CLEANUP] Recovered {stale} stale, "
                    f"removed {total_removed} report dirs "
                    f"({removed_age} old + {removed_excess} excess), "
                    f"cleared {total_db} DB rows"
                )
        except Exception as e:
            logger.error(f"[CLEANUP] Error: {e}", exc_info=True)
        await asyncio.sleep(interval)
