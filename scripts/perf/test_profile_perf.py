#!/usr/bin/env python3
"""Unit tests for scripts/perf/profile_perf.py."""

import gzip
import json
import sys
import tempfile
import unittest
from pathlib import Path

# Allow running directly via `python3 -m unittest scripts/perf/test_profile_perf.py`
sys.path.insert(0, str(Path(__file__).resolve().parent))

import profile_perf as pp  # noqa: E402


SAMPLE_LINES = [
    '74.7.227.18 - [25/Nov/2026:00:00:24 +0100] "GET /firma/50928821-mstr-s-r-o?_rsc=1b9iq HTTP/2.0" 200 27794 "https://verifa.sk/" "GPTBot/1.4" rt=0.112 cache=HIT',
    '213.180.203.88 - [25/Nov/2026:00:00:25 +0100] "GET /de/firma/46948473-inventa-s-r-o HTTP/2.0" 200 27680 "-" "YandexBot/3.0" rt=2.110 cache=MISS',
    '95.108.213.242 - [25/Nov/2026:00:00:25 +0100] "GET /en/firma/46430580-kbl-tech-s-r-o HTTP/2.0" 200 25848 "-" "YandexBot/3.0" rt=1.202 cache=MISS',
    '10.0.0.1 - [25/Nov/2026:00:01:00 +0100] "GET /api/companies/50928821/live-check HTTP/2.0" 200 512 "-" "Mozilla/5.0" rt=0.085 cache=-',
    '10.0.0.2 - [25/Nov/2026:00:01:05 +0100] "GET /api/auth/session HTTP/2.0" 200 128 "-" "Mozilla/5.0" rt=0.011 cache=-',
    '40.77.167.52 - [25/Nov/2026:00:20:12 +0100] "GET /sitemap/35.xml HTTP/2.0" 499 0 "-" "bingbot/2.0" rt=49.789 cache=-',
    '10.0.0.3 - [25/Nov/2026:00:21:00 +0100] "GET /firmy?odvetvie=G HTTP/2.0" 200 15000 "-" "Mozilla/5.0" rt=0.345 cache=-',
    '10.0.0.4 - [25/Nov/2026:00:21:05 +0100] "GET /screener?kraj=SK010 HTTP/2.0" 200 19000 "-" "Mozilla/5.0" rt=0.129 cache=-',
    'malformed line without rt or cache fields',
]


class TestProfilePerf(unittest.TestCase):
    def test_parse_perf_line_valid_and_malformed(self):
        entry = pp.parse_perf_line(SAMPLE_LINES[0])
        self.assertIsNotNone(entry)
        assert entry is not None
        self.assertEqual(entry.method, "GET")
        self.assertEqual(entry.status, 200)
        self.assertAlmostEqual(entry.rt_ms, 112.0, places=2)
        self.assertEqual(entry.cache_status, "HIT")
        self.assertTrue(entry.is_rsc)
        self.assertEqual(entry.route_group, "/firma/[ico-slug]")
        self.assertIsNone(entry.api_subroute)

        self.assertIsNone(pp.parse_perf_line(SAMPLE_LINES[-1]))

    def test_route_group_classification(self):
        cases = {
            "/firma/50928821-test-s-r-o": "/firma/[ico-slug]",
            "/de/firma/50928821-test-s-r-o": "/{lang}/firma/...",
            "/en/firma/12345678-foo?_rsc=abc": "/{lang}/firma/...",
            "/api/companies/50928821/live-check": "/api/...",
            "/firmy": "/firmy",
            "/firmy/stavebnictvo/bratislavsky-kraj": "/firmy",
            "/en/firmy": "/firmy",
            "/screener?kraj=SK010": "/screener",
            "/sitemap/35.xml": "/sitemap*.xml",
            "/sitemap.xml": "/sitemap*.xml",
            "/": "/ (home)",
            "/de": "/ (home)",
            "/_next/static/chunks/app.js": "/_next/...",
            "/pricing": "other",
        }
        for path, expected in cases.items():
            self.assertEqual(pp.classify_route_group(path), expected, f"path={path}")

    def test_normalize_api_subroute(self):
        self.assertEqual(
            pp.normalize_api_subroute("/api/companies/50928821/live-check?foo=1"),
            "/api/companies/:id/live-check",
        )
        self.assertEqual(
            pp.normalize_api_subroute("/api/reports/cm1234567890abcdefghijklm/download"),
            "/api/reports/:id/download",
        )
        self.assertEqual(
            pp.normalize_api_subroute("/api/auth/session"),
            "/api/auth/session",
        )

    def test_percentile_math(self):
        self.assertEqual(pp.percentile([], 50), 0.0)
        self.assertEqual(pp.percentile([42.0], 99), 42.0)
        vals = [10.0, 20.0, 30.0, 40.0, 50.0]
        self.assertAlmostEqual(pp.percentile(vals, 50), 30.0)
        self.assertAlmostEqual(pp.percentile(vals, 95), 48.0)
        self.assertAlmostEqual(pp.percentile(vals, 99), 49.6)

    def test_profile_lines_aggregation_and_499_bucket(self):
        report = pp.profile_lines(SAMPLE_LINES)
        self.assertEqual(report["total_lines"], 9)
        self.assertEqual(report["parsed_lines"], 8)
        self.assertEqual(report["skipped_lines"], 1)
        self.assertEqual(report["rsc_requests"], 1)
        self.assertEqual(report["rsc_share_pct"], 12.5)

        groups = report["route_groups"]
        self.assertEqual(groups["/{lang}/firma/..."]["count"], 2)
        self.assertAlmostEqual(groups["/{lang}/firma/..."]["p50_ms"], 1656.0, places=1)
        self.assertEqual(groups["/sitemap*.xml"]["status_counts"], {"499": 1})
        self.assertIn("/api/companies/:id/live-check", report["top_api_routes"])
        self.assertIn("/api/auth/session", report["top_api_routes"])

        md = pp.format_markdown(report)
        self.assertIn("| `/{lang}/firma/...` |", md)
        self.assertIn("| `/api/companies/:id/live-check` |", md)

    def test_iter_log_files_plain_and_gzip(self):
        with tempfile.TemporaryDirectory() as tmp:
            plain_path = Path(tmp) / "verifa_perf.log"
            gz_path = Path(tmp) / "verifa_perf.log.2.gz"
            plain_path.write_text("\n".join(SAMPLE_LINES[:4]) + "\n", encoding="utf-8")
            with gzip.open(gz_path, "wt", encoding="utf-8") as fh:
                fh.write("\n".join(SAMPLE_LINES[4:]) + "\n")

            report = pp.profile_lines(pp.iter_log_files([plain_path, gz_path]))
            self.assertEqual(report["parsed_lines"], 8)
            # Ensure JSON serializable
            encoded = json.dumps(report)
            self.assertIn("route_groups", encoded)


if __name__ == "__main__":
    unittest.main()
