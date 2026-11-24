#!/bin/bash
# ORSR Bulk Seed Monitor — run anytime: bash scripts/orsr_monitor.sh
# Shows: checkpoint progress, DB counts, throughput, errors, memory, log size

cd /var/www/verifa
docker compose exec -T worker python3 -c '
import asyncio, asyncpg, os, json, time
from pathlib import Path

async def main():
    url = os.environ["DATABASE_URL"].replace("postgresql+asyncpg://", "postgresql://").replace("postgresql+psycopg://", "postgresql://")
    conn = await asyncpg.connect(url)

    cp_path = Path("/app/results/orsr_v2_checkpoint.json")
    cp = json.loads(cp_path.read_text()) if cp_path.exists() else {}

    synced_total = await conn.fetchval("SELECT COUNT(*) FROM \"Company\" WHERE \"orsrSyncedAt\" IS NOT NULL")
    synced_with_fs = await conn.fetchval("""
        SELECT COUNT(*) FROM "Company" c 
        WHERE c."orsrSyncedAt" IS NOT NULL 
        AND EXISTS (SELECT 1 FROM "FinancialStatement" f WHERE f."companyIco" = c."ico")
    """)
    remaining = await conn.fetchval("""
        SELECT COUNT(*) FROM "Company" c 
        WHERE c."orsrSyncedAt" IS NULL 
        AND EXISTS (SELECT 1 FROM "FinancialStatement" f WHERE f."companyIco" = c."ico")
        AND c."legalForm" = ANY(ARRAY["s.r.o.", "a.s.", "v.o.s.", "k.s."])
    """)

    log_path = Path("/app/results/orsr_seed_production.log")
    log_size = log_path.stat().st_size if log_path.exists() else 0

    # Count errors in log
    errors = 0
    if log_path.exists():
        for line in log_path.read_text().splitlines():
            if "ERROR" in line or "FAILED" in line:
                errors += 1

    # Memory
    mem_total = 0
    mem_avail = 0
    meminfo_path = Path("/proc/meminfo")
    if meminfo_path.exists():
        for line in meminfo_path.read_text().splitlines()[:5]:
            parts = line.split()
            if len(parts) >= 2:
                if parts[0].rstrip(":") == "MemTotal":
                    mem_total = int(parts[1])
                elif parts[0].rstrip(":") == "MemAvailable":
                    mem_avail = int(parts[1])

    total_target = synced_with_fs + remaining
    pct = synced_with_fs / total_target * 100 if total_target > 0 else 0

    print("=" * 60)
    print("  ORSR BULK SEED — MONITORING")
    print("=" * 60)
    print(f"  Checkpoint:")
    print(f"    last_ico:       {cp.get("last_ico", "?")}")
    print(f"    processed:      {cp.get("processed_count", 0)}")
    print(f"    failed:         {cp.get("failed_count", 0)}")
    print(f"    not_found:      {cp.get("not_found_count", 0)}")
    print(f"    last_run:       {cp.get("last_run", "?")}")
    print(f"")
    print(f"  Database:")
    print(f"    Synced total:       {synced_total:>8,}")
    print(f"    Synced + FS:        {synced_with_fs:>8,}")
    print(f"    Remaining (FS+LF):  {remaining:>8,}")
    print(f"    Progress:           {pct:.1f}%")
    print(f"")
    print(f"  Health:")
    print(f"    Log errors:     {errors}")
    print(f"    Log size:       {log_size / 1024 / 1024:.1f} MB")
    if mem_total:
        used_pct = (1 - mem_avail / mem_total) * 100
        print(f"    Memory:         {mem_avail / 1024:.0f} MB avail / {mem_total / 1024:.0f} MB total ({used_pct:.0f}% used)")
    print("=" * 60)

    await conn.close()

asyncio.run(main())
'
