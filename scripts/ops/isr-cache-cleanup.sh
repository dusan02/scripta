#!/bin/bash
# Host-side ISR cache cleanup for Verifa (Next.js 14.2 FileSystemCache) — v2.1
# Cron (when enabled, AFTER operator verification): 30 4,16 * * * /root/isr-cache-cleanup.sh --execute
#
# Safety guarantees:
# - Default mode is --dry-run (zero deletions unless --execute is explicitly passed).
# - flock -n prevents overlapping cron executions (with Python fcntl.flock fallback if flock CLI is absent).
# - Operates strictly on the 6 allowlisted verifa_isr_cache_* Docker volume _data dirs.
# - Never invokes docker exec, rm -rf, image prune, or volume removal.
# - Tier 0 covers two distinct categories (both enforcing MIN_AGE_SEC=1800 and full-stem removal):
#     * tier0_all_zero: total stem size == 0 bytes (single 0B .html, pairs, and triplets)
#     * tier0_partial_zero_html: .html size == 0 bytes AND total stem size > 0 (prevents empty HTTP 200)
# - Uses newest_mtime (max mtime across a stem's files) for both LRU ordering and min-age check.
# - Protects active/recent ISR writes via (non-atomic best-effort without modifying Next.js):
#     1) mandatory minimum stem age (--min-age-sec, default 1800s = 30 min),
#     2) pre-unlink lstat(inode, mtime_ns, size) re-verification across .html/.rsc/.meta,
#     3) safe unlink order (.html -> .rsc -> .meta) with re-check before .rsc/.meta so a
#        recreated .html or modified sibling aborts unlinking .rsc/.meta (Case E mitigation).
# - Verifies post-cleanup volume sizes, file counts, and root filesystem free space.
# - --execute never reads any dry-run TSV/manifest: candidates come from a fresh live scan in the same run.
# - Production --execute refuses: --no-lock, --vol-base override, --min-age-sec < 1800.
# - Per-stem outcome: full | partial (stopped after >=1 unlink, reason logged) | skipped | error.
# - Exit codes: 0 ok (benign concurrency skips/partials reported) | 2 usage/guard refusal |
#               3 completed but >=1 stem hit an OS error | 4 fail-closed safety abort (path/device/allowlist) |
#               5 unexpected internal error. Codes 4/5 stop the run immediately; remaining stems untouched.

set -euo pipefail

MODE="dry-run"
VOL_BASE="/var/lib/docker/volumes"
LOG_FILE="/var/log/docker-cleanup.log"
LOCK_FILE="/var/lock/verifa-isr-cache-cleanup.lock"
USE_LOCK=1
MIN_AGE_SEC=1800
FIRMA_CAP_BYTES=12884901888   # 12 GiB for SK canonical /firma/
LOCALE_CAP_BYTES=2147483648   # 2 GiB combined for en/de/cs/hu/pl
REPORT_TSV=""

while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run)
      MODE="dry-run"
      shift
      ;;
    --execute)
      MODE="execute"
      shift
      ;;
    --vol-base)
      VOL_BASE="$2"
      shift 2
      ;;
    --log-file)
      LOG_FILE="$2"
      shift 2
      ;;
    --lock-file)
      LOCK_FILE="$2"
      shift 2
      ;;
    --no-lock)
      USE_LOCK=0
      shift
      ;;
    --min-age-sec)
      MIN_AGE_SEC="$2"
      shift 2
      ;;
    --firma-cap-bytes)
      FIRMA_CAP_BYTES="$2"
      shift 2
      ;;
    --locale-cap-bytes)
      LOCALE_CAP_BYTES="$2"
      shift 2
      ;;
    --report-tsv)
      REPORT_TSV="$2"
      shift 2
      ;;
    *)
      echo "ERROR: Unknown argument: $1" >&2
      exit 2
      ;;
  esac
done

if [ "$MODE" = "execute" ] && [ "$USE_LOCK" -ne 1 ]; then
  echo "ERROR: --no-lock is forbidden in --execute mode" >&2
  exit 2
fi

for n in "$MIN_AGE_SEC" "$FIRMA_CAP_BYTES" "$LOCALE_CAP_BYTES"; do
  case "$n" in
    ''|*[!0-9]*) echo "ERROR: numeric arguments must be non-negative integers (got '$n')" >&2; exit 2 ;;
  esac
done

if [ "$MODE" = "execute" ] && [ "${ISR_CLEANUP_TEST_MODE:-0}" != "1" ]; then
  if [ "$VOL_BASE" != "/var/lib/docker/volumes" ]; then
    echo "ERROR: --vol-base override is forbidden in production --execute (set ISR_CLEANUP_TEST_MODE=1 only for tests)" >&2
    exit 2
  fi
  if [ "$MIN_AGE_SEC" -lt 1800 ]; then
    echo "ERROR: --min-age-sec below 1800 is forbidden in production --execute" >&2
    exit 2
  fi
fi

PYTHON_LOCK_FILE=""
if [ "$USE_LOCK" -eq 1 ]; then
  if command -v flock >/dev/null 2>&1; then
    mkdir -p "$(dirname "$LOCK_FILE")" 2>/dev/null || true
    exec 9>"$LOCK_FILE"
    if ! flock -n 9; then
      MSG="[$(date '+%Y-%m-%d %H:%M:%S')] ISR cleanup skipped: another instance holds $LOCK_FILE"
      if [ "$MODE" = "execute" ]; then
        echo "$MSG" >> "$LOG_FILE"
      else
        echo "$MSG" >&2
      fi
      exit 0
    fi
  else
    # Portable fallback (e.g. macOS local dev/tests where util-linux flock is absent)
    PYTHON_LOCK_FILE="$LOCK_FILE"
  fi
fi

run_engine() {
  python3 - "$MODE" "$VOL_BASE" "$MIN_AGE_SEC" "$FIRMA_CAP_BYTES" "$LOCALE_CAP_BYTES" "$REPORT_TSV" "$PYTHON_LOCK_FILE" "$LOG_FILE" <<'PY'
import base64
import collections
import datetime
import errno
import fcntl
import gzip
import io
import os
import re
import stat
import sys
import time

class SafetyAbort(Exception):
    """Fail-closed: any path/device/allowlist violation stops the entire run (exit 4)."""

def _fatal_hook(exc_type, exc, tb):
    import traceback
    if issubclass(exc_type, SafetyAbort):
        print(f"FATAL_SAFETY_ABORT: {exc} -> run stopped immediately, remaining candidates untouched", flush=True)
        sys.stdout.flush(); sys.stderr.flush()
        os._exit(4)
    traceback.print_exception(exc_type, exc, tb)
    print("FATAL_UNEXPECTED_ERROR -> run stopped, remaining candidates untouched", flush=True)
    sys.stdout.flush(); sys.stderr.flush()
    os._exit(5)

sys.excepthook = _fatal_hook

MODE = sys.argv[1]
VOL_BASE = sys.argv[2]
MIN_AGE_SEC = int(sys.argv[3])
FIRMA_CAP = int(sys.argv[4])
LOCALE_CAP = int(sys.argv[5])
REPORT_TSV = sys.argv[6]
PYTHON_LOCK_FILE = sys.argv[7]
LOG_FILE = sys.argv[8]

assert MODE in ("dry-run", "execute"), f"Invalid mode: {MODE}"

_lock_fh = None
if PYTHON_LOCK_FILE:
    lock_dir = os.path.dirname(PYTHON_LOCK_FILE)
    if lock_dir:
        os.makedirs(lock_dir, exist_ok=True)
    _lock_fh = open(PYTHON_LOCK_FILE, "a+")
    try:
        fcntl.flock(_lock_fh.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        msg = f"[{datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] ISR cleanup skipped: another instance holds {PYTHON_LOCK_FILE}"
        if MODE == "execute":
            print(msg, flush=True)
        else:
            print(msg, file=sys.stderr, flush=True)
        sys.exit(0)

ALLOWED_VOLS = {
    "firma": "verifa_isr_cache_firma",
    "en": "verifa_isr_cache_en",
    "de": "verifa_isr_cache_de",
    "cs": "verifa_isr_cache_cs",
    "hu": "verifa_isr_cache_hu",
    "pl": "verifa_isr_cache_pl",
}
LOCALE_KEYS = ["en", "de", "cs", "hu", "pl"]
EXTS = ("html", "rsc", "meta")
UNLINK_ORDER = {"html": 0, "rsc": 1, "meta": 2}
SAFE_FILE_RE = re.compile(r"^[A-Za-z0-9._%-]+\.(html|rsc|meta)$")

NOW = time.time()

def ts_iso(epoch):
    return datetime.datetime.fromtimestamp(epoch).strftime("%Y-%m-%dT%H:%M:%S")

def disk_stats(path):
    st = os.statvfs(path)
    total = st.f_frsize * st.f_blocks
    avail = st.f_frsize * st.f_bavail
    used = total - (st.f_frsize * st.f_bfree)
    pct = (used / (used + avail) * 100.0) if (used + avail) > 0 else 0.0
    return total, used, avail, pct

def resolve_verified_root(vol_key):
    vol_name = ALLOWED_VOLS[vol_key]
    raw_root = os.path.join(VOL_BASE, vol_name, "_data")
    if os.path.islink(raw_root) or os.path.islink(os.path.dirname(raw_root)) or not os.path.isdir(raw_root):
        raise SafetyAbort(f"Invalid or missing volume directory: {raw_root}")
    real_base = os.path.realpath(VOL_BASE)
    real_root = os.path.realpath(raw_root)
    expected = os.path.join(real_base, vol_name, "_data")
    if real_root != expected or real_root == "/":
        raise SafetyAbort(f"Unexpected resolved volume path: {real_root} != {expected}")
    # A volume _data dir must live on the same filesystem as VOL_BASE (no bind mounts / foreign mounts)
    if os.stat(real_root).st_dev != os.stat(real_base).st_dev or os.path.ismount(real_root):
        raise SafetyAbort(f"Volume directory is a separate mount: {real_root}")
    return real_root

def scan_volume(vol_key, real_root):
    # Keyed by base path without extension so nested dirs (e.g. de/_data/firma/<slug>) stay distinct and exact
    stems = {}
    total_files = 0
    total_bytes = 0
    ignored_non_cache = 0
    root_dev = os.stat(real_root).st_dev
    stack = [real_root]

    while stack:
        cur = stack.pop()
        with os.scandir(cur) as it:
            for entry in it:
                if entry.is_symlink():
                    ignored_non_cache += 1
                    continue
                if entry.is_dir(follow_symlinks=False):
                    real_sub = os.path.realpath(entry.path)
                    if (os.path.commonpath([real_sub, real_root]) == real_root
                            and entry.stat(follow_symlinks=False).st_dev == root_dev):
                        stack.append(real_sub)
                    else:
                        ignored_non_cache += 1
                    continue
                if not entry.is_file(follow_symlinks=False):
                    ignored_non_cache += 1
                    continue
                if not SAFE_FILE_RE.match(entry.name):
                    ignored_non_cache += 1
                    continue

                st = entry.stat(follow_symlinks=False)
                if not stat.S_ISREG(st.st_mode) or st.st_dev != root_dev:
                    ignored_non_cache += 1
                    continue

                base_path, ext = entry.path.rsplit(".", 1)
                stem_name = os.path.basename(base_path)
                rec = stems.get(base_path)
                if rec is None:
                    rec = {
                        "vol": vol_key,
                        "stem": stem_name,
                        "base_path": base_path,
                        "real_root": real_root,
                        "root_dev": root_dev,
                        "files": {},  # ext -> (path, size, mtime, mtime_ns, ino)
                        "size": 0,
                        "newest_mtime": 0.0,
                        "oldest_mtime": float("inf"),
                    }
                    stems[base_path] = rec

                rec["files"][ext] = (entry.path, st.st_size, st.st_mtime, st.st_mtime_ns, st.st_ino)
                rec["size"] += st.st_size
                if st.st_mtime > rec["newest_mtime"]:
                    rec["newest_mtime"] = st.st_mtime
                if st.st_mtime < rec["oldest_mtime"]:
                    rec["oldest_mtime"] = st.st_mtime
                total_files += 1
                total_bytes += st.st_size

    return stems, total_files, total_bytes, ignored_non_cache

def _stop(removed_files, freed_bytes, kind_if_untouched, reason):
    # Uniform result: (outcome, removed_files, freed_bytes, reason)
    # outcome: "full" | "skipped" (nothing removed) | "partial" (stopped after >=1 unlink) | "error"
    if kind_if_untouched == "error":
        return ("error", removed_files, freed_bytes, reason)
    return ("partial" if removed_files > 0 else "skipped", removed_files, freed_bytes, reason)

def verify_and_unlink_stem(rec):
    real_root = rec["real_root"]
    root_dev = rec["root_dev"]
    base_path = rec["base_path"]
    snap_files = rec["files"]
    now_check = time.time()

    # Fail-closed path checks (boundary violations abort the WHOLE run, exit 4)
    real_parent = os.path.realpath(os.path.dirname(base_path))
    if os.path.commonpath([real_parent, real_root]) != real_root:
        raise SafetyAbort(f"Security boundary violation: {base_path} outside {real_root}")

    # Step 1: Re-stat .html/.rsc/.meta against the in-run scan snapshot right before unlinking.
    verified_paths = []
    for ext in EXTS:
        cand = f"{base_path}.{ext}"
        if not SAFE_FILE_RE.match(os.path.basename(cand)):
            raise SafetyAbort(f"Extension boundary violation: {cand}")
        try:
            lst = os.lstat(cand)
        except FileNotFoundError:
            if ext in snap_files:
                return _stop(0, 0, "skip", "concurrent_missing")
            continue
        except OSError as e:
            return _stop(0, 0, "error", f"lstat_error:{errno.errorcode.get(e.errno, e.errno)}")

        if not stat.S_ISREG(lst.st_mode):
            return _stop(0, 0, "skip", "non_regular_file")
        if lst.st_dev != root_dev:
            raise SafetyAbort(f"Device boundary violation: {cand} st_dev={lst.st_dev} != {root_dev}")
        if ext not in snap_files:
            return _stop(0, 0, "skip", "concurrent_new_sibling")

        _, orig_sz, _, orig_mtime_ns, orig_ino = snap_files[ext]
        if lst.st_ino != orig_ino or lst.st_mtime_ns != orig_mtime_ns or lst.st_size != orig_sz:
            return _stop(0, 0, "skip", "concurrent_modified")
        if (now_check - lst.st_mtime) < MIN_AGE_SEC:
            return _stop(0, 0, "skip", "became_young")

        verified_paths.append((UNLINK_ORDER[ext], ext, cand, lst.st_size))

    # Step 2: Unlink in order .html -> .rsc -> .meta.
    # Since .html is always first, ANY .html present before unlinking .rsc/.meta is a NEW file
    # written by Next.js set() -> stop and leave .rsc/.meta for Next.js to overwrite (Case E mitigation).
    verified_paths.sort(key=lambda x: x[0])
    removed_files = 0
    freed_bytes = 0
    html_cand = f"{base_path}.html"
    for _, ext, cand, sz in verified_paths:
        if ext in ("rsc", "meta"):
            if os.path.lexists(html_cand):
                return _stop(removed_files, freed_bytes, "skip", "concurrent_html_reappeared")
            try:
                cur_lst = os.lstat(cand)
            except FileNotFoundError:
                return _stop(removed_files, freed_bytes, "skip", "concurrent_missing_mid_unlink")
            except OSError as e:
                return _stop(removed_files, freed_bytes, "error", f"lstat_error_mid_unlink:{errno.errorcode.get(e.errno, e.errno)}")
            _, orig_sz, _, orig_mtime_ns, orig_ino = snap_files[ext]
            if cur_lst.st_ino != orig_ino or cur_lst.st_mtime_ns != orig_mtime_ns or cur_lst.st_size != orig_sz:
                return _stop(removed_files, freed_bytes, "skip", "concurrent_modified_mid_unlink")
        try:
            os.unlink(cand)
            removed_files += 1
            freed_bytes += sz
        except FileNotFoundError:
            return _stop(removed_files, freed_bytes, "skip", "concurrent_missing_at_unlink")
        except OSError as e:
            return _stop(removed_files, freed_bytes, "error", f"unlink_error:{errno.errorcode.get(e.errno, e.errno)}")
    return ("full", removed_files, freed_bytes, "unlinked")

print(f"[{datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] Starting ISR cache {MODE.upper()} "
      f"(min_age={MIN_AGE_SEC}s, firma_cap={FIRMA_CAP/1024**3:.2f}GiB, locale_cap={LOCALE_CAP/1024**3:.2f}GiB)")

root_check_path = VOL_BASE if os.path.exists(VOL_BASE) else "/"
_, used_b, avail_b, pct_b = disk_stats(root_check_path)
print(f"DISK_BEFORE: avail={avail_b/1024**3:.2f}GiB use={pct_b:.1f}%")

roots = {k: resolve_verified_root(k) for k in ALLOWED_VOLS}
scans = {}
for k, rpath in roots.items():
    stems, fcnt, bcnt, ign = scan_volume(k, rpath)
    scans[k] = (stems, fcnt, bcnt, ign)
    zero_all = sum(1 for s in stems.values() if s["size"] == 0)
    partial_zero_html = sum(1 for s in stems.values() if s["size"] > 0 and "html" in s["files"] and s["files"]["html"][1] == 0)
    print(f"PRE_VOL[{k:5s}]: stems={len(stems):7,d} files={fcnt:7,d} size={bcnt/1024**3:6.2f}GiB "
          f"tier0_all_zero={zero_all:6,d} tier0_partial_0B_html={partial_zero_html:5,d} ignored_other={ign:,d}")

candidates = []  # (tier, vol, rec, reason)
stats = collections.Counter()

def plan_group(vol_keys, cap_bytes, tier_lru_num, group_label):
    healthy_total = 0
    lru_eligible = []

    for vk in vol_keys:
        stems = scans[vk][0]
        for rec in stems.values():
            age = NOW - rec["newest_mtime"]
            is_all_zero = (rec["size"] == 0)
            is_partial_zero_html = (
                rec["size"] > 0
                and "html" in rec["files"]
                and rec["files"]["html"][1] == 0
            )
            if is_all_zero:
                if age < MIN_AGE_SEC:
                    stats[f"{group_label}_tier0_all_zero_skipped_young"] += 1
                else:
                    candidates.append((0, vk, rec, "tier0_all_zero_bytes"))
                    stats[f"{group_label}_tier0_all_zero_stems"] += 1
                    stats[f"{group_label}_tier0_all_zero_files"] += len(rec["files"])
            elif is_partial_zero_html:
                if age < MIN_AGE_SEC:
                    stats[f"{group_label}_tier0_partial_skipped_young"] += 1
                    stats[f"{group_label}_tier0_partial_skipped_young_bytes"] += rec["size"]
                    healthy_total += rec["size"]
                else:
                    candidates.append((0, vk, rec, "tier0_partial_0B_html"))
                    stats[f"{group_label}_tier0_partial_stems"] += 1
                    stats[f"{group_label}_tier0_partial_files"] += len(rec["files"])
                    stats[f"{group_label}_tier0_partial_bytes"] += rec["size"]
            else:
                healthy_total += rec["size"]
                if age < MIN_AGE_SEC:
                    stats[f"{group_label}_lru_protected_young_stems"] += 1
                    stats[f"{group_label}_lru_protected_young_bytes"] += rec["size"]
                else:
                    lru_eligible.append(rec)

    # Sort LRU strictly by newest_mtime ascending (least-recently-updated stem first)
    lru_eligible.sort(key=lambda r: (r["newest_mtime"], r["stem"]))
    projected_rem = healthy_total
    for rec in lru_eligible:
        if projected_rem <= cap_bytes:
            break
        candidates.append((tier_lru_num, rec["vol"], rec, f"tier{tier_lru_num}_lru_newest_mtime"))
        projected_rem -= rec["size"]
        stats[f"{group_label}_lru_evict_stems"] += 1
        stats[f"{group_label}_lru_evict_files"] += len(rec["files"])
        stats[f"{group_label}_lru_evict_bytes"] += rec["size"]

    stats[f"{group_label}_pre_healthy_bytes"] = healthy_total
    stats[f"{group_label}_post_projected_bytes"] = projected_rem

plan_group(LOCALE_KEYS, LOCALE_CAP, 1, "LOCALES")
plan_group(["firma"], FIRMA_CAP, 2, "FIRMA_SK")

if REPORT_TSV:
    def write_rows(out):
        out.write("tier\tvol\tstem\tfiles_count\tsize_bytes\tnewest_mtime_iso\toldest_mtime_iso\texts_sizes\treason\n")
        for tier, vk, rec, reason in candidates:
            es = ",".join(f"{ext}:{rec['files'][ext][1]}" for ext in sorted(rec["files"]))
            out.write(f"{tier}\t{vk}\t{rec['stem']}\t{len(rec['files'])}\t{rec['size']}\t"
                      f"{ts_iso(rec['newest_mtime'])}\t{ts_iso(rec['oldest_mtime'])}\t{es}\t{reason}\n")

    if REPORT_TSV == "@stdout_gz_b64":
        buf = io.BytesIO()
        with gzip.GzipFile(fileobj=buf, mode="wb", mtime=0) as gz:
            with io.TextIOWrapper(gz, encoding="utf-8") as tw:
                write_rows(tw)
        b64 = base64.b64encode(buf.getvalue()).decode("ascii")
        print(f"REPORT_GZ_B64_BEGIN len={len(b64)}")
        print(b64)
        print("REPORT_GZ_B64_END")
    else:
        opener = gzip.open if REPORT_TSV.endswith(".gz") else open
        with opener(REPORT_TSV, "wt", encoding="utf-8") as out:
            write_rows(out)
        print(f"REPORT_WRITTEN: {REPORT_TSV} (rows={len(candidates):,d})")

total_cand_files = sum(len(r["files"]) for _, _, r, _ in candidates)
total_cand_bytes = sum(r["size"] for _, _, r, _ in candidates)
t0_all_zero_stems = stats["LOCALES_tier0_all_zero_stems"] + stats["FIRMA_SK_tier0_all_zero_stems"]
t0_all_zero_files = stats["LOCALES_tier0_all_zero_files"] + stats["FIRMA_SK_tier0_all_zero_files"]
t0_partial_stems = stats["LOCALES_tier0_partial_stems"] + stats["FIRMA_SK_tier0_partial_stems"]
t0_partial_files = stats["LOCALES_tier0_partial_files"] + stats["FIRMA_SK_tier0_partial_files"]
t0_partial_bytes = stats["LOCALES_tier0_partial_bytes"] + stats["FIRMA_SK_tier0_partial_bytes"]
print(f"PLAN_SUMMARY: mode={MODE} candidate_stems={len(candidates):,d} candidate_files={total_cand_files:,d} "
      f"reclaimable={total_cand_bytes/1024**3:.4f}GiB ("
      f"tier0_all_zero={t0_all_zero_stems:,d} stems/{t0_all_zero_files:,d} files/0.0000GiB, "
      f"tier0_partial_0B_html={t0_partial_stems:,d} stems/{t0_partial_files:,d} files/{t0_partial_bytes/1024**3:.4f}GiB, "
      f"tier1_locale_lru={stats['LOCALES_lru_evict_stems']:,d} stems/{stats['LOCALES_lru_evict_files']:,d} files/{stats['LOCALES_lru_evict_bytes']/1024**3:.4f}GiB, "
      f"tier2_firma_lru={stats['FIRMA_SK_lru_evict_stems']:,d} stems/{stats['FIRMA_SK_lru_evict_files']:,d} files/{stats['FIRMA_SK_lru_evict_bytes']/1024**3:.4f}GiB)")
print(f"YOUNG_PROTECTED (<{MIN_AGE_SEC}s): "
      f"tier0_all_zero_young={stats['LOCALES_tier0_all_zero_skipped_young']+stats['FIRMA_SK_tier0_all_zero_skipped_young']:,d}, "
      f"tier0_partial_young={stats['LOCALES_tier0_partial_skipped_young']+stats['FIRMA_SK_tier0_partial_skipped_young']:,d}, "
      f"locales_young={stats['LOCALES_lru_protected_young_stems']:,d} ({stats['LOCALES_lru_protected_young_bytes']/1024**3:.2f}GiB), "
      f"firma_young={stats['FIRMA_SK_lru_protected_young_stems']:,d} ({stats['FIRMA_SK_lru_protected_young_bytes']/1024**3:.2f}GiB)")

cand_set = {(r["vol"], r["base_path"]) for _, _, r, _ in candidates}
for k in ALLOWED_VOLS:
    stems = scans[k][0]
    rem_stems = [r for bp, r in stems.items() if (k, bp) not in cand_set]
    rem_bytes = sum(r["size"] for r in rem_stems)
    rem_files = sum(len(r["files"]) for r in rem_stems)
    rem_zero = sum(1 for r in rem_stems if r["size"] == 0)
    rem_partial = sum(1 for r in rem_stems if r["size"] > 0 and "html" in r["files"] and r["files"]["html"][1] == 0)
    print(f"PROJECTED_POST_VOL[{k:5s}]: stems={len(rem_stems):7,d} files={rem_files:7,d} size={rem_bytes/1024**3:6.2f}GiB "
          f"rem_all_zero={rem_zero} rem_partial_0B_html={rem_partial}")

if MODE == "execute":
    # Candidates come ONLY from the live scan performed in this same process a few seconds/minutes ago.
    # No dry-run TSV/manifest is ever read. Every stem is re-verified (lstat ino/mtime_ns/size/age) right before unlink.
    outcome_counts = collections.Counter()
    outcome_files = collections.Counter()
    outcome_bytes = collections.Counter()
    reasons = collections.Counter()
    problem_samples = []  # (outcome, reason, vol, stem, removed_files)
    for tier, vk, rec, cand_reason in candidates:
        outcome, rf, fb, why = verify_and_unlink_stem(rec)
        outcome_counts[outcome] += 1
        outcome_files[outcome] += rf
        outcome_bytes[outcome] += fb
        if outcome != "full":
            reasons[f"{outcome}:{why}"] += 1
            if outcome in ("partial", "error") and len(problem_samples) < 200:
                problem_samples.append((outcome, why, vk, rec["stem"], rf))

    total_unlinked_files = sum(outcome_files.values())
    total_freed = sum(outcome_bytes.values())
    print(f"EXECUTE_RESULT: candidates={len(candidates):,d} full={outcome_counts['full']:,d} "
          f"partial={outcome_counts['partial']:,d} skipped={outcome_counts['skipped']:,d} error={outcome_counts['error']:,d} "
          f"unlinked_files={total_unlinked_files:,d} freed_logical={total_freed/1024**3:.4f}GiB")
    print(f"EXECUTE_NON_FULL_REASONS: {dict(sorted(reasons.items()))}")
    for outcome, why, vk, stem_name, rf in problem_samples:
        print(f"EXECUTE_PROBLEM_STEM: outcome={outcome} reason={why} vol={vk} stem={stem_name} files_removed_before_stop={rf}")

    # Mandatory post-cleanup verification across all 6 volumes + disk (fresh scan of real state)
    post_locale_bytes = 0
    for k, rpath in roots.items():
        pstems, pfcnt, pbcnt, _ = scan_volume(k, rpath)
        pzero = sum(1 for s in pstems.values() if s["size"] == 0)
        ppartial = sum(1 for s in pstems.values() if s["size"] > 0 and "html" in s["files"] and s["files"]["html"][1] == 0)
        print(f"POST_VOL[{k:5s}]: stems={len(pstems):7,d} files={pfcnt:7,d} size={pbcnt/1024**3:6.2f}GiB "
              f"all_zero={pzero:6,d} partial_0B_html={ppartial:5,d}")
        if k == "firma" and pbcnt > FIRMA_CAP * 1.05:
            print(f"WARNING: firma post-cleanup size {pbcnt/1024**3:.2f}GiB exceeds cap (young protected cache may exceed cap)")
        elif k != "firma":
            post_locale_bytes += pbcnt
    if post_locale_bytes > LOCALE_CAP * 1.05:
        print(f"WARNING: locales post-cleanup size {post_locale_bytes/1024**3:.2f}GiB exceeds cap")

    _, used_a, avail_a, pct_a = disk_stats(root_check_path)
    print(f"DISK_AFTER: avail={avail_a/1024**3:.2f}GiB use={pct_a:.1f}% (delta_avail={(avail_a-avail_b)/1024**3:+.2f}GiB)")

    # Exit policy: 0 = done (benign concurrency skips/partials allowed, all reported);
    #              3 = done but >=1 stem hit an OS error (EACCES/EBUSY/EROFS/...), run continued past it.
    if outcome_counts["error"] > 0:
        print(f"EXIT_STATUS: 3 (completed with {outcome_counts['error']:,d} stem errors)")
        sys.stdout.flush()
        sys.exit(3)
    print("EXIT_STATUS: 0")
else:
    print(f"DRY_RUN_COMPLETE: zero files deleted. Projected kept: "
          f"locales={stats['LOCALES_post_projected_bytes']/1024**3:.2f}GiB, "
          f"firma={stats['FIRMA_SK_post_projected_bytes']/1024**3:.2f}GiB")
PY
}

if [ "$MODE" = "execute" ]; then
  mkdir -p "$(dirname "$LOG_FILE")" 2>/dev/null || true
  rc=0
  run_engine 2>&1 | tee -a "$LOG_FILE" || rc=$?
  echo "--- isr-cache-cleanup exit=$rc" | tee -a "$LOG_FILE"
  exit "$rc"
else
  run_engine
fi
