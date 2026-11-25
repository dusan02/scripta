# Stream 3 Audit & Implementation Report — ISR Cleanup Automation, Disk Monitoring & Atomic CacheHandler (P1)

**Date:** 2026-11-25  
**Branch:** `stream/3-isr-cleanup-monitoring` (branched from `e73d521` / `release/etapa-1`)  
**VPS Baseline (read-only snapshot):** `/` 97 GiB total, 69 GiB used, 24 GiB avail (75% used); 6 named ISR Docker volumes (`verifa_isr_cache_{firma,en,de,cs,hu,pl}`); cron runs `/root/isr-cache-cleanup.sh` at `04:30` and `16:30` (untouched).

---

## 1. Findings (Ordered by Severity)

### [P0 / Critical] Next.js 14.2.35 `FileSystemCache` Performs Non-Atomic Multi-File Writes & Serves 0-Byte `.html` as HTTP 200
- **Location:** `frontend/node_modules/next/dist/server/lib/incremental-cache/file-system-cache.js` (`set()` L248–L281, `get()` L144–L187).
- **Root Cause:** `FileSystemCache.set()` writes `.html`, `.rsc`, and `.meta` via sequential `this.fs.writeFile()` calls without temp-file + `rename`. On `ENOSPC`, OOM kill, or SIGKILL mid-write, `.html` is truncated/created at `0 bytes`.
- **Impact:** On subsequent `get()`, `FileSystemCache` reads `fileData = await this.fs.readFile(filePath, "utf8")` with **zero empty-body validation** and returns `{ kind: "PAGE", html: "", pageData, ... }`, causing Next.js to serve **empty HTTP 200 responses** indefinitely until manually purged. The same non-atomic write affects `tags-manifest.json` (L100), where a truncated write silently resets tag revalidation state.

### [P1 / High] Unbounded Disk Growth in `FileSystemCache` Under Crawler Traffic
- **Location:** `file-system-cache.js` L31–L56, L238–L282.
- **Root Cause:** `maxMemoryCacheSize` (default 50 MiB) only bounds the in-memory `lru-cache`. Disk writes under `flushToDisk=true` have **no byte cap, no entry count limit, and no LRU eviction**.
- **Impact:** Under crawler traffic across 6 volumes (`/firma/` + 5 localized prefixes), disk usage grows monotonically until `/` hits 100%, triggering `ENOSPC` and cascading 0-byte `.html` corruption.

### [P1 / High] Legacy `scripts/isr-cache-cleanup.sh` Uses Unsafe `docker exec rm -rf`
- **Location:** `scripts/isr-cache-cleanup.sh` L19.
- **Root Cause:** Deletes entire locale directories inside the running container via `docker exec verifa_frontend sh -c 'rm -rf ...'`, with no concurrency lock, no minimum age protection for in-flight writes, no LRU budgeting for `/firma/`, and no Tier 0 0-byte `.html` cleanup.

### [P2 / Medium] Stale `tagsManifest` Across Multi-Worker / Multi-Request Runs in Next.js 14.2.35
- **Location:** `file-system-cache.js` L63–L74, L89.
- **Root Cause:** `loadTagsManifest()` returns early whenever module-level `tagsManifest` is truthy (`if (!this.tagsManifestPath || !this.fs || tagsManifest) return;`), making the refresh call inside `revalidateTag()` a no-op after the first read.

### [P2 / Medium] Legacy `scripts/disk-monitor.sh` Lacks Growth-Rate Telemetry, Tiered Thresholds, Circuit Breaker & Pluggable Alerting
- **Location:** `scripts/disk-monitor.sh`.
- **Root Cause:** Single 10 GB threshold, email-only (`mail` CLI), no JSONL history, no per-volume ISR growth rate, and no automated cleanup trigger or circuit breaker.

---

## 2. Implemented Solutions

### 2.1 Versioned Host-Side ISR Cleanup (`scripts/ops/isr-cache-cleanup.sh`)
- Versions the proven `v2.1` host-side cleanup engine with:
  - `--dry-run` default (zero deletions unless `--execute` is explicitly passed).
  - `flock -n` locking (with automatic Python `fcntl.flock` fallback on platforms without `util-linux` `flock`, enabling full lock testing on macOS while keeping native `flock -n` on Linux VPS).
  - Strict 6-volume allowlist (`verifa_isr_cache_{firma,en,de,cs,hu,pl}/_data`), same-device/no-symlink verification, and fail-closed `SafetyAbort` (`exit 4`).
  - Tier 0 full-stem removal for both `tier0_all_zero` and `tier0_partial_0B_html` (with `MIN_AGE_SEC=1800` protection), followed by Tier 1 locale LRU (2 GiB combined cap) and Tier 2 `/firma/` SK LRU (12 GiB cap).
  - Pre-unlink `lstat(ino, mtime_ns, size)` re-verification and safe unlink order (`.html -> .rsc -> .meta`) with mid-unlink `.html` reappearance guard.
  - Strict exit codes: `0` ok, `2` guard/usage refusal, `3` stem OS error(s), `4` fail-closed safety abort, `5` unexpected internal error.

### 2.2 Disk & ISR Growth Guard (`scripts/ops/isr-disk-guard.sh`)
- Monitors `/` (or `--disk-path`) free space and scans all 6 allowlisted ISR volumes read-only.
- Computes per-volume and total ISR growth rate (`MiB/hr`) against atomic `state.json` and appends structured JSONL metrics (`--metrics-file`).
- Tiered thresholds (configurable via flags):
  - **INFO:** `>= 15 GiB` free and `< 80%` used — logs metrics only.
  - **WARN:** `< 15 GiB` free OR `>= 80%` used — emits `WARN` alert, no cleanup.
  - **AUTO_EXECUTE candidate:** `< 12 GiB` free OR `>= 85%` used — invokes `isr-cache-cleanup.sh` (in `--dry-run` by default; `--execute` only when explicitly passed).
  - **CRITICAL:** `< 6 GiB` free OR `>= 90%` used — emits `CRITICAL` alert + invokes cleanup (if circuit breaker is closed).
- **Circuit Breaker (`exit 2/3/4/5`):** If `isr-cache-cleanup.sh` returns `3`, `4`, or `5` (or `2`), the guard immediately opens the circuit breaker in `state.json`, dispatches a `CRITICAL` alert, and **suppresses all subsequent automated retries (`exit 6`)** until an operator investigates and explicitly runs `--reset-circuit-breaker`.
- **Failure modes handled:** Disk stat unavailable (`exit 10` + CRITICAL alert), volume scan failure (`exit 11` + CRITICAL alert, cleanup never called).
- **Pluggable alerting:** HTTP JSON webhook (`--alert-webhook` / `ISR_ALERT_WEBHOOK_URL`), email (`--alert-email` / `ISR_ALERT_EMAIL`), custom command (`--alert-cmd` / `ISR_ALERT_CMD`), and log, with per-key cooldown (`3600s` WARN / `900s` CRITICAL).

### 2.3 Atomic Filesystem `CacheHandler` Prototype (`frontend/src/lib/cache/atomic-fs-cache-handler.mjs`)
- Zero-dependency ESM module compatible with Next.js `14.2.35` (`dynamicImportEsmDefault`) and `output: 'standalone'`.
- **Multi-file atomic writes (`atomicWriteGroup`):** Writes all sibling temp files (`.meta.tmp`, `.rsc.tmp`, `.html.tmp`) completely before renaming ANY target into place; unlinks all temp files on `ENOSPC`/error so 0-byte `.html` files are impossible and existing healthy cache entries remain intact.
- **Zero-byte guard:** Refuses empty HTML in `set()` and treats any pre-existing legacy 0-byte `.html` on disk as a cache MISS (`null`) in `get()`.
- **Tag & soft-tag invalidation:** Reloads `tags-manifest.json` on `mtimeMs` change (fixing the Next.js 14.2.35 stale manifest bug), writes `tags-manifest.json` atomically, and checks both explicit tags (`x-next-cache-tags`, `ctx.tags`) and implicit `revalidatePath` soft tags (`_N_T_*`).
- **Bounded disk & memory LRU:** O(1) JS `Map` LRU for memory (`maxMemoryCacheSize`) and disk (`maxDiskCacheBytes` / `ISR_CACHE_MAX_DISK_BYTES`, default 14 GiB), unlinking evicted stems `.html`-first.
- **Not wired into `next.config.mjs` yet.** When ready for staging opt-in, add to `frontend/next.config.mjs`:
  ```js
  ...(process.env.USE_ATOMIC_FS_CACHE_HANDLER === 'true'
    ? { cacheHandler: require.resolve('./src/lib/cache/atomic-fs-cache-handler.mjs') }
    : {}),
  ```

---

## 3. Verification & Test Results

- `bash -n scripts/ops/isr-cache-cleanup.sh && bash -n scripts/ops/isr-disk-guard.sh`: **PASS**
- `python3 -m unittest -v scripts/ops/tests/test_isr_cleanup_and_guard.py`: **10/10 PASS (0 failed)**
  - Covers dry-run default, Tier 0 (`all_zero` + `partial_0B_html`), Tier 1/2 LRU + young-stem protection, production `--execute` guard refusals, missing volume `exit 4` safety abort, INFO/WARN/AUTO_EXECUTE/CRITICAL thresholds, growth-rate JSONL metrics, circuit-breaker tripping & retry suppression on `exit 3/4/5` + `--reset-circuit-breaker`, disk unavailable (`exit 10`), and scan failure (`exit 11`).
- `node --test frontend/src/lib/cache/__tests__/atomic-fs-cache-handler.test.mjs`: **6/6 PASS (0 failed)**
  - Covers atomic `PAGE` write/read, simulated `ENOSPC` mid-write leaving existing stems intact and zero 0-byte/`.tmp` leftovers, empty-HTML `set()` rejection & legacy 0-byte `.html` `get()` MISS, `revalidateTag` + `_N_T_*` `revalidatePath` soft-tag invalidation across separate handler instances, bounded disk LRU eviction, and `FETCH`/`ROUTE` kinds.

---

## 4. Criteria Before Enabling Cron `--execute` on VPS

Do **not** enable `--execute` in VPS cron until all of the following are verified:
1. **7-day dry-run observation:** Run `isr-disk-guard.sh --dry-run` every 30 minutes via cron and inspect `/var/log/verifa-isr-disk-metrics.jsonl` for accurate per-volume sizes, growth rates, and zero false-positive `exit 10/11` errors.
2. **Alert channel verification:** Configure `ISR_ALERT_WEBHOOK_URL` (or `ISR_ALERT_EMAIL`) and verify an end-to-end test alert arrives.
3. **One supervised manual `--execute` run:** Execute `scripts/ops/isr-cache-cleanup.sh --execute` manually during low-traffic hours, confirm `EXIT_STATUS: 0`, verify `POST_VOL` sizes and zero HTTP 500/empty-200 regressions on sampled `/firma/` and localized URLs.
4. **Circuit-breaker drill:** Confirm operator runbook covers checking `state.json` and resolving root cause before passing `--reset-circuit-breaker`.
5. **Atomic `CacheHandler` staging validation:** Before enabling `USE_ATOMIC_FS_CACHE_HANDLER=true` in production, validate `next build` + `next start` (standalone) in staging with `revalidatePath` / `revalidateTag` and verify startup disk scan hydration if persistent disk LRU across container restarts is desired.
