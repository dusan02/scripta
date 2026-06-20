"""Jednoduchý async DB helper pre worker. Update-only — Prisma canonical model zostáva v Next.js."""
from datetime import datetime, timezone
from typing import List

import asyncpg

from .config import settings
from .models import ScrapedSource


async def get_db_pool() -> asyncpg.Pool:
    return await asyncpg.create_pool(settings.database_url)


async def update_report_status(
    pool: asyncpg.Pool,
    report_request_id: str,
    status: str,
    result_file_path: str | None = None,
) -> None:
    completed_at = datetime.now(timezone.utc) if status in ("COMPLETED", "PARTIAL") else None
    await pool.execute(
        """
        UPDATE "ReportRequest"
        SET status = $1, "resultFilePath" = $2, "completedAt" = $3, "updatedAt" = NOW()
        WHERE id = $4
        """,
        status,
        result_file_path,
        completed_at,
        report_request_id,
    )


async def upsert_report_sources(
    pool: asyncpg.Pool,
    report_request_id: str,
    sources: List[ScrapedSource],
) -> None:
    async with pool.acquire() as conn:
        async with conn.transaction():
            for source in sources:
                await conn.execute(
                    """
                    INSERT INTO "ReportSource" (
                        id, "reportRequestId", "sourceType", status, "statusMessage",
                        "filePath", "pageCount", "costCredits", findings, "createdAt", "updatedAt"
                    )
                    VALUES (
                        gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8, NOW(), NOW()
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
                    0,  # costCredits už bol nastavený pri vytvorení v Next.js; ON CONFLICT ho neprepíše
                    source.findings,
                )
