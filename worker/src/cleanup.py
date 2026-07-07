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
from typing import List, Tuple

from prisma import Prisma
from .config import settings

logger = logging.getLogger(__name__)


async def cleanup_old_reports() -> Tuple[int, int]:
    """Remove report directories older than cleanup_max_age_days.
    Also clears resultFilePath in DB for those reports.
    Returns (dirs_removed, db_rows_cleared)."""
    results_dir = settings.results_dir
    if not results_dir.exists():
        return 0, 0

    cutoff = datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(days=settings.cleanup_max_age_days)
    removed = 0
    db_cleared = 0

    db = Prisma()
    await db.connect()
    try:
        # Vytiahneme ID starých reportov
        old_reports = await db.reportrequest.find_many(
            where={"createdAt": {"lt": cutoff}}
        )
        if not old_reports:
            return 0, 0
            
        ids_to_delete = [r.id for r in old_reports]
        
        # Zmažeme ich z DB (Cascade sa postará o ReportSource)
        await db.reportrequest.delete_many(where={"id": {"in": ids_to_delete}})
        
        for report_id in ids_to_delete:
            db_cleared += 1
            
            # Zmaž zložku z disku
            child = results_dir / report_id
            if child.exists() and child.is_dir():
                try:
                    await asyncio.to_thread(shutil.rmtree, child, True)
                    removed += 1
                    logger.info(f"[CLEANUP] Removed old report completely: {report_id}")
                except Exception as e:
                    logger.warning(f"[CLEANUP] Failed to remove dir {child.name}: {e}")
                    
    except Exception as e:
        logger.error(f"[CLEANUP] Error deleting old reports from DB: {e}", exc_info=True)
    finally:
        await db.disconnect()

    return removed, db_cleared


async def cleanup_excess_reports() -> Tuple[int, int]:
    """Remove oldest reports per user that exceed cleanup_max_reports_per_user.
    Returns (dirs_removed, db_rows_cleared)."""
    max_reports = settings.cleanup_max_reports_per_user
    results_dir = settings.results_dir
    removed = 0
    db_cleared = 0

    db = Prisma()
    await db.connect()

    try:
        # Find users with more than max_reports completed/partial reports
        rows = await db.query_raw(
            '''SELECT "userId", COUNT(*) as cnt FROM "ReportRequest" 
               WHERE status IN ('COMPLETED', 'PARTIAL') 
               GROUP BY "userId" HAVING COUNT(*) > $1''',
            max_reports,
        )

        for row in rows:
            user_id = row["userId"]
            cnt = int(row["cnt"])
            
            # Get oldest report IDs to delete (beyond the limit)
            excess = await db.reportrequest.find_many(
                where={
                    "userId": user_id, 
                    "status": {"in": ["COMPLETED", "PARTIAL"]}
                },
                order={"createdAt": "asc"},
                take=(cnt - max_reports),
            )

            for ex_row in excess:
                report_id = ex_row.id
                
                # Zmaž záznam z DB (Cascade sa postará o ReportSource)
                try:
                    await db.reportrequest.delete(where={"id": report_id})
                    db_cleared += 1
                except Exception as db_err:
                    logger.warning(f"[CLEANUP] Failed to delete DB record for {report_id}: {db_err}")
                    
                # Delete files from disk
                report_dir = results_dir / report_id
                if report_dir.exists():
                    await asyncio.to_thread(shutil.rmtree, report_dir, True)
                    removed += 1
                    logger.info(f"[CLEANUP] Removed excess report completely for user {user_id}: {report_id}")

    except Exception as e:
        logger.error(f"[CLEANUP] Excess cleanup error: {e}", exc_info=True)
    finally:
        await db.disconnect()

    return removed, db_cleared


async def recover_stale_reports() -> int:
    """Mark PROCESSING reports older than 30 minutes as FAILED.

    This handles cases where the worker crashed mid-task.
    Returns count of recovered reports.
    """
    db = Prisma()
    await db.connect()

    recovered = 0
    try:
        cutoff = datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(minutes=30)
        stale_reports = await db.reportrequest.find_many(
            where={
                "status": "PROCESSING",
                "updatedAt": {"lt": cutoff}
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
        await db.disconnect()

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
