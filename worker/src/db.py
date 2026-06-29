"""Jednoduchý async DB helper pre worker. Update-only — Prisma canonical model zostáva v Next.js."""
from __future__ import annotations
from datetime import datetime, timezone
from typing import List, Optional

import asyncpg

from .config import settings
from .models import ScrapedSource

# Modulový singleton — pool sa vytvorí raz a znovu používa naprieč úlohami.
_pool: Optional[asyncpg.Pool] = None


async def get_db_pool() -> asyncpg.Pool:
    global _pool
    if _pool is None:
        _pool = await asyncpg.create_pool(settings.database_url, min_size=2, max_size=10)
    return _pool


async def close_db_pool() -> None:
    global _pool
    if _pool is not None:
        await _pool.close()
        _pool = None


async def update_report_status(
    pool: asyncpg.Pool,
    report_request_id: str,
    status: str,
    result_file_path: Optional[str] = None,
    company_name: Optional[str] = None,
) -> None:
    completed_at = datetime.now(timezone.utc).replace(tzinfo=None) if status in ("COMPLETED", "PARTIAL") else None

    # Build dynamic SET clause — avoids duplicating the query for optional company_name
    sets = ['status = $1', '"resultFilePath" = $2', '"completedAt" = $3', '"updatedAt" = NOW()']
    args: list = [status, result_file_path, completed_at]
    if company_name:
        sets.append('"companyName" = $4')
        args.append(company_name)
    args.append(report_request_id)

    placeholder = f"${len(args)}"
    await pool.execute(
        f'UPDATE "ReportRequest" SET {", ".join(sets)} WHERE id = {placeholder}',
        *args,
    )


async def update_report_ai_status(
    pool: asyncpg.Pool,
    report_request_id: str,
    ai_status: str,
    eta: Optional[int] = None,
) -> None:
    """Aktualizuje informačný status pre AI pipeline a odhadovaný čas."""
    await pool.execute(
        'UPDATE "ReportRequest" SET "aiStatus" = $1, "eta" = $2, "updatedAt" = NOW() WHERE id = $3',
        ai_status, eta, report_request_id
    )


async def upsert_report_sources(
    pool: asyncpg.Pool,
    report_request_id: str,
    sources: List[ScrapedSource],
) -> None:
    async with pool.acquire() as conn:
        async with conn.transaction():
            for source in sources:
                await _upsert_one(conn, report_request_id, source)


async def upsert_single_report_source(
    pool: asyncpg.Pool,
    report_request_id: str,
    source: ScrapedSource,
) -> None:
    """Upsertne jeden zdroj do DB — pre okamžité aktualizácie po dokončení scraperu."""
    async with pool.acquire() as conn:
        async with conn.transaction():
            await _upsert_one(conn, report_request_id, source)


async def update_source_page_counts(
    pool: asyncpg.Pool,
    report_request_id: str,
    sources: List[ScrapedSource],
) -> None:
    """Aktualizuje pageCount v DB podľa reálnych hodnôt zistených compilerom."""
    async with pool.acquire() as conn:
        async with conn.transaction():
            for source in sources:
                if source.status == "SUCCESS" and source.page_count and source.page_count > 0:
                    await conn.execute(
                        'UPDATE "ReportSource" SET "pageCount" = $1, "updatedAt" = NOW() '
                        'WHERE "reportRequestId" = $2 AND "sourceType" = $3',
                        source.page_count,
                        report_request_id,
                        source.source_type,
                    )


async def _upsert_one(conn, report_request_id: str, source: ScrapedSource) -> None:
    await conn.execute(
        """
        INSERT INTO "ReportSource" (
            id, "reportRequestId", "sourceType", status, "statusMessage",
            "filePath", "pageCount", findings, "createdAt", "updatedAt"
        )
        VALUES (
            gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, NOW(), NOW()
        )
        ON CONFLICT ("reportRequestId", "sourceType")
        DO UPDATE SET
            status = EXCLUDED.status,
            "statusMessage" = EXCLUDED."statusMessage",
            "filePath" = EXCLUDED."filePath",
            "pageCount" = EXCLUDED."pageCount",
            findings = EXCLUDED.findings,
            "updatedAt" = NOW()
        """,
        report_request_id,
        source.source_type,
        source.status,
        source.status_message,
        source.file_path,
        source.page_count,
        source.findings,
    )


