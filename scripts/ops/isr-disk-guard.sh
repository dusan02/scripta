#!/bin/bash
# Verifa ISR Disk Guard & Threshold-Triggered Cleanup Orchestrator
#
# Monitors root filesystem free space & per-volume ISR cache growth rate,
# records structured metrics to a lightweight JSONL log, evaluates tiered
# thresholds, triggers isr-cache-cleanup.sh (dry-run by default!), enforces
# a circuit breaker on cleanup exit codes 3/4/5 (stops retrying blindly!),
# and dispatches pluggable alerts (webhook, email, custom command, log).
#
# Recommended cron (DRY-RUN observation first — do NOT add --execute until
# 7+ days of clean metrics & operator sign-off):
#   */30 * * * * /var/www/verifa/scripts/ops/isr-disk-guard.sh --dry-run
#
# Exit codes:
#   0  - OK / WARN / cleanup succeeded (or dry-run completed cleanly)
#   2  - Usage / configuration / guard refusal
#   3  - Triggered cleanup exited 3 (stem OS errors) -> circuit breaker OPENED
#   4  - Triggered cleanup exited 4 (fail-closed safety abort) -> circuit breaker OPENED
#   5  - Triggered cleanup exited 5 (unexpected internal error) -> circuit breaker OPENED
#   6  - Circuit breaker already OPEN (cleanup suppressed until --reset-circuit-breaker)
#   10 - Disk stat unavailable / unreadable
#   11 - ISR volume scan failed (missing volume, permission error, or symlink violation)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

MODE="dry-run"
VOL_BASE="/var/lib/docker/volumes"
DISK_PATH="/"
CLEANUP_SCRIPT="${SCRIPT_DIR}/isr-cache-cleanup.sh"
METRICS_FILE="/var/log/verifa-isr-disk-metrics.jsonl"
STATE_FILE="/var/lib/verifa-isr-guard/state.json"
LOG_FILE="/var/log/verifa-isr-disk-guard.log"
LOCK_FILE="/var/lock/verifa-isr-disk-guard.lock"
USE_LOCK=1

# Tiered thresholds (free GiB OR used %)
WARN_FREE_GIB="15"
WARN_USED_PCT="80"
EXEC_FREE_GIB="12"
EXEC_USED_PCT="85"
CRIT_FREE_GIB="6"
CRIT_USED_PCT="90"

# Cleanup pass-through knobs
MIN_AGE_SEC="1800"
FIRMA_CAP_BYTES=""
LOCALE_CAP_BYTES=""
CLEANUP_LOG_FILE=""
CLEANUP_LOCK_FILE=""

# Alerting knobs (env vars respected as defaults)
ALERT_WEBHOOK="${ISR_ALERT_WEBHOOK_URL:-}"
ALERT_EMAIL="${ISR_ALERT_EMAIL:-}"
ALERT_CMD="${ISR_ALERT_CMD:-}"
ALERT_COOLDOWN_SEC="3600"
CRIT_COOLDOWN_SEC="900"

RESET_CB=0

while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run) MODE="dry-run"; shift ;;
    --execute) MODE="execute"; shift ;;
    --vol-base) VOL_BASE="$2"; shift 2 ;;
    --disk-path) DISK_PATH="$2"; shift 2 ;;
    --cleanup-script) CLEANUP_SCRIPT="$2"; shift 2 ;;
    --metrics-file) METRICS_FILE="$2"; shift 2 ;;
    --state-file) STATE_FILE="$2"; shift 2 ;;
    --log-file) LOG_FILE="$2"; shift 2 ;;
    --lock-file) LOCK_FILE="$2"; shift 2 ;;
    --no-lock) USE_LOCK=0; shift ;;
    --warn-free-gib) WARN_FREE_GIB="$2"; shift 2 ;;
    --warn-used-pct) WARN_USED_PCT="$2"; shift 2 ;;
    --exec-free-gib) EXEC_FREE_GIB="$2"; shift 2 ;;
    --exec-used-pct) EXEC_USED_PCT="$2"; shift 2 ;;
    --crit-free-gib) CRIT_FREE_GIB="$2"; shift 2 ;;
    --crit-used-pct) CRIT_USED_PCT="$2"; shift 2 ;;
    --min-age-sec) MIN_AGE_SEC="$2"; shift 2 ;;
    --firma-cap-bytes) FIRMA_CAP_BYTES="$2"; shift 2 ;;
    --locale-cap-bytes) LOCALE_CAP_BYTES="$2"; shift 2 ;;
    --cleanup-log-file) CLEANUP_LOG_FILE="$2"; shift 2 ;;
    --cleanup-lock-file) CLEANUP_LOCK_FILE="$2"; shift 2 ;;
    --alert-webhook) ALERT_WEBHOOK="$2"; shift 2 ;;
    --alert-email) ALERT_EMAIL="$2"; shift 2 ;;
    --alert-cmd) ALERT_CMD="$2"; shift 2 ;;
    --alert-cooldown-sec) ALERT_COOLDOWN_SEC="$2"; shift 2 ;;
    --crit-cooldown-sec) CRIT_COOLDOWN_SEC="$2"; shift 2 ;;
    --reset-circuit-breaker) RESET_CB=1; shift ;;
    *)
      echo "ERROR: Unknown argument: $1" >&2
      exit 2
      ;;
  esac
done

if [ "$MODE" = "execute" ] && [ "$USE_LOCK" -ne 1 ] && [ "${ISR_GUARD_TEST_MODE:-0}" != "1" ]; then
  echo "ERROR: --no-lock is forbidden in production --execute mode" >&2
  exit 2
fi

if [ "$MODE" = "execute" ] && [ "${ISR_GUARD_TEST_MODE:-0}" != "1" ]; then
  if [ "$VOL_BASE" != "/var/lib/docker/volumes" ]; then
    echo "ERROR: --vol-base override is forbidden in production --execute" >&2
    exit 2
  fi
fi

PYTHON_LOCK_FILE=""
if [ "$USE_LOCK" -eq 1 ]; then
  if command -v flock >/dev/null 2>&1; then
    mkdir -p "$(dirname "$LOCK_FILE")" 2>/dev/null || true
    exec 8>"$LOCK_FILE"
    if ! flock -n 8; then
      echo "[$(date '+%Y-%m-%d %H:%M:%S')] ISR disk guard skipped: another instance holds $LOCK_FILE" >&2
      exit 0
    fi
  else
    PYTHON_LOCK_FILE="$LOCK_FILE"
  fi
fi

export GUARD_MODE="$MODE"
export GUARD_VOL_BASE="$VOL_BASE"
export GUARD_DISK_PATH="$DISK_PATH"
export GUARD_CLEANUP_SCRIPT="$CLEANUP_SCRIPT"
export GUARD_METRICS_FILE="$METRICS_FILE"
export GUARD_STATE_FILE="$STATE_FILE"
export GUARD_LOG_FILE="$LOG_FILE"
export GUARD_PYTHON_LOCK_FILE="$PYTHON_LOCK_FILE"
export GUARD_WARN_FREE_GIB="$WARN_FREE_GIB"
export GUARD_WARN_USED_PCT="$WARN_USED_PCT"
export GUARD_EXEC_FREE_GIB="$EXEC_FREE_GIB"
export GUARD_EXEC_USED_PCT="$EXEC_USED_PCT"
export GUARD_CRIT_FREE_GIB="$CRIT_FREE_GIB"
export GUARD_CRIT_USED_PCT="$CRIT_USED_PCT"
export GUARD_MIN_AGE_SEC="$MIN_AGE_SEC"
export GUARD_FIRMA_CAP_BYTES="$FIRMA_CAP_BYTES"
export GUARD_LOCALE_CAP_BYTES="$LOCALE_CAP_BYTES"
export GUARD_CLEANUP_LOG_FILE="$CLEANUP_LOG_FILE"
export GUARD_CLEANUP_LOCK_FILE="$CLEANUP_LOCK_FILE"
export GUARD_ALERT_WEBHOOK="$ALERT_WEBHOOK"
export GUARD_ALERT_EMAIL="$ALERT_EMAIL"
export GUARD_ALERT_CMD="$ALERT_CMD"
export GUARD_ALERT_COOLDOWN_SEC="$ALERT_COOLDOWN_SEC"
export GUARD_CRIT_COOLDOWN_SEC="$CRIT_COOLDOWN_SEC"
export GUARD_RESET_CB="$RESET_CB"

python3 - <<'PY'
import datetime
import fcntl
import json
import os
import shutil
import socket
import stat
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request

ALLOWED_VOLS = {
    "firma": "verifa_isr_cache_firma",
    "en": "verifa_isr_cache_en",
    "de": "verifa_isr_cache_de",
    "cs": "verifa_isr_cache_cs",
    "hu": "verifa_isr_cache_hu",
    "pl": "verifa_isr_cache_pl",
}

MODE = os.environ["GUARD_MODE"]
VOL_BASE = os.environ["GUARD_VOL_BASE"]
DISK_PATH = os.environ["GUARD_DISK_PATH"]
CLEANUP_SCRIPT = os.environ["GUARD_CLEANUP_SCRIPT"]
METRICS_FILE = os.environ["GUARD_METRICS_FILE"]
STATE_FILE = os.environ["GUARD_STATE_FILE"]
LOG_FILE = os.environ["GUARD_LOG_FILE"]
PYTHON_LOCK_FILE = os.environ["GUARD_PYTHON_LOCK_FILE"]
TEST_MODE = os.environ.get("ISR_GUARD_TEST_MODE", "0") == "1"

try:
    WARN_FREE_GIB = float(os.environ["GUARD_WARN_FREE_GIB"])
    WARN_USED_PCT = float(os.environ["GUARD_WARN_USED_PCT"])
    EXEC_FREE_GIB = float(os.environ["GUARD_EXEC_FREE_GIB"])
    EXEC_USED_PCT = float(os.environ["GUARD_EXEC_USED_PCT"])
    CRIT_FREE_GIB = float(os.environ["GUARD_CRIT_FREE_GIB"])
    CRIT_USED_PCT = float(os.environ["GUARD_CRIT_USED_PCT"])
    ALERT_COOLDOWN_SEC = int(os.environ["GUARD_ALERT_COOLDOWN_SEC"])
    CRIT_COOLDOWN_SEC = int(os.environ["GUARD_CRIT_COOLDOWN_SEC"])
except ValueError as e:
    print(f"ERROR: invalid numeric threshold: {e}", file=sys.stderr)
    sys.exit(2)

# Validate threshold ordering: CRIT <= EXEC <= WARN for free GiB, WARN <= EXEC <= CRIT for used %
if not (CRIT_FREE_GIB <= EXEC_FREE_GIB <= WARN_FREE_GIB):
    print("ERROR: thresholds must satisfy crit_free_gib <= exec_free_gib <= warn_free_gib", file=sys.stderr)
    sys.exit(2)
if not (WARN_USED_PCT <= EXEC_USED_PCT <= CRIT_USED_PCT):
    print("ERROR: thresholds must satisfy warn_used_pct <= exec_used_pct <= crit_used_pct", file=sys.stderr)
    sys.exit(2)

MIN_AGE_SEC = os.environ["GUARD_MIN_AGE_SEC"]
FIRMA_CAP_BYTES = os.environ["GUARD_FIRMA_CAP_BYTES"]
LOCALE_CAP_BYTES = os.environ["GUARD_LOCALE_CAP_BYTES"]
CLEANUP_LOG_FILE = os.environ["GUARD_CLEANUP_LOG_FILE"]
CLEANUP_LOCK_FILE = os.environ["GUARD_CLEANUP_LOCK_FILE"]
ALERT_WEBHOOK = os.environ["GUARD_ALERT_WEBHOOK"]
ALERT_EMAIL = os.environ["GUARD_ALERT_EMAIL"]
ALERT_CMD = os.environ["GUARD_ALERT_CMD"]
RESET_CB = os.environ["GUARD_RESET_CB"] == "1"

HOSTNAME = socket.gethostname()
NOW = time.time()
NOW_ISO = datetime.datetime.fromtimestamp(NOW, tz=datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

_lock_fh = None
if PYTHON_LOCK_FILE:
    lock_dir = os.path.dirname(PYTHON_LOCK_FILE)
    if lock_dir:
        os.makedirs(lock_dir, exist_ok=True)
    _lock_fh = open(PYTHON_LOCK_FILE, "a+")
    try:
        fcntl.flock(_lock_fh.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        print(f"[{NOW_ISO}] ISR disk guard skipped: another instance holds {PYTHON_LOCK_FILE}", file=sys.stderr)
        sys.exit(0)


def log_line(msg):
    line = f"[{NOW_ISO}] {msg}"
    print(line, flush=True)
    if LOG_FILE:
        try:
            d = os.path.dirname(LOG_FILE)
            if d:
                os.makedirs(d, exist_ok=True)
            with open(LOG_FILE, "a", encoding="utf-8") as fh:
                fh.write(line + "\n")
        except OSError:
            pass


def load_state():
    default = {
        "circuit_breaker": {
            "open": False,
            "opened_at": None,
            "last_rc": None,
            "reason": None,
            "output_tail": None,
            "trip_count": 0,
        },
        "last_sample": None,
        "last_alerts": {},
    }
    if not STATE_FILE or not os.path.exists(STATE_FILE):
        return default
    try:
        with open(STATE_FILE, "r", encoding="utf-8") as fh:
            data = json.load(fh)
        if not isinstance(data, dict):
            return default
        for k, v in default.items():
            data.setdefault(k, v)
        return data
    except Exception:
        return default


def save_state(state):
    if not STATE_FILE:
        return
    d = os.path.dirname(STATE_FILE)
    if d:
        os.makedirs(d, exist_ok=True)
    # Atomic state file write (temp file + os.replace)
    fd, tmp_path = tempfile.mkstemp(prefix=".state.", suffix=".tmp", dir=d or ".")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            json.dump(state, fh, indent=2, sort_keys=True)
            fh.flush()
            os.fsync(fh.fileno())
        os.replace(tmp_path, STATE_FILE)
    except Exception:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass
        raise


def append_metric(record):
    if not METRICS_FILE:
        return
    try:
        d = os.path.dirname(METRICS_FILE)
        if d:
            os.makedirs(d, exist_ok=True)
        with open(METRICS_FILE, "a", encoding="utf-8") as fh:
            fh.write(json.dumps(record, sort_keys=True) + "\n")
    except OSError as e:
        log_line(f"WARN: failed to append metrics to {METRICS_FILE}: {e}")


def dispatch_alert(state, alert_key, severity, subject, body, details):
    """Pluggable alerting: webhook (HTTP POST JSON), email (mail CLI), custom command, and log."""
    last_alerts = state.setdefault("last_alerts", {})
    cooldown = CRIT_COOLDOWN_SEC if severity == "CRITICAL" else ALERT_COOLDOWN_SEC
    last_ts = last_alerts.get(alert_key, 0)
    if cooldown > 0 and (NOW - last_ts) < cooldown:
        log_line(f"ALERT_SUPPRESSED_COOLDOWN key={alert_key} severity={severity} remaining={int(cooldown - (NOW - last_ts))}s")
        return False

    payload = {
        "timestamp": NOW_ISO,
        "host": HOSTNAME,
        "severity": severity,
        "alert_key": alert_key,
        "subject": subject,
        "body": body,
        "details": details,
    }
    log_line(f"ALERT[{severity}] key={alert_key}: {subject}")

    delivered = []
    if ALERT_WEBHOOK:
        try:
            req = urllib.request.Request(
                ALERT_WEBHOOK,
                data=json.dumps(payload).encode("utf-8"),
                headers={"Content-Type": "application/json", "User-Agent": "verifa-isr-disk-guard/1.0"},
                method="POST",
            )
            with urllib.request.urlopen(req, timeout=10) as resp:
                delivered.append(f"webhook:{resp.status}")
        except Exception as e:
            log_line(f"WARN: webhook alert delivery failed: {e}")

    if ALERT_EMAIL:
        mail_bin = shutil.which("mail") or shutil.which("mailx")
        if mail_bin:
            try:
                subprocess.run(
                    [mail_bin, "-s", subject, ALERT_EMAIL],
                    input=(body + "\n").encode("utf-8"),
                    timeout=15,
                    check=False,
                )
                delivered.append("email")
            except Exception as e:
                log_line(f"WARN: email alert delivery failed: {e}")
        else:
            log_line("WARN: ALERT_EMAIL set but neither 'mail' nor 'mailx' found in PATH")

    if ALERT_CMD:
        try:
            env = os.environ.copy()
            env["ISR_ALERT_SEVERITY"] = severity
            env["ISR_ALERT_SUBJECT"] = subject
            env["ISR_ALERT_KEY"] = alert_key
            res = subprocess.run(
                ALERT_CMD,
                shell=True,
                input=json.dumps(payload).encode("utf-8"),
                env=env,
                timeout=15,
                check=False,
            )
            delivered.append(f"cmd:rc={res.returncode}")
        except Exception as e:
            log_line(f"WARN: custom alert command failed: {e}")

    last_alerts[alert_key] = NOW
    log_line(f"ALERT_DISPATCHED key={alert_key} channels={delivered or ['log-only']}")
    return True


def read_disk_stats():
    if TEST_MODE and os.environ.get("ISR_GUARD_FAKE_DISK_JSON"):
        fake = json.loads(os.environ["ISR_GUARD_FAKE_DISK_JSON"])
        total = int(fake["total_bytes"])
        avail = int(fake["avail_bytes"])
        used = int(fake.get("used_bytes", max(0, total - avail)))
        used_pct = float(fake.get("used_pct", (used / (used + avail) * 100.0) if (used + avail) > 0 else 0.0))
        return total, used, avail, used_pct

    st = os.statvfs(DISK_PATH)
    total = st.f_frsize * st.f_blocks
    avail = st.f_frsize * st.f_bavail
    used = total - (st.f_frsize * st.f_bfree)
    used_pct = (used / (used + avail) * 100.0) if (used + avail) > 0 else 0.0
    return total, used, avail, used_pct


def scan_isr_volumes():
    volumes = {}
    total_bytes = 0
    total_files = 0
    zero_html_files = 0

    real_base = os.path.realpath(VOL_BASE)
    if not os.path.isdir(real_base):
        raise RuntimeError(f"VOL_BASE does not exist or is not a directory: {VOL_BASE}")

    for k, vol_name in ALLOWED_VOLS.items():
        raw_root = os.path.join(VOL_BASE, vol_name, "_data")
        if os.path.islink(raw_root) or os.path.islink(os.path.dirname(raw_root)) or not os.path.isdir(raw_root):
            raise RuntimeError(f"Invalid or missing volume directory: {raw_root}")
        real_root = os.path.realpath(raw_root)
        expected = os.path.join(real_base, vol_name, "_data")
        if real_root != expected:
            raise RuntimeError(f"Resolved volume path mismatch: {real_root} != {expected}")

        v_bytes = 0
        v_files = 0
        v_zero_html = 0
        stack = [real_root]
        while stack:
            cur = stack.pop()
            with os.scandir(cur) as it:
                for entry in it:
                    if entry.is_symlink():
                        continue
                    if entry.is_dir(follow_symlinks=False):
                        stack.append(entry.path)
                    elif entry.is_file(follow_symlinks=False):
                        try:
                            st = entry.stat(follow_symlinks=False)
                        except FileNotFoundError:
                            continue
                        if not stat.S_ISREG(st.st_mode):
                            continue
                        v_bytes += st.st_size
                        v_files += 1
                        if entry.name.endswith(".html") and st.st_size == 0:
                            v_zero_html += 1

        volumes[k] = {"bytes": v_bytes, "files": v_files, "zero_byte_html": v_zero_html}
        total_bytes += v_bytes
        total_files += v_files
        zero_html_files += v_zero_html

    return volumes, total_bytes, total_files, zero_html_files


state = load_state()

if RESET_CB:
    state["circuit_breaker"] = {
        "open": False,
        "opened_at": None,
        "last_rc": None,
        "reason": None,
        "output_tail": None,
        "trip_count": state.get("circuit_breaker", {}).get("trip_count", 0),
    }
    save_state(state)
    log_line("CIRCUIT_BREAKER_RESET: cleared by operator (--reset-circuit-breaker)")

# Step 1: Read disk stats
try:
    total_b, used_b, avail_b, used_pct = read_disk_stats()
except Exception as e:
    err_msg = f"Disk stat failed on {DISK_PATH}: {e}"
    log_line(f"ERROR: {err_msg}")
    dispatch_alert(
        state,
        "disk_stat_unavailable",
        "CRITICAL",
        f"[CRITICAL] {HOSTNAME}: Disk monitor failed on {DISK_PATH}",
        err_msg,
        {"disk_path": DISK_PATH, "error": str(e)},
    )
    append_metric({
        "timestamp": NOW_ISO,
        "host": HOSTNAME,
        "mode": MODE,
        "severity": "CRITICAL",
        "action": "error_disk_unavailable",
        "error": str(e),
    })
    save_state(state)
    sys.exit(10)

avail_gib = avail_b / (1024 ** 3)
used_gib = used_b / (1024 ** 3)
total_gib = total_b / (1024 ** 3)

# Step 2: Scan ISR volumes (fail closed on missing/corrupt volume layout)
try:
    volumes, isr_total_bytes, isr_total_files, isr_zero_html = scan_isr_volumes()
except Exception as e:
    err_msg = f"ISR volume scan failed under {VOL_BASE}: {e}"
    log_line(f"ERROR: {err_msg}")
    dispatch_alert(
        state,
        "isr_scan_failed",
        "CRITICAL",
        f"[CRITICAL] {HOSTNAME}: ISR volume scan failed",
        err_msg,
        {"vol_base": VOL_BASE, "error": str(e), "avail_gib": round(avail_gib, 2), "used_pct": round(used_pct, 1)},
    )
    append_metric({
        "timestamp": NOW_ISO,
        "host": HOSTNAME,
        "mode": MODE,
        "disk": {"total_gib": round(total_gib, 2), "used_gib": round(used_gib, 2), "avail_gib": round(avail_gib, 2), "used_pct": round(used_pct, 2)},
        "severity": "CRITICAL",
        "action": "error_scan_failed",
        "error": str(e),
    })
    save_state(state)
    sys.exit(11)

# Step 3: Compute growth rate (MiB/hour) vs previous sample
growth_mib_per_hr = None
per_vol_growth_mib_hr = {}
prev = state.get("last_sample")
if isinstance(prev, dict) and isinstance(prev.get("ts"), (int, float)):
    dt_hours = (NOW - prev["ts"]) / 3600.0
    if dt_hours > 0.0001:
        delta_bytes = isr_total_bytes - prev.get("isr_total_bytes", isr_total_bytes)
        growth_mib_per_hr = round((delta_bytes / (1024 ** 2)) / dt_hours, 2)
        prev_vols = prev.get("volumes", {})
        for k, v in volumes.items():
            pv_bytes = prev_vols.get(k, {}).get("bytes")
            if pv_bytes is not None:
                per_vol_growth_mib_hr[k] = round(((v["bytes"] - pv_bytes) / (1024 ** 2)) / dt_hours, 2)

state["last_sample"] = {
    "ts": NOW,
    "isr_total_bytes": isr_total_bytes,
    "avail_bytes": avail_b,
    "volumes": volumes,
}

# Step 4: Evaluate thresholds
if avail_gib < CRIT_FREE_GIB or used_pct >= CRIT_USED_PCT:
    severity = "CRITICAL"
    should_trigger_cleanup = True
elif avail_gib < EXEC_FREE_GIB or used_pct >= EXEC_USED_PCT:
    severity = "AUTO_EXECUTE"
    should_trigger_cleanup = True
elif avail_gib < WARN_FREE_GIB or used_pct >= WARN_USED_PCT:
    severity = "WARN"
    should_trigger_cleanup = False
else:
    severity = "INFO"
    should_trigger_cleanup = False

log_line(
    f"CHECK: mode={MODE} severity={severity} avail={avail_gib:.2f}GiB used={used_pct:.1f}% "
    f"isr_total={isr_total_bytes/1024**3:.2f}GiB isr_files={isr_total_files} zero_html={isr_zero_html} "
    f"growth_mib_hr={growth_mib_per_hr}"
)

cb = state.get("circuit_breaker", {})
cb_open = bool(cb.get("open", False))
action = "none"
cleanup_rc = None
exit_code = 0

if severity == "WARN":
    action = "warn_only"
    dispatch_alert(
        state,
        "disk_warn",
        "WARN",
        f"[WARN] {HOSTNAME}: Disk low ({avail_gib:.2f} GiB free, {used_pct:.1f}% used)",
        f"Free space dropped below {WARN_FREE_GIB} GiB or {WARN_USED_PCT}% used.\n"
        f"ISR total: {isr_total_bytes/1024**3:.2f} GiB ({isr_total_files} files, {isr_zero_html} 0B .html).\n"
        f"Growth rate: {growth_mib_per_hr} MiB/hr.",
        {"avail_gib": round(avail_gib, 2), "used_pct": round(used_pct, 2), "isr_total_bytes": isr_total_bytes, "growth_mib_per_hr": growth_mib_per_hr},
    )

elif should_trigger_cleanup:
    if severity == "CRITICAL":
        dispatch_alert(
            state,
            "disk_critical",
            "CRITICAL",
            f"[CRITICAL] {HOSTNAME}: Disk critical ({avail_gib:.2f} GiB free, {used_pct:.1f}% used)",
            f"Free space below {CRIT_FREE_GIB} GiB or {CRIT_USED_PCT}% used!\n"
            f"Mode: {MODE}. Circuit breaker open: {cb_open}.\n"
            f"ISR total: {isr_total_bytes/1024**3:.2f} GiB ({isr_total_files} files, {isr_zero_html} 0B .html).",
            {"avail_gib": round(avail_gib, 2), "used_pct": round(used_pct, 2), "isr_total_bytes": isr_total_bytes, "cb_open": cb_open},
        )

    if cb_open:
        action = "suppressed_circuit_breaker_open"
        exit_code = 6
        log_line(
            f"CIRCUIT_BREAKER_OPEN: suppressing cleanup (last_rc={cb.get('last_rc')}, "
            f"opened_at={cb.get('opened_at')}, reason={cb.get('reason')}). "
            f"Investigate and run with --reset-circuit-breaker after fixing."
        )
        dispatch_alert(
            state,
            "circuit_breaker_open",
            "CRITICAL",
            f"[CRITICAL] {HOSTNAME}: ISR cleanup circuit-breaker OPEN (last exit={cb.get('last_rc')})",
            f"Automated ISR cleanup is halted because a previous run exited {cb.get('last_rc')} ({cb.get('reason')}).\n"
            f"Disk: {avail_gib:.2f} GiB free ({used_pct:.1f}% used).\n"
            f"Manual investigation required; pass --reset-circuit-breaker once resolved.",
            {"circuit_breaker": cb, "avail_gib": round(avail_gib, 2), "used_pct": round(used_pct, 2)},
        )
    else:
        cmd = [CLEANUP_SCRIPT, f"--{MODE}", "--vol-base", VOL_BASE, "--min-age-sec", MIN_AGE_SEC]
        if FIRMA_CAP_BYTES:
            cmd.extend(["--firma-cap-bytes", FIRMA_CAP_BYTES])
        if LOCALE_CAP_BYTES:
            cmd.extend(["--locale-cap-bytes", LOCALE_CAP_BYTES])
        if CLEANUP_LOG_FILE:
            cmd.extend(["--log-file", CLEANUP_LOG_FILE])
        if CLEANUP_LOCK_FILE:
            cmd.extend(["--lock-file", CLEANUP_LOCK_FILE])

        env = os.environ.copy()
        if TEST_MODE:
            env["ISR_CLEANUP_TEST_MODE"] = "1"

        action = f"cleanup_{MODE}"
        log_line(f"TRIGGER_CLEANUP: running {' '.join(cmd)}")
        proc = subprocess.run(cmd, env=env, capture_output=True, text=True)
        cleanup_rc = proc.returncode
        combined_out = (proc.stdout or "") + ("\n" + proc.stderr if proc.stderr else "")
        out_tail = "\n".join(combined_out.strip().splitlines()[-15:])

        if cleanup_rc == 0:
            log_line(f"CLEANUP_OK: mode={MODE} rc=0")
        elif cleanup_rc in (2, 3, 4, 5):
            reason_map = {
                2: "usage_or_guard_refusal",
                3: "stem_os_errors",
                4: "fail_closed_safety_abort",
                5: "unexpected_internal_error",
            }
            reason = reason_map.get(cleanup_rc, f"rc_{cleanup_rc}")
            state["circuit_breaker"] = {
                "open": True,
                "opened_at": NOW_ISO,
                "last_rc": cleanup_rc,
                "reason": reason,
                "output_tail": out_tail,
                "trip_count": int(cb.get("trip_count", 0)) + 1,
            }
            cb_open = True
            exit_code = cleanup_rc
            log_line(f"CIRCUIT_BREAKER_TRIPPED: cleanup exited {cleanup_rc} ({reason}) -> halting further retries")
            dispatch_alert(
                state,
                f"circuit_breaker_tripped_{cleanup_rc}",
                "CRITICAL",
                f"[CRITICAL] {HOSTNAME}: ISR cleanup FAILED (exit={cleanup_rc}: {reason}) — circuit breaker TRIPPED",
                f"isr-cache-cleanup.sh exited with code {cleanup_rc} ({reason}).\n"
                f"Circuit breaker is now OPEN to prevent blind retries.\n\nLast output:\n{out_tail}",
                {"cleanup_rc": cleanup_rc, "reason": reason, "avail_gib": round(avail_gib, 2), "used_pct": round(used_pct, 2)},
            )
        else:
            # Unknown non-zero exit code also trips circuit breaker safely
            state["circuit_breaker"] = {
                "open": True,
                "opened_at": NOW_ISO,
                "last_rc": cleanup_rc,
                "reason": f"unknown_exit_{cleanup_rc}",
                "output_tail": out_tail,
                "trip_count": int(cb.get("trip_count", 0)) + 1,
            }
            cb_open = True
            exit_code = 5
            log_line(f"CIRCUIT_BREAKER_TRIPPED: cleanup exited unexpected code {cleanup_rc}")
            dispatch_alert(
                state,
                "circuit_breaker_tripped_unknown",
                "CRITICAL",
                f"[CRITICAL] {HOSTNAME}: ISR cleanup FAILED (unexpected exit={cleanup_rc}) — circuit breaker TRIPPED",
                f"Last output:\n{out_tail}",
                {"cleanup_rc": cleanup_rc},
            )

metric_record = {
    "timestamp": NOW_ISO,
    "host": HOSTNAME,
    "mode": MODE,
    "disk": {
        "path": DISK_PATH,
        "total_gib": round(total_gib, 2),
        "used_gib": round(used_gib, 2),
        "avail_gib": round(avail_gib, 2),
        "used_pct": round(used_pct, 2),
    },
    "isr": {
        "total_bytes": isr_total_bytes,
        "total_gib": round(isr_total_bytes / (1024 ** 3), 4),
        "total_files": isr_total_files,
        "zero_byte_html": isr_zero_html,
        "growth_mib_per_hr": growth_mib_per_hr,
        "per_vol_growth_mib_hr": per_vol_growth_mib_hr,
        "volumes": volumes,
    },
    "severity": severity,
    "action": action,
    "cleanup_rc": cleanup_rc,
    "circuit_breaker_open": cb_open,
}

append_metric(metric_record)
save_state(state)
sys.exit(exit_code)
PY
