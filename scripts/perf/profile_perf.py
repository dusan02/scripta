#!/usr/bin/env python3
"""
Read-only backend performance profiler for Verifa.

Parses Nginx `verifa_perf.log*` files (plain text or `.gz`) to compute P50/P95/P99
latency, status codes, and cache hit/miss breakdowns by route group and API sub-route.

Usage:
  python3 scripts/perf/profile_perf.py /var/log/nginx/verifa_perf.log /var/log/nginx/verifa_perf.log.1
  python3 scripts/perf/profile_perf.py --json /var/log/nginx/verifa_perf.log*
  python3 scripts/perf/profile_perf.py --print-readonly-sql
"""

from __future__ import annotations

import argparse
import collections
import gzip
import json
import math
import re
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Dict, Iterable, List, Optional, TextIO, Tuple

# Example line:
# 74.7.227.18 - [25/Nov/2026:00:00:24 +0100] "GET /firma/50928821-mstr-s-r-o?_rsc=1b9iq HTTP/2.0" 200 27794 "https://verifa.sk/..." "Mozilla/5.0..." rt=0.112 cache=HIT
PERF_LINE_RE = re.compile(
    r'"([A-Z]+)\s+([^\s]+)\s+HTTP/[^"]+"\s+(\d{3})\s+(\d+)\s+"[^"]*"\s+"([^"]*)"\s+rt=([0-9.]+)\s+cache=([A-Za-z0-9_-]+)'
)

LANG_FIRMA_RE = re.compile(r"^/(en|de|cs|pl|hu|sk)/firma/")
LANG_FIRMY_RE = re.compile(r"^/(en|de|cs|pl|hu)/firmy(/|$)")
LANG_SCREENER_RE = re.compile(r"^/(en|de|cs|pl|hu)/screener(/|$)")
LANG_OSOBA_RE = re.compile(r"^/(en|de|cs|pl|hu)/osoba/")
DYNAMIC_ID_RE = re.compile(r"^(\d{6,10}|[0-9a-fA-F-]{16,}|c[a-z0-9]{20,})$")

READONLY_DIAGNOSTICS_GUIDE = """\
# Strictly Read-Only Production DB & Redis Inspection Commands (run via SSH on VPS)

## 1. PostgreSQL Buffer Hit Ratio & Table Scans
docker exec verifa_postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -X -P pager=off -c "
  SELECT datname, blks_hit, blks_read,
         ROUND(100.0 * blks_hit / NULLIF(blks_hit + blks_read, 0), 2) AS hit_ratio_pct,
         numbackends
  FROM pg_stat_database WHERE datname = current_database();
  SELECT relname, seq_scan, seq_tup_read, idx_scan, idx_tup_fetch,
         pg_size_pretty(pg_total_relation_size(relid)) AS total_size,
         pg_size_pretty(pg_indexes_size(relid)) AS idx_size
  FROM pg_stat_user_tables ORDER BY seq_tup_read DESC LIMIT 20;
"'

## 2. PostgreSQL Unused & High-Read Indexes
docker exec verifa_postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -X -P pager=off -c "
  SELECT relname, indexrelname, idx_scan, idx_tup_read, idx_tup_fetch,
         pg_size_pretty(pg_relation_size(indexrelid)) AS idx_size
  FROM pg_stat_user_indexes ORDER BY idx_tup_read DESC LIMIT 30;
"'

## 3. Redis Hit Ratio & Memory Usage
docker exec verifa_redis redis-cli -a "$REDIS_PASSWORD" --no-auth-warning INFO stats | grep -E "keyspace_|ops_per_sec|evicted"
docker exec verifa_redis redis-cli -a "$REDIS_PASSWORD" --no-auth-warning INFO memory | grep -E "used_memory_human|maxmemory"
docker exec verifa_redis redis-cli -a "$REDIS_PASSWORD" --no-auth-warning INFO keyspace
"""


@dataclass(frozen=True)
class ParsedPerfEntry:
    method: str
    path: str
    status: int
    bytes_sent: int
    user_agent: str
    rt_ms: float
    cache_status: str
    is_rsc: bool
    route_group: str
    api_subroute: Optional[str] = None


@dataclass
class LatencySummary:
    count: int
    p50_ms: float
    p95_ms: float
    p99_ms: float
    max_ms: float
    mean_ms: float
    cache_counts: Dict[str, int] = field(default_factory=dict)
    status_counts: Dict[str, int] = field(default_factory=dict)


def classify_route_group(path: str) -> str:
    """Classify a request path (with optional query string) into a Verifa route group."""
    clean = path.split("?", 1)[0]
    if LANG_FIRMA_RE.match(clean):
        return "/{lang}/firma/..."
    if clean.startswith("/firma/"):
        return "/firma/[ico-slug]"
    if clean.startswith("/api/"):
        return "/api/..."
    if clean == "/firmy" or clean.startswith("/firmy/") or LANG_FIRMY_RE.match(clean):
        return "/firmy"
    if clean == "/screener" or clean.startswith("/screener/") or LANG_SCREENER_RE.match(clean):
        return "/screener"
    if clean.startswith("/osoba/") or LANG_OSOBA_RE.match(clean):
        return "/osoba/..."
    if clean.startswith("/sitemap") or clean.endswith(".xml"):
        return "/sitemap*.xml"
    if clean.startswith("/_next/"):
        return "/_next/..."
    if clean in ("/", "/en", "/de", "/cs", "/pl", "/hu"):
        return "/ (home)"
    return "other"


def normalize_api_subroute(path: str) -> str:
    """Normalize dynamic IDs (ICO, UUID, CUID) in `/api/...` paths for aggregation."""
    clean = path.split("?", 1)[0]
    parts = [seg for seg in clean.split("/") if seg]
    normalized = [":id" if DYNAMIC_ID_RE.match(seg) else seg for seg in parts[:4]]
    return "/" + "/".join(normalized)


def parse_perf_line(line: str) -> Optional[ParsedPerfEntry]:
    """Parse a single line from `/var/log/nginx/verifa_perf.log`. Returns None if unparseable."""
    match = PERF_LINE_RE.search(line)
    if not match:
        return None
    method, path, status_s, bytes_s, ua, rt_s, cache_status = match.groups()
    rt_ms = float(rt_s) * 1000.0
    route_group = classify_route_group(path)
    api_subroute = normalize_api_subroute(path) if route_group == "/api/..." else None
    return ParsedPerfEntry(
        method=method,
        path=path,
        status=int(status_s),
        bytes_sent=int(bytes_s),
        user_agent=ua,
        rt_ms=rt_ms,
        cache_status=cache_status,
        is_rsc="_rsc=" in path,
        route_group=route_group,
        api_subroute=api_subroute,
    )


def percentile(sorted_values: List[float], pct: float) -> float:
    """Linear-interpolated percentile (0..100) on a pre-sorted non-empty list."""
    if not sorted_values:
        return 0.0
    if len(sorted_values) == 1:
        return float(sorted_values[0])
    rank = (len(sorted_values) - 1) * (pct / 100.0)
    low = math.floor(rank)
    high = math.ceil(rank)
    if low == high:
        return float(sorted_values[int(rank)])
    return float(sorted_values[low] + (sorted_values[high] - sorted_values[low]) * (rank - low))


def summarize_latencies(
    values: List[float],
    cache_counts: Optional[Dict[str, int]] = None,
    status_counts: Optional[Dict[str, int]] = None,
) -> LatencySummary:
    if not values:
        return LatencySummary(0, 0.0, 0.0, 0.0, 0.0, 0.0, {}, {})
    ordered = sorted(values)
    return LatencySummary(
        count=len(ordered),
        p50_ms=round(percentile(ordered, 50.0), 1),
        p95_ms=round(percentile(ordered, 95.0), 1),
        p99_ms=round(percentile(ordered, 99.0), 1),
        max_ms=round(ordered[-1], 1),
        mean_ms=round(sum(ordered) / len(ordered), 1),
        cache_counts=dict(cache_counts or {}),
        status_counts=dict(status_counts or {}),
    )


def profile_lines(lines: Iterable[str], top_api: int = 20) -> Dict[str, object]:
    """Aggregate latency, cache, and status metrics across an iterable of log lines."""
    total_lines = 0
    parsed_lines = 0
    rsc_requests = 0

    group_rts: Dict[str, List[float]] = collections.defaultdict(list)
    group_miss_rts: Dict[str, List[float]] = collections.defaultdict(list)
    group_cache: Dict[str, collections.Counter] = collections.defaultdict(collections.Counter)
    group_status: Dict[str, collections.Counter] = collections.defaultdict(collections.Counter)
    api_rts: Dict[str, List[float]] = collections.defaultdict(list)

    for line in lines:
        total_lines += 1
        entry = parse_perf_line(line)
        if entry is None:
            continue
        parsed_lines += 1
        if entry.is_rsc:
            rsc_requests += 1

        group_rts[entry.route_group].append(entry.rt_ms)
        group_cache[entry.route_group][entry.cache_status] += 1
        status_bucket = f"{entry.status // 100}xx" if entry.status != 499 else "499"
        group_status[entry.route_group][status_bucket] += 1
        if entry.cache_status == "MISS":
            group_miss_rts[entry.route_group].append(entry.rt_ms)
        if entry.api_subroute:
            api_rts[entry.api_subroute].append(entry.rt_ms)

    route_groups = {
        group: summarize_latencies(rts, group_cache[group], group_status[group]).__dict__
        for group, rts in sorted(group_rts.items(), key=lambda kv: -len(kv[1]))
    }
    cache_miss_groups = {
        group: summarize_latencies(rts).__dict__
        for group, rts in sorted(group_miss_rts.items(), key=lambda kv: -len(kv[1]))
    }
    top_api_routes = {
        route: summarize_latencies(rts).__dict__
        for route, rts in sorted(api_rts.items(), key=lambda kv: -len(kv[1]))[:top_api]
    }

    return {
        "total_lines": total_lines,
        "parsed_lines": parsed_lines,
        "skipped_lines": total_lines - parsed_lines,
        "rsc_requests": rsc_requests,
        "rsc_share_pct": round((100.0 * rsc_requests / parsed_lines), 2) if parsed_lines else 0.0,
        "route_groups": route_groups,
        "cache_miss_groups": cache_miss_groups,
        "top_api_routes": top_api_routes,
    }


def iter_log_files(paths: Iterable[Path]) -> Iterable[str]:
    """Stream lines from plain-text or `.gz` nginx perf log files (read-only)."""
    for path in paths:
        opener = gzip.open if path.suffix == ".gz" else open
        with opener(path, "rt", encoding="utf-8", errors="replace") as handle:  # type: ignore[call-overload]
            for line in handle:
                yield line


def format_markdown(report: Dict[str, object]) -> str:
    out: List[str] = []
    out.append(
        f"Parsed **{report['parsed_lines']}** / {report['total_lines']} lines "
        f"(`_rsc` share: {report['rsc_share_pct']}%)\n"
    )
    out.append("### Route Groups (All Requests, ms)\n")
    out.append("| Route Group | Count | P50 | P95 | P99 | Max | Cache Breakdown |")
    out.append("|---|---:|---:|---:|---:|---:|---|")
    for group, stats in report["route_groups"].items():  # type: ignore[union-attr]
        cc = ", ".join(
            f"{k}:{v}"
            for k, v in sorted(stats["cache_counts"].items(), key=lambda kv: -kv[1])[:4]
        )
        out.append(
            f"| `{group}` | {stats['count']} | {stats['p50_ms']:.1f} | "
            f"{stats['p95_ms']:.1f} | {stats['p99_ms']:.1f} | {stats['max_ms']:.1f} | {cc} |"
        )

    if report["top_api_routes"]:
        out.append("\n### Top API Sub-Routes (ms)\n")
        out.append("| API Route | Count | P50 | P95 | P99 | Max |")
        out.append("|---|---:|---:|---:|---:|---:|")
        for route, stats in report["top_api_routes"].items():  # type: ignore[union-attr]
            out.append(
                f"| `{route}` | {stats['count']} | {stats['p50_ms']:.1f} | "
                f"{stats['p95_ms']:.1f} | {stats['p99_ms']:.1f} | {stats['max_ms']:.1f} |"
            )
    return "\n".join(out)


def main(argv: Optional[List[str]] = None) -> int:
    parser = argparse.ArgumentParser(description="Read-only Verifa nginx perf log profiler")
    parser.add_argument("logs", nargs="*", help="Path(s) to verifa_perf.log* files (supports .gz)")
    parser.add_argument("--json", action="store_true", help="Output JSON instead of Markdown")
    parser.add_argument("--top-api", type=int, default=20, help="Max API sub-routes to display")
    parser.add_argument(
        "--print-readonly-sql",
        action="store_true",
        help="Print read-only PostgreSQL and Redis inspection commands and exit",
    )
    args = parser.parse_args(argv)

    if args.print_readonly_sql:
        print(READONLY_DIAGNOSTICS_GUIDE)
        return 0

    if not args.logs:
        parser.error("Provide at least one verifa_perf.log path (or --print-readonly-sql)")

    paths = [Path(p) for p in args.logs]
    report = profile_lines(iter_log_files(paths), top_api=args.top_api)
    if args.json:
        print(json.dumps(report, indent=2))
    else:
        print(format_markdown(report))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
