"""Cleanup old generated PDF files to prevent disk exhaustion."""
from __future__ import annotations

import asyncio
import logging
import shutil
from datetime import datetime, timezone, timedelta
from pathlib import Path

from .config import settings

logger = logging.getLogger(__name__)

MAX_AGE_DAYS = 30


async def cleanup_old_reports() -> int:
    """Remove report directories older than MAX_AGE_DAYS.
    Returns number of removed directories."""
    results_dir = settings.results_dir
    if not results_dir.exists():
        return 0

    cutoff = datetime.now(timezone.utc) - timedelta(days=MAX_AGE_DAYS)
    removed = 0

    for child in results_dir.iterdir():
        if not child.is_dir():
            continue
        try:
            mtime = datetime.fromtimestamp(child.stat().st_mtime, tz=timezone.utc)
            if mtime < cutoff:
                shutil.rmtree(child, ignore_errors=True)
                removed += 1
                logger.info(f"[CLEANUP] Removed old report dir: {child.name}")
        except Exception as e:
            logger.warning(f"[CLEANUP] Failed to check/remove {child.name}: {e}")

    return removed


async def _cleanup_loop() -> None:
    """Run cleanup every 24 hours."""
    while True:
        try:
            removed = await cleanup_old_reports()
            if removed:
                logger.info(f"[CLEANUP] Removed {removed} old report directories")
        except Exception as e:
            logger.error(f"[CLEANUP] Error: {e}", exc_info=True)
        await asyncio.sleep(24 * 60 * 60)
