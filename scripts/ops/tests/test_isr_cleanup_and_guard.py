import json
import os
import stat
import subprocess
import tempfile
import time
import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]
CLEANUP_SCRIPT = REPO_ROOT / "scripts" / "ops" / "isr-cache-cleanup.sh"
GUARD_SCRIPT = REPO_ROOT / "scripts" / "ops" / "isr-disk-guard.sh"

VOL_MAP = {
    "firma": "verifa_isr_cache_firma",
    "en": "verifa_isr_cache_en",
    "de": "verifa_isr_cache_de",
    "cs": "verifa_isr_cache_cs",
    "hu": "verifa_isr_cache_hu",
    "pl": "verifa_isr_cache_pl",
}


def make_volumes(base: Path):
    dirs = {}
    for k, vname in VOL_MAP.items():
        d = base / vname / "_data"
        d.mkdir(parents=True, exist_ok=True)
        dirs[k] = d
    return dirs


def write_stem(vol_dir: Path, stem: str, html_bytes: int, rsc_bytes: int, meta_bytes: int, age_sec: int):
    ts = time.time() - age_sec
    for ext, sz in (("html", html_bytes), ("rsc", rsc_bytes), ("meta", meta_bytes)):
        if sz is None:
            continue
        p = vol_dir / f"{stem}.{ext}"
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_bytes(b"x" * sz)
        os.utime(p, (ts, ts))


class TestIsrCleanupScript(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.vol_base = self.root / "volumes"
        self.vol_base.mkdir()
        self.vols = make_volumes(self.vol_base)
        self.lock_file = self.root / "cleanup.lock"
        self.log_file = self.root / "cleanup.log"

    def tearDown(self):
        self.tmp.cleanup()

    def _run_cleanup(self, args, test_mode=True):
        env = os.environ.copy()
        if test_mode:
            env["ISR_CLEANUP_TEST_MODE"] = "1"
        else:
            env.pop("ISR_CLEANUP_TEST_MODE", None)
        return subprocess.run(
            ["bash", str(CLEANUP_SCRIPT), *args],
            env=env,
            capture_output=True,
            text=True,
        )

    def test_dry_run_default_deletes_nothing(self):
        write_stem(self.vols["en"], "zero-stem", 0, 0, 0, age_sec=7200)
        write_stem(self.vols["firma"], "partial-zero", 0, 2048, 128, age_sec=7200)
        write_stem(self.vols["de"], "old-heavy", 4096, 4096, 128, age_sec=7200)

        res = self._run_cleanup([
            "--vol-base", str(self.vol_base),
            "--lock-file", str(self.lock_file),
            "--locale-cap-bytes", "100",
        ])
        self.assertEqual(res.returncode, 0, res.stderr)
        self.assertIn("DRY_RUN_COMPLETE: zero files deleted", res.stdout)
        # Verify every file is untouched
        self.assertTrue((self.vols["en"] / "zero-stem.html").exists())
        self.assertTrue((self.vols["firma"] / "partial-zero.html").exists())
        self.assertTrue((self.vols["de"] / "old-heavy.html").exists())

    def test_execute_removes_tier0_and_lru_respects_young_protection(self):
        # Tier 0 all-zero (old -> removed)
        write_stem(self.vols["en"], "zero-old", 0, 0, 0, age_sec=3600)
        # Tier 0 partial 0B html (old -> removed to prevent empty HTTP 200)
        write_stem(self.vols["firma"], "partial-old", 0, 2048, 128, age_sec=3600)
        # Young stem (<1800s -> protected even if over cap)
        write_stem(self.vols["de"], "young-stem", 4096, 4096, 128, age_sec=60)
        # Old locale stems: oldest evicted first until under cap
        write_stem(self.vols["de"], "lru-oldest", 3000, 3000, 100, age_sec=9000)
        write_stem(self.vols["cs"], "lru-newer", 3000, 3000, 100, age_sec=4000)

        res = self._run_cleanup([
            "--execute",
            "--vol-base", str(self.vol_base),
            "--lock-file", str(self.lock_file),
            "--log-file", str(self.log_file),
            "--locale-cap-bytes", "15000",  # young (8320) + lru-newer (6100) = 14420 <= 15000 -> evicts lru-oldest
        ])
        self.assertEqual(res.returncode, 0, res.stdout + res.stderr)
        self.assertIn("EXIT_STATUS: 0", res.stdout)

        self.assertFalse((self.vols["en"] / "zero-old.html").exists())
        self.assertFalse((self.vols["firma"] / "partial-old.html").exists())
        self.assertFalse((self.vols["firma"] / "partial-old.rsc").exists())
        self.assertFalse((self.vols["de"] / "lru-oldest.html").exists())
        self.assertTrue((self.vols["cs"] / "lru-newer.html").exists())
        self.assertTrue((self.vols["de"] / "young-stem.html").exists())

    def test_production_guard_refuses_unsafe_execute_flags(self):
        # --no-lock in --execute is always forbidden
        res1 = self._run_cleanup(["--execute", "--no-lock"], test_mode=True)
        self.assertEqual(res1.returncode, 2)

        # --vol-base override in production --execute (without ISR_CLEANUP_TEST_MODE=1) is forbidden
        res2 = self._run_cleanup([
            "--execute", "--vol-base", str(self.vol_base), "--lock-file", str(self.lock_file)
        ], test_mode=False)
        self.assertEqual(res2.returncode, 2)

        # --min-age-sec < 1800 in production --execute is forbidden
        res3 = self._run_cleanup([
            "--execute", "--min-age-sec", "60", "--lock-file", str(self.lock_file)
        ], test_mode=False)
        self.assertEqual(res3.returncode, 2)

    def test_missing_volume_triggers_exit_4_safety_abort(self):
        # Remove one allowlisted volume -> must fail closed with exit 4
        os.rmdir(self.vols["pl"])
        res = self._run_cleanup([
            "--vol-base", str(self.vol_base),
            "--lock-file", str(self.lock_file),
        ])
        self.assertEqual(res.returncode, 4, res.stdout + res.stderr)
        self.assertIn("FATAL_SAFETY_ABORT", res.stdout)


class TestIsrDiskGuard(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.vol_base = self.root / "volumes"
        self.vol_base.mkdir()
        self.vols = make_volumes(self.vol_base)
        self.metrics_file = self.root / "metrics.jsonl"
        self.state_file = self.root / "state.json"
        self.log_file = self.root / "guard.log"
        self.lock_file = self.root / "guard.lock"
        self.cleanup_log = self.root / "cleanup.log"
        self.cleanup_lock = self.root / "cleanup.lock"
        self.alerts_log = self.root / "alerts.jsonl"

        # Helper alert command that appends JSON alert payloads to alerts.jsonl
        sink = self.root / "alert_sink.py"
        sink.write_text(
            "#!/usr/bin/env python3\n"
            "import sys\n"
            f"with open({str(self.alerts_log)!r}, 'a', encoding='utf-8') as f:\n"
            "    f.write(sys.stdin.read().strip() + '\\n')\n"
        )
        sink.chmod(0o755)
        self.alert_cmd = f"python3 {str(sink)}"

    def tearDown(self):
        self.tmp.cleanup()

    def _run_guard(self, extra_args=None, fake_disk=None):
        env = os.environ.copy()
        env["ISR_GUARD_TEST_MODE"] = "1"
        if fake_disk is not None:
            env["ISR_GUARD_FAKE_DISK_JSON"] = json.dumps(fake_disk)
        else:
            env.pop("ISR_GUARD_FAKE_DISK_JSON", None)

        cmd = [
            "bash", str(GUARD_SCRIPT),
            "--vol-base", str(self.vol_base),
            "--disk-path", str(self.vol_base),
            "--metrics-file", str(self.metrics_file),
            "--state-file", str(self.state_file),
            "--log-file", str(self.log_file),
            "--lock-file", str(self.lock_file),
            "--cleanup-log-file", str(self.cleanup_log),
            "--cleanup-lock-file", str(self.cleanup_lock),
            "--alert-cmd", self.alert_cmd,
            "--alert-cooldown-sec", "0",
            "--crit-cooldown-sec", "0",
        ]
        if extra_args:
            cmd.extend(extra_args)
        return subprocess.run(cmd, env=env, capture_output=True, text=True)

    def _read_alerts(self):
        if not self.alerts_log.exists():
            return []
        return [json.loads(line) for line in self.alerts_log.read_text().splitlines() if line.strip()]

    def _read_metrics(self):
        return [json.loads(line) for line in self.metrics_file.read_text().splitlines() if line.strip()]

    def test_info_threshold_records_metrics_and_growth_rate(self):
        write_stem(self.vols["firma"], "co-1", 4096, 4096, 256, age_sec=3600)
        fake_ok = {"total_bytes": 100 * 1024**3, "avail_bytes": 30 * 1024**3, "used_pct": 70.0}
        res1 = self._run_guard(fake_disk=fake_ok)
        self.assertEqual(res1.returncode, 0, res1.stdout + res1.stderr)

        # Backdate previous sample by 1 hour and add 1 MiB to firma volume
        state = json.loads(self.state_file.read_text())
        state["last_sample"]["ts"] -= 3600
        self.state_file.write_text(json.dumps(state))
        write_stem(self.vols["firma"], "co-2", 1024 * 1024, 0, 0, age_sec=10)

        res2 = self._run_guard(fake_disk=fake_ok)
        self.assertEqual(res2.returncode, 0, res2.stdout + res2.stderr)
        metrics = self._read_metrics()
        self.assertEqual(len(metrics), 2)
        self.assertEqual(metrics[1]["severity"], "INFO")
        self.assertEqual(metrics[1]["action"], "none")
        self.assertGreater(metrics[1]["isr"]["growth_mib_per_hr"], 0.9)
        self.assertEqual(len(self._read_alerts()), 0)

    def test_warn_threshold_emits_warn_alert_without_cleanup(self):
        fake_warn = {"total_bytes": 100 * 1024**3, "avail_bytes": 14 * 1024**3, "used_pct": 82.0}
        res = self._run_guard(fake_disk=fake_warn)
        self.assertEqual(res.returncode, 0, res.stdout + res.stderr)
        metrics = self._read_metrics()
        self.assertEqual(metrics[-1]["severity"], "WARN")
        self.assertEqual(metrics[-1]["action"], "warn_only")
        alerts = self._read_alerts()
        self.assertEqual(len(alerts), 1)
        self.assertEqual(alerts[0]["severity"], "WARN")
        self.assertEqual(alerts[0]["alert_key"], "disk_warn")

    def test_auto_execute_candidate_respects_dry_run_default_and_executes_when_opted_in(self):
        write_stem(self.vols["en"], "zero-target", 0, 0, 0, age_sec=3600)
        fake_exec = {"total_bytes": 100 * 1024**3, "avail_bytes": 10 * 1024**3, "used_pct": 87.0}

        # Default is --dry-run: triggers cleanup in dry-run mode, deletes nothing
        res_dry = self._run_guard(fake_disk=fake_exec)
        self.assertEqual(res_dry.returncode, 0, res_dry.stdout + res_dry.stderr)
        self.assertTrue((self.vols["en"] / "zero-target.html").exists())
        self.assertEqual(self._read_metrics()[-1]["action"], "cleanup_dry-run")

        # Explicit --execute: triggers cleanup in execute mode, deletes zero-target
        res_exec = self._run_guard(extra_args=["--execute"], fake_disk=fake_exec)
        self.assertEqual(res_exec.returncode, 0, res_exec.stdout + res_exec.stderr)
        self.assertFalse((self.vols["en"] / "zero-target.html").exists())
        self.assertEqual(self._read_metrics()[-1]["action"], "cleanup_execute")

    def test_circuit_breaker_trips_on_exit_3_4_5_and_suppresses_subsequent_runs(self):
        fake_crit = {"total_bytes": 100 * 1024**3, "avail_bytes": 4 * 1024**3, "used_pct": 94.0}

        for expected_rc in (3, 4, 5):
            # Create a stub cleanup script that exits with expected_rc and logs invocation count
            inv_file = self.root / f"inv_{expected_rc}.txt"
            stub = self.root / f"stub_rc_{expected_rc}.sh"
            stub.write_text(
                f"#!/bin/bash\n"
                f"echo invoked >> {str(inv_file)!r}\n"
                f"echo 'simulated failure rc={expected_rc}'\n"
                f"exit {expected_rc}\n"
            )
            stub.chmod(0o755)
            # Clear state for clean test per exit code
            if self.state_file.exists():
                self.state_file.unlink()
            if self.alerts_log.exists():
                self.alerts_log.unlink()

            # First run: calls stub -> trips circuit breaker -> returns expected_rc
            r1 = self._run_guard(extra_args=["--execute", "--cleanup-script", str(stub)], fake_disk=fake_crit)
            self.assertEqual(r1.returncode, expected_rc, r1.stdout + r1.stderr)
            self.assertEqual(len(inv_file.read_text().splitlines()), 1)

            state = json.loads(self.state_file.read_text())
            self.assertTrue(state["circuit_breaker"]["open"])
            self.assertEqual(state["circuit_breaker"]["last_rc"], expected_rc)

            # Second run: circuit breaker is OPEN -> MUST NOT invoke stub again, exits 6!
            r2 = self._run_guard(extra_args=["--execute", "--cleanup-script", str(stub)], fake_disk=fake_crit)
            self.assertEqual(r2.returncode, 6, r2.stdout + r2.stderr)
            self.assertEqual(len(inv_file.read_text().splitlines()), 1, "Circuit breaker failed to suppress retry!")

            alerts = self._read_alerts()
            keys = [a["alert_key"] for a in alerts]
            self.assertIn(f"circuit_breaker_tripped_{expected_rc}", keys)
            self.assertIn("circuit_breaker_open", keys)

            # Reset circuit breaker explicitly -> allows execution again
            ok_stub = self.root / "stub_ok.sh"
            ok_stub.write_text("#!/bin/bash\nexit 0\n")
            ok_stub.chmod(0o755)
            r3 = self._run_guard(
                extra_args=["--execute", "--reset-circuit-breaker", "--cleanup-script", str(ok_stub)],
                fake_disk=fake_crit,
            )
            self.assertEqual(r3.returncode, 0, r3.stdout + r3.stderr)
            state_after = json.loads(self.state_file.read_text())
            self.assertFalse(state_after["circuit_breaker"]["open"])

    def test_scan_failure_emits_critical_alert_and_exits_11(self):
        # Remove one allowlisted volume -> scan fails before cleanup is ever invoked
        os.rmdir(self.vols["hu"])
        fake_ok = {"total_bytes": 100 * 1024**3, "avail_bytes": 30 * 1024**3, "used_pct": 70.0}
        res = self._run_guard(fake_disk=fake_ok)
        self.assertEqual(res.returncode, 11, res.stdout + res.stderr)
        alerts = self._read_alerts()
        self.assertEqual(len(alerts), 1)
        self.assertEqual(alerts[0]["alert_key"], "isr_scan_failed")
        self.assertEqual(alerts[0]["severity"], "CRITICAL")

    def test_disk_unavailable_emits_critical_alert_and_exits_10(self):
        res = self._run_guard(extra_args=["--disk-path", str(self.root / "nonexistent-mount")])
        self.assertEqual(res.returncode, 10, res.stdout + res.stderr)
        alerts = self._read_alerts()
        self.assertEqual(len(alerts), 1)
        self.assertEqual(alerts[0]["alert_key"], "disk_stat_unavailable")


if __name__ == "__main__":
    unittest.main()
