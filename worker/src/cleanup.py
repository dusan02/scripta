"""Cleanup old generated PDF files to prevent disk exhaustion.

Two strategies:
1. Age-based — delete report dirs older than cleanup_max_age_days
2. Count-based — keep only cleanup_max_reports_per_user per user (oldest first)

Also clears resultFilePath in DB for deleted reports."""
from __future__ import annotations

import asyncio
import logging
import shutil
from datetime import datetime, timezone, timedelta
from pathlib import Path
from typing import List, Tuple

import asyncpg

from .config import settings

logger = logging.getLogger(__name__)


async def _get_db_pool() -> asyncpg.Pool:
    """Get a short-lived DB connection for cleanup queries."""
    return await asyncpg.connect(settings.database_url)


async def cleanup_old_reports() -> Tuple[int, int]:
    """Remove report directories older than cleanup_max_age_days.
    Also clears resultFilePath in DB for those reports.
    Returns (dirs_removed, db_rows_cleared)."""
    results_dir = settings.results_dir
    if not results_dir.exists():
        return 0, 0

    cutoff = datetime.now(timezone.utc) - timedelta(days=settings.cleanup_max_age_days)
    removed = 0
    db_cleared = 0

    conn = None
    try:
        conn = await _get_db_pool()
    except Exception as e:
        logger.warning(f"[CLEANUP] DB connection failed, will skip DB cleanup: {e}")

    for child in results_dir.iterdir():
        if not child.is_dir():
            continue
        try:
            mtime = datetime.fromtimestamp(child.stat().st_mtime, tz=timezone.utc)
            if mtime < cutoff:
                report_id = child.name
                shutil.rmtree(child, ignore_errors=True)
                removed += 1
                logger.info(f"[CLEANUP] Removed old report dir: {report_id}")
                # Clear resultFilePath in DB so download doesn't 404 on stale path
                if conn:
                    try:
                        result = await conn.execute(
                            'UPDATE "ReportRequest" SET "resultFilePath" = NULL, "updatedAt" = NOW() '
                            'WHERE id = $1 AND "resultFilePath" IS NOT NULL',
                            report_id,
                        )
                        if result.endswith("1"):
                            db_cleared += 1
                    except Exception as db_err:
                        logger.warning(f"[CLEANUP] Failed to clear DB for {report_id}: {db_err}")
        except Exception as e:
            logger.warning(f"[CLEANUP] Failed to check/remove {child.name}: {e}")

    if conn:
        await conn.close()

    return removed, db_cleared


async def cleanup_excess_reports() -> Tuple[int, int]:
    """Remove oldest reports per user that exceed cleanup_max_reports_per_user.
    Returns (dirs_removed, db_rows_cleared)."""
    max_reports = settings.cleanup_max_reports_per_user
    results_dir = settings.results_dir
    removed = 0
    db_cleared = 0

    conn = None
    try:
        conn = await _get_db_pool()
    except Exception as e:
        logger.warning(f"[CLEANUP] DB connection failed, skipping excess cleanup: {e}")
        return 0, 0

    try:
        # Find users with more than max_reports completed/partial reports
        rows: List[asyncpg.Record] = await conn.fetch(
            'SELECT "userId", COUNT(*) as cnt FROM "ReportRequest" '
            'WHERE status IN (\'COMPLETED\', \'PARTIAL\') '
            'GROUP BY "userId" HAVING COUNT(*) > $1',
            max_reports,
        )

        for row in rows:
            user_id = row["userId"]
            # Get oldest report IDs to delete (beyond the limit)
            excess: List[asyncpg.Record] = await conn.fetch(
                'SELECT id FROM "ReportRequest" '
                'WHERE "userId" = $1 AND status IN (\'COMPLETED\', \'PARTIAL\') '
                'ORDER BY "createdAt" ASC LIMIT $2',
                user_id,
                row["cnt"] - max_reports,
            )

            for ex_row in excess:
                report_id = ex_row["id"]
                # Delete files from disk
                report_dir = results_dir / report_id
                if report_dir.exists():
                    shutil.rmtree(report_dir, ignore_errors=True)
                    removed += 1
                    logger.info(f"[CLEANUP] Removed excess report dir for user {user_id}: {report_id}")
                # Clear resultFilePath in DB
                try:
                    result = await conn.execute(
                        'UPDATE "ReportRequest" SET "resultFilePath" = NULL, "updatedAt" = NOW() '
                        'WHERE id = $1 AND "resultFilePath" IS NOT NULL',
                        report_id,
                    )
                    if result.endswith("1"):
                        db_cleared += 1
                except Exception as db_err:
                    logger.warning(f"[CLEANUP] Failed to clear DB for {report_id}: {db_err}")

    except Exception as e:
        logger.error(f"[CLEANUP] Excess cleanup error: {e}", exc_info=True)
    finally:
        if conn:
            await conn.close()

    return removed, db_cleared


async def _cleanup_loop() -> None:
    """Run cleanup periodically (age-based + count-based)."""
    interval = settings.cleanup_interval_hours * 60 * 60
    while True:
        try:
            removed_age, db_age = await cleanup_old_reports()
            removed_excess, db_excess = await cleanup_excess_reports()
            total_removed = removed_age + removed_excess
            total_db = db_age + db_excess
            if total_removed:
                logger.info(
                    f"[CLEANUP] Removed {total_removed} report dirs "
                    f"({removed_age} old + {removed_excess} excess), "
                    f"cleared {total_db} DB rows"
                )
        except Exception as e:
            logger.error(f"[CLEANUP] Error: {e}", exc_info=True)
        await asyncio.sleep(interval)
