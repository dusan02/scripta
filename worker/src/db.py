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
        assert _pool is not None, "asyncpg.create_pool returned None"
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
    verifa_score: Optional[int] = None,
) -> None:
    completed_at = datetime.now(timezone.utc).replace(tzinfo=None) if status in ("COMPLETED", "PARTIAL") else None

    # Build dynamic SET clause — avoids duplicating the query for optional company_name
    sets = ['status = $1', '"resultFilePath" = $2', '"completedAt" = $3', '"updatedAt" = NOW()']
    args: list = [status, result_file_path, completed_at]
    if company_name:
        sets.append(f'"companyName" = ${len(args) + 1}')
        args.append(company_name)
    if verifa_score is not None:
        sets.append(f'"verifaScore" = ${len(args) + 1}')
        args.append(verifa_score)
    args.append(report_request_id)

    placeholder = f"${len(args)}"
    await pool.execute(
        f'UPDATE "ReportRequest" SET {", ".join(sets)} WHERE id = {placeholder}',
        *args,
    )


async def get_avg_completion_seconds(pool: asyncpg.Pool, limit: int = 20) -> Optional[float]:
    """Vráti priemerný čas dokončenia (v sekundách) z posledných N completed/partial reportov.
    Filtruje outliery > 30 min (stuck/retried reporty). Vráti None ak nie sú dáta."""
    rows = await pool.fetch(
        """
        SELECT EXTRACT(EPOCH FROM ("completedAt" - "createdAt")) AS duration
        FROM "ReportRequest"
        WHERE status IN ('COMPLETED', 'PARTIAL')
          AND "completedAt" IS NOT NULL
        ORDER BY "completedAt" DESC
        LIMIT $1
        """,
        limit,
    )
    if not rows:
        return None
    # Filter out stuck/retried reports (> 30 min = 1800s)
    durations = [r["duration"] for r in rows if r["duration"] and 0 < r["duration"] < 1800]
    if not durations:
        return None
    return sum(durations) / len(durations)


async def get_avg_phase_durations(pool: asyncpg.Pool, limit: int = 20) -> Optional[dict]:
    """Vráti priemerné trvania jednotlivých fáz (scrapers/AI/auditor/compile) v sekundách
    z posledných N completed reportov. Používa median pre odolnosť voči outliers."""
    rows = await pool.fetch(
        """
        SELECT "scrapersMs", "aiMs", "auditorMs", "compileMs",
               EXTRACT(EPOCH FROM ("completedAt" - "createdAt")) AS total
        FROM "ReportRequest"
        WHERE status IN ('COMPLETED', 'PARTIAL')
          AND "completedAt" IS NOT NULL
        ORDER BY "completedAt" DESC
        LIMIT $1
        """,
        limit,
    )
    if not rows:
        return None

    def _median(values: list) -> Optional[float]:
        vals = sorted(v for v in values if v is not None and v > 0)
        if not vals:
            return None
        mid = len(vals) // 2
        return vals[mid] if len(vals) % 2 == 1 else (vals[mid - 1] + vals[mid]) / 2

    result = {}
    for phase, col in [("scrapers", "scrapersMs"), ("ai", "aiMs"), ("auditor", "auditorMs"), ("compile", "compileMs")]:
        vals = [r[col] for r in rows if r[col] is not None and r[col] > 0]
        med = _median(vals)
        result[phase] = med / 1000.0 if med else None  # ms → s

    totals = [r["total"] for r in rows if r["total"] and 0 < r["total"] < 1800]
    result["total"] = _median(totals)
    return result if any(v is not None for v in result.values()) else None


async def save_phase_duration(pool: asyncpg.Pool, report_request_id: str, phase: str, duration_ms: int) -> None:
    """Uloží trvanie jednej fázy do DB."""
    col_map = {"scrapers": "scrapersMs", "ai": "aiMs", "auditor": "auditorMs", "compile": "compileMs"}
    col = col_map.get(phase)
    if not col:
        return
    await pool.execute(
        f'UPDATE "ReportRequest" SET "{col}" = $1, "updatedAt" = NOW() WHERE id = $2',
        duration_ms, report_request_id
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


async def create_bug_report(
    pool: asyncpg.Pool,
    report_request_id: str,
    error_details: str,
) -> None:
    """Vytvorí Feedback záznam s kategóriou BUG pre zlyhaný report.
    Záznam sa vytvorí len ak ešte neexistuje pre daný report (idempotent)."""
    try:
        row = await pool.fetchrow(
            'SELECT "userId", ico, "companyName" FROM "ReportRequest" WHERE id = $1',
            report_request_id,
        )
        if not row:
            return

        existing = await pool.fetchval(
            'SELECT id FROM "Feedback" WHERE "requestId" = $1 AND category = $2',
            report_request_id, "BUG",
        )
        if existing:
            return

        ico = row["ico"] or "neznáme"
        company = row["companyname"] or "neznáma"
        message = (
            f"[AUTO-BUG] Report {report_request_id} zlyhal.\n"
            f"Firma: {company} (IČO: {ico})\n"
            f"Chyba: {error_details[:2000]}"
        )

        await pool.execute(
            """
            INSERT INTO "Feedback" (id, "userId", category, "requestId", message, status, "createdAt", "updatedAt")
            VALUES (gen_random_uuid(), $1, 'BUG', $2, $3, 'OPEN', NOW(), NOW())
            """,
            row["userId"],
            report_request_id,
            message,
        )
    except Exception as e:
        import logging
        logging.getLogger(__name__).warning(f"Nepodarilo sa vytvoriť bug report pre {report_request_id}: {e}")


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


