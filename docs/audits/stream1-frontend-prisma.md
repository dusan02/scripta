# Stream 1 – Frontend & Prisma Stability Audit (P1)

**Date:** 2026-11-25  
**Base Commit:** `e73d521` (`release/etapa-1`)  
**Target Branch:** `stream/1-frontend-prisma-stability`  
**VPS Mode:** Strictly read-only inspection (`89.185.250.213`, 2 vCPU, 7,941 MiB RAM, 4,095 MiB swap)

---

## 1. Live VPS Findings (Ordered by Severity)

### [CRITICAL] 153 Zombie `node` Processes Consuming 84% of `pids_limit` (`168 / 200`)
- **Observed (`verifa_frontend`):**
  - `pids.current = 168`, `pids.max = 200` (`pids.events: max 0` so far, ~32 PIDs from `EAGAIN` failure).
  - `cgroup.procs = 1`, `cgroup.threads = 15` (`6 node`, `5 next-server`, `2 tokio-runtime-w`, `1 opentelemetry-e`, `1 futures-timer`).
  - **153 zombie (`Z`) `node` processes** with `PPid = 109033` (container PID 1 `next-server`), accumulated in ~4.4 hours since container start (`2026-11-25T08:44:33Z`).
  - `HostConfig.Init = null` (no tini reaper).
  - Live healthcheck uses `CMD-SHELL` (`interval: 15s`, `timeout: 5s`) without `AbortSignal.timeout` or explicit `process.exit(0)`. When `/api/health` stalls >5s behind Prisma pool exhaustion, Docker kills `/bin/sh`, orphaning `node -e` to PID 1 (`next-server`), which never calls `waitpid()`.

#### Proof: Zombies Come Exclusively from Docker's `CMD-SHELL` Healthcheck (Not App Code)
1. **Zero runtime child-process spawning in `frontend/src/`:**
   - Full codebase grep across `frontend/` for `child_process`, `worker_threads`, `spawn`, `execFile`, `execSync`, `exec(`, and `fork(` returns **0 matches** in `frontend/src/`, `frontend/next.config*`, tests, and runtime bundles.
   - The sole match in the entire `frontend/` tree is an offline CLI script (`frontend/scripts/audit-data-consistency.ts:10`, `execSync`), which is never imported by Next.js and not copied into the production runner image (`frontend/Dockerfile`).
   - Prisma runs in-process via the N-API library engine (`PRISMA_CLIENT_ENGINE_TYPE=library`, observed as 2 `tokio-runtime-w` threads inside `next-server`), not as a child process.
2. **Exact 20–21s zombie cadence matching Docker healthcheck `Interval (15s) + Timeout (5s)`:**
   - Consecutive `Z node` children of container PID 1 (`PPid = 109033`) have exact 20–21s start-time spacing:
     `09:54:51` → `09:55:12` (+21s) → `09:55:32` (+20s) → `09:55:53` (+21s) → `09:56:13` (+20s) → `09:56:33` (+20s) → `09:56:54` (+21s).
   - Between two read-only snapshots 10 minutes apart (`14:08` → `14:18 CET`), `Z node` count grew from **153 → 163** (+10 zombies, pushing `verifa_frontend` to `178 / 200` PIDs).
   - **Mechanism:** Docker `CMD-SHELL` runs `/bin/sh -c "node -e \"fetch('http://localhost:3000/api/health')...\""`. When `/api/health` stalls >5s behind Prisma pool exhaustion, Docker terminates `/bin/sh` at the 5s timeout, reparenting the orphaned `node -e` child to PID 1 (`next-server`). When `node -e` subsequently exits, `next-server` never calls `waitpid()`, permanently leaking 1 `Z node` PID into the cgroup.

### [CRITICAL] Prisma `P2024` Connection Pool Exhaustion (9,981 Errors in 72h)
- **Observed:**
  - **9,981** `P2024` (`Timed out fetching a new connection from the connection pool... Current connection pool timeout: 10, connection limit: 30`) errors in `verifa_frontend` logs over the last 72h.
  - Live `DATABASE_URL` only specifies `?connection_limit=30` — no `pool_timeout`, no `connect_timeout`, and no `application_name`.
  - Live PostgreSQL (`verifa_postgres`): `max_connections = 100`, `idle_in_transaction_session_timeout = 0`, `statement_timeout = 0`. Snapshot: `38` total connections (`18` active, `14` idle, `5` background, `1` psql), with `<empty>` `application_name` on all app sessions.
  - Active query snapshot showed 15+ concurrent `SELECT "public"."Company"...` queries running 0.36s–2.56s each on a 2-vCPU host — 30 concurrent connections from `verifa_frontend` oversubscribes CPU/IO and causes queuing collapse past the 10s default `pool_timeout`.
  - `frontend/src/lib/prisma.ts` only cached `globalForPrisma.prisma` when `NODE_ENV !== "production"` and had no datasource pool normalization/guardrails.

### [HIGH] Unbounded & Uncoalesced `/api/health` DB Probes
- `frontend/src/app/api/health/route.ts` on `e73d521` awaited `prisma.$queryRaw\`SELECT 1\`` with **no timeout** and no concurrency coalescing. Under pool exhaustion, healthchecks hung for up to 10s, triggering the Docker 5s timeout and feeding the zombie leak.

### [MEDIUM] Unpinned Node.js Threadpool & Missing Image-Level Reaper
- `UV_THREADPOOL_SIZE` was unset in `docker-compose.yml` and `frontend/Dockerfile`.
- `frontend/Dockerfile` ran `CMD ["node", "server.js"]` directly as PID 1 without `tini`.

---

## 2. Implemented Fixes

1. **PID 1 Zombie Reaping & Shell-less Bounded Healthcheck (`docker-compose.yml`, `frontend/Dockerfile`):**
   - Enabled `init: true` on `verifa_frontend` in `docker-compose.yml` (consistent with `90bccb5` P0.3).
   - Installed `tini` (`--no-install-recommends`) and added `ENTRYPOINT ["/usr/bin/tini", "--"]` in `frontend/Dockerfile` for defense-in-depth across all Docker runtimes.
   - Switched `verifa_frontend` healthcheck to exec-form `["CMD", "node", "-e", ...]` (no `/bin/sh` wrapper), `127.0.0.1`, `AbortSignal.timeout(3000)`, explicit `process.exit(r.ok?0:1)`, and `interval: 30s`.
   - Kept `pids_limit: 200` and `mem_limit: 1536m` unchanged (no RAM inflation on the 7.8GB shared VPS; live threads are ~15 once zombies are reaped).
   - Pinned `UV_THREADPOOL_SIZE=4` in both `docker-compose.yml` and `frontend/Dockerfile`.
2. **Prisma Pool Guardrails & Singleton Hardening (`frontend/src/lib/prisma-pool.ts`, `frontend/src/lib/prisma.ts`, `docker-compose.yml`):**
   - Default `DATABASE_URL` pool params tuned for 2-vCPU / `max_connections=100`: `connection_limit=${PRISMA_CONNECTION_LIMIT:-20}`, `pool_timeout=${PRISMA_POOL_TIMEOUT:-15}`, `connect_timeout=${PRISMA_CONNECT_TIMEOUT:-5}`, `application_name=verifa_frontend`.
   - Added `buildPrismaDatasourceUrl()` with bounded clamping (`connection_limit` 2–50, `pool_timeout` 2–60s, `connect_timeout` 1–30s), `PRISMA_*` env overrides, and `redactDatabaseUrl()`.
   - Anchored `globalForPrisma.prisma` unconditionally (including `NODE_ENV=production`) to guarantee a single connection pool per Node.js process.
3. **Resilient Single-Flight `/api/health` (`frontend/src/lib/db-health.ts`, `frontend/src/app/api/health/route.ts`):**
   - Bounded 2.5s timeout with `clearTimeout` cleanup and late-rejection suppression (zero unhandled rejections).
   - Single-flight coalescing + short TTL cache (2s ok / 1s error) so concurrent probes share 1 DB query.

---

## 3. Measurable Post-Deploy Success Criteria
- `verifa_frontend` zombie count (`ps -eo ppid,stat | grep Z`) stays at **0**; `pids.current` stays **< 40 / 200** indefinitely.
- `pg_stat_activity` clearly identifies frontend sessions as `application_name = 'verifa_frontend'` with `<= 20` connections.
- `P2024` error rate drops sharply (combined with P0.3 partial indexes & Stream 2/4 crawler/query optimizations).
- `/api/health` responds in `<= 2.5s` even during DB stalls and never causes `unhandledPromiseRejection`.
