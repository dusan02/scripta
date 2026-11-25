# Stream 5 Audit: CI/CD, Monitoring & Regression Testing (P2)

**Date:** 2026-11-25  
**Branch:** `stream/5-cicd-monitoring-tests` (branched from `e73d521`, `release/etapa-1`)  
**VPS Access Mode:** Strictly Read-Only (`root@89.185.250.213`)

---

## 1. Executive Summary & Findings (Ordered by Severity)

| Severity | Finding | Evidence (Read-Only Audit) | Remediation / Owner |
| --- | --- | --- | --- |
| **P1 (High)** | **`verifa_frontend` PIDs at 84.5% of container limit (`169 / 200`)** — dangerously close to fork/thread exhaustion (`EAGAIN`) under traffic spikes. | `docker stats` & `docker inspect` on VPS: `verifa_frontend` PIDs=`169`, `HostConfig.PidsLimit=200`. | Implemented real-time PIDs threshold alerting in `scripts/ops/system-monitor.sh` (`WARN >= 70%`, `CRIT >= 85%`). Increasing `pids_limit` or investigating thread/worker leaks belongs to infra/frontend streams (`docker-compose.yml` is outside Stream 5 file ownership). |
| **P1 (High)** | **No active host/container/DB/Redis monitoring or alerting scheduled on VPS.** `scripts/disk-monitor.sh` exists in repo but is NOT installed in root crontab; host swap is at 52.5% (`2.1Gi / 4.0Gi`) and root disk at `75%` (`69G / 97G`). | `crontab -l` on VPS shows only app crons and cleanup scripts; zero monitoring jobs. | Implemented `scripts/ops/system-monitor.sh` with CPU, RAM, disk, frontend PIDs, PostgreSQL connections, and Redis memory/PING alerts + JSON output. Recommended cron schedule provided below. |
| **P1 (High)** | **Existing CI (`.github/workflows/build.yml`) has critical quality-gate gaps:** runs only on `master` (not `release/**`), ignores ESLint failures (`continue-on-error: true`), uses `postgres:15` instead of production `postgres:16`, has no concurrency cancellation, and does not test ops/CI scripts. | `.github/workflows/build.yml` lines 4–7, 34, 42. | Added `.github/workflows/ci-quality-gate.yml` covering `master` + `release/**` + `workflow_dispatch`, strict ESLint, `postgres:16-alpine`, shell/ops script tests, and a single `quality-gate-summary` branch-protection gate. |
| **P2 (Medium)** | **`verifa_worker` has no Docker `HEALTHCHECK`** in `docker-compose.yml` (shows `Up 4 hours` without `(healthy)`), whereas `verifa_arq_worker`, `verifa_frontend`, `verifa_postgres`, `verifa_redis`, and `verifa_browserless` all have healthchecks. | `docker ps` on VPS; `docker-compose.yml` lines 171–214. Worker *does* expose `http://localhost:8000/health` (`{"ok":true,...}`). | `scripts/ops/post-deploy-healthcheck.sh` explicitly probes `http://localhost:8000/health` inside `verifa_worker` in addition to container state checks. Adding a `healthcheck:` block in `docker-compose.yml` is recommended for the infra stream. |
| **P2 (Medium)** | **No standalone local pre-deploy gate, post-deploy healthcheck, or safe rollback script.** Deploy checks were embedded inside `scripts/deploy.sh` and omitted `/pricing`, `/api/billing/webhook` reachability, Postgres `SELECT 1`, and Redis `PING`; manual rollback required copy-pasting a multi-command SSH one-liner. | `scripts/deploy.sh` lines 182–204, 220. | Implemented `scripts/ci/pre-deploy-gate.sh`, `scripts/ops/post-deploy-healthcheck.sh`, and `scripts/ops/rollback-release.sh`. |
| **P3 (Low)** | **Cron bearer secret is embedded inline in root crontab** (`curl -H "Authorization: Bearer <REDACTED>"`). | `crontab -l` on VPS (redacted here). | Recommend moving the header into a `0600` file (e.g. `/root/.verifa-cron-curl.cfg` with `-K`) so tokens are not exposed in `ps` output. |

---

## 2. Live VPS Baseline Snapshot (Read-Only, 2026-11-25)

- **Host:** Debian 6.1 (`2 vCPU`, `7.8 GiB RAM` — `5.7 GiB used / 2.0 GiB available`, `4.0 GiB Swap` — `2.1 GiB used`)
- **Disk (`/`):** `69G / 97G` (`75%` used, `24G` free)
- **Containers:**
  - `verifa_frontend`: Up 4h `(healthy)`, `39.65% CPU`, `536.5MiB / 1.5GiB`, **`169 / 200 PIDs (84.5%)`**
  - `verifa_postgres`: Up 5w `(healthy)`, `57.82% CPU`, `1.435GiB / 3GiB`, `39 PIDs`, **`38 / 100` active connections**
  - `verifa_worker`: Up 4h (no Docker healthcheck; internal `/health` returns `{"ok":true}`)
  - `verifa_arq_worker`: Up 4h `(healthy)`
  - `verifa_redis`: Up 2m `(healthy)`, `6.0MiB / 512MiB` (password-protected via `--requirepass`)
  - `verifa_browserless`: Up 7d `(healthy)`, `156.5MiB / 3GiB`
- **Rollback Tags Available:** `verifa-frontend:rollback`, `verifa-worker-image:rollback` (and `pre-etapa1-20261125`)
- **Live HTTP Journey Baseline (`https://verifa.sk`):**
  - `GET /` → `200`
  - `GET /pricing` → `200`
  - `GET /api/health` → `200` (`{"status":"ok","db":"ok"}`)
  - `GET /firma/35876832-kia-motors-slovakia-s-r-o` → `200`
  - `POST /api/billing/webhook` (unsigned `{}`) → `400` (`{"error":"Missing signature"}`)

---

## 3. Implemented Tooling & Usage

### 3.1 GitHub Actions Pre-Deploy CI Workflow
- **File:** `.github/workflows/ci-quality-gate.yml`
- **Triggers:** `push` and `pull_request` on `master` and `release/**`, plus `workflow_dispatch`.
- **Jobs:**
  1. `scripts-and-ops-tests` — runs `bash scripts/ci/tests/run-all.sh`.
  2. `frontend-quality` — `npm ci`, `npx prisma generate`, `npx tsc --noEmit`, strict `npm run lint`, `npm run test:unit`.
  3. `frontend-build` — ephemeral `postgres:16-alpine` service, `npx prisma db push --skip-generate`, `npm run build`.
  4. `worker-tests` — Python 3.11, `requirements.txt` + `tests/requirements-test.txt`, Prisma Python generate, `pytest -m "not integration"`.
  5. `quality-gate-summary` — single required status check aggregating all 4 jobs.

### 3.2 Local Pre-Deploy Quality Gate
- **File:** `scripts/ci/pre-deploy-gate.sh`
- **Usage:**
  ```bash
  bash scripts/ci/pre-deploy-gate.sh
  bash scripts/ci/pre-deploy-gate.sh --skip-build --json
  ```

### 3.3 Post-Deploy Healthcheck
- **File:** `scripts/ops/post-deploy-healthcheck.sh`
- **Checks:** HTTP 200 on `/`, `/firma/35876832-kia-motors-slovakia-s-r-o`, `/api/health` (JSON `"status":"ok"`), `/pricing`; HTTP 400/401/403 on unsigned `POST /api/billing/webhook`; Docker container states + `verifa_worker` internal `/health`; PostgreSQL `pg_isready` + `SELECT 1`; Redis `PING` (auth via `REDISCLI_AUTH`).
- **Usage:**
  ```bash
  # Remote HTTP-only verification (safe from laptop/CI)
  bash scripts/ops/post-deploy-healthcheck.sh --skip-docker --base-url=https://verifa.sk

  # Full verification on VPS
  bash scripts/ops/post-deploy-healthcheck.sh --json
  ```

### 3.4 Safe Release Rollback
- **File:** `scripts/ops/rollback-release.sh`
- **Safety Guarantees:** Pre-flight verifies `:rollback` (or `--tag=...`) image exists; saves currently running `:latest` as `:pre-rollback-<UTC_TS>`; uses `docker compose up -d --force-recreate --no-build --no-deps` so PostgreSQL, Redis, and all volumes are never touched; runs `post-deploy-healthcheck.sh` afterward.
- **Usage:**
  ```bash
  # Preview rollback without changing anything
  bash scripts/ops/rollback-release.sh --service=all --dry-run

  # Execute rollback of frontend only
  bash scripts/ops/rollback-release.sh --service=frontend --yes
  ```

### 3.5 Lightweight System & Container Monitor
- **File:** `scripts/ops/system-monitor.sh`
- **Metrics & Default Thresholds:**
  - Host CPU (`WARN >= 80%`, `CRIT >= 95%`)
  - Host RAM (`WARN >= 80%`, `CRIT >= 90%`) + Swap reporting
  - Root Disk `/` (`WARN >= 80%`, `CRIT >= 90%`)
  - `verifa_frontend` PIDs vs `pids_limit` (`WARN >= 70%`, `CRIT >= 85%`)
  - PostgreSQL active connections vs `max_connections` (`WARN >= 70%`, `CRIT >= 85%`)
  - Redis `PING` + `used_memory / maxmemory` (`WARN >= 75%`, `CRIT >= 90%`)
- **Exit Codes:** `0` (OK), `1` (WARN), `2` (CRIT) — or always `0` with `--no-fail`.
- **Recommended VPS Cron (for operator to install manually; NOT installed by Stream 5):**
  ```cron
  */5 * * * * /var/www/verifa/scripts/ops/system-monitor.sh --json --no-fail >> /var/log/verifa-system-monitor.jsonl 2>&1
  ```

---

## 4. Risks & Open Questions

1. **ESLint strictness in CI:** `.github/workflows/ci-quality-gate.yml` runs `npm run lint` without `continue-on-error: true`. If pre-existing lint errors exist on `release/etapa-1`, they should be fixed or temporarily run locally with `--allow-lint-warn` until resolved.
2. **Database migration rollbacks:** `rollback-release.sh` intentionally does not roll back PostgreSQL schema migrations. Forward-compatible (expand-and-contract) migrations remain mandatory so `:rollback` app images stay compatible with the latest schema.
3. **Alert delivery transport:** `system-monitor.sh` outputs structured JSON and standard exit codes (`0/1/2`) without hardcoding an external alerting vendor. Connect it to Slack/Telegram/email/Uptime Kuma when alert routing is finalized.
4. **`verifa_frontend` PIDs at 169/200:** Immediately after installing `system-monitor.sh` on VPS, it will fire a `WARN` (84.5%) and cross `CRIT` at 170 PIDs. Coordinate with the infra/frontend stream to either raise `pids_limit` or diagnose why Node/Next.js holds ~169 threads/PIDs.
