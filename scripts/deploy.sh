#!/bin/bash
# ─── Verifa.sk Unified Deploy Script ───────────────────────────────────────
#
# Consolidates the previous scripts/deploy.sh, deploy-frontend.sh, and
# scripts/deploy-local.sh into one entry point.
#
# Can be run either:
#   (a) from your LOCAL dev machine (recommended) — it SSHes to the server
#       for the remote steps; or
#   (b) directly ON the server (e.g. `ssh ... "bash /var/www/verifa/scripts/deploy.sh"`)
#       — auto-detected by checking whether cwd == REMOTE_DIR.
#
# Build modes:
#   (default)      Build images ON the server (`docker compose build`).
#                   Simpler, no image transfer, but uses server CPU/disk
#                   and can't be combined with (b) local-build.
#   --local-build  Build images on YOUR machine (cross-compiled for
#                   linux/amd64), ship them via `docker save | ssh | docker
#                   load`, and restart the server without rebuilding there.
#                   Faster if your machine outpaces the server; keeps
#                   server CPU/disk free during the build. Must be run from
#                   your local machine (not on the server).
#
# Scope:
#   --service=all       (default) frontend + worker + arq_worker
#   --service=frontend  Only rebuild/restart the frontend container
#   --service=worker    Only rebuild/restart worker + arq_worker
#
# All modes/scopes: pull latest code, run `prisma migrate deploy`, restart
# the selected containers, reload nginx, tag the previous images for
# rollback, clean up old images/build cache, and verify site health.
#
# Usage:
#   bash scripts/deploy.sh                              # server-build, all services
#   bash scripts/deploy.sh --local-build                 # local-build + ship, all services
#   bash scripts/deploy.sh --service=frontend             # server-build, frontend only
#   bash scripts/deploy.sh --local-build --service=worker # local-build, worker only
#
# Rollback (printed at the end of every run):
#   ssh root@89.185.250.213 "cd /var/www/verifa && docker tag verifa-frontend:rollback verifa-frontend && docker tag verifa-worker-image:rollback verifa-worker-image && docker compose up -d --force-recreate frontend worker arq_worker"
set -euo pipefail

SERVER="root@89.185.250.213"
REMOTE_DIR="/var/www/verifa"
LOCAL_BUILD=false
SERVICE="all"

for arg in "$@"; do
  case "$arg" in
    --local-build) LOCAL_BUILD=true ;;
    --service=*) SERVICE="${arg#--service=}" ;;
    -h|--help)
      grep '^#' "$0" | sed 's/^#!\?//; s/^ //'
      exit 0
      ;;
    *)
      echo "Unknown argument: $arg (use --local-build, --service=all|frontend|worker, or --help)" >&2
      exit 1
      ;;
  esac
done

case "$SERVICE" in
  all) IMAGES=("verifa-frontend" "verifa-worker-image"); BUILD_TARGETS="frontend worker arq_worker"; RESTART_TARGETS="" ;;
  frontend) IMAGES=("verifa-frontend"); BUILD_TARGETS="frontend"; RESTART_TARGETS="" ;;
  worker) IMAGES=("verifa-worker-image"); BUILD_TARGETS="worker arq_worker"; RESTART_TARGETS="" ;;
  *) echo "Unknown --service value: $SERVICE (use all|frontend|worker)" >&2; exit 1 ;;
esac

# Detect whether we're already ON the server (script started there directly)
ON_SERVER=false
if [ "$(pwd)" = "$REMOTE_DIR" ]; then
  ON_SERVER=true
fi

if [ "$LOCAL_BUILD" = true ] && [ "$ON_SERVER" = true ]; then
  echo "ERROR: --local-build must be run from your local machine, not on the server." >&2
  exit 1
fi

remote() {
  # Run a command on the server, whether we're already there or need SSH.
  if [ "$ON_SERVER" = true ]; then
    bash -c "$1"
  else
    ssh "$SERVER" "$1"
  fi
}

echo "=== Verifa.sk Deploy ($([ "$LOCAL_BUILD" = true ] && echo "local-build" || echo "server-build"), service=$SERVICE) ==="
echo "[$(date)] Starting deploy..."

echo "--- Tagging current image(s) for rollback ---"
remote "for img in ${IMAGES[*]}; do docker tag \$img \${img}:rollback 2>/dev/null || true; done"

if [ "$LOCAL_BUILD" = true ]; then
  PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
  cd "$PROJECT_DIR"
  TAR_FILE="/tmp/verifa-images-$(date +%s).tar.gz"

  echo "--- Building image(s) locally (linux/amd64) ---"
  DOCKER_DEFAULT_PLATFORM=linux/amd64 docker compose build $BUILD_TARGETS

  echo "--- Saving + transferring image(s) to server ---"
  docker save "${IMAGES[@]}" | gzip > "$TAR_FILE"
  echo "  Saved $(du -h "$TAR_FILE" | cut -f1)"
  scp "$TAR_FILE" "$SERVER:$TAR_FILE"
  ssh "$SERVER" "docker load < $TAR_FILE && rm -f $TAR_FILE"
  rm -f "$TAR_FILE"

  echo "--- Pulling latest code on server ---"
  remote "cd $REMOTE_DIR && git pull"

  echo "--- Gracefully stopping ORSR V2 seed (if running) ---"
  remote "cd $REMOTE_DIR && LOCK_PID=\$(cat ./worker/results/orsr_v2.lock 2>/dev/null || echo ''); if [ -n \"\$LOCK_PID\" ] && docker compose exec -T worker test -d /proc/\$LOCK_PID 2>/dev/null; then echo \"  V2 running (PID \$LOCK_PID) — sending SIGTERM...\"; docker compose exec -T worker kill -TERM \$LOCK_PID 2>/dev/null || true; echo \"  Waiting up to 15s for graceful shutdown...\"; for i in \$(seq 1 15); do docker compose exec -T worker test -d /proc/\$LOCK_PID 2>/dev/null || { echo '  V2 stopped gracefully.'; break; }; sleep 1; done; else echo '  V2 not running.'; fi"

  echo "--- Recreating container(s) (no rebuild) ---"
  remote "cd $REMOTE_DIR && docker compose up -d --no-build $BUILD_TARGETS"
else
  echo "--- Pulling latest code on server ---"
  remote "cd $REMOTE_DIR && git pull"

  echo "--- Gracefully stopping ORSR V2 seed (if running) ---"
  remote "cd $REMOTE_DIR && LOCK_PID=\$(cat ./worker/results/orsr_v2.lock 2>/dev/null || echo ''); if [ -n \"\$LOCK_PID\" ] && docker compose exec -T worker test -d /proc/\$LOCK_PID 2>/dev/null; then echo \"  V2 running (PID \$LOCK_PID) — sending SIGTERM...\"; docker compose exec -T worker kill -TERM \$LOCK_PID 2>/dev/null || true; echo \"  Waiting up to 15s for graceful shutdown...\"; for i in \$(seq 1 15); do docker compose exec -T worker test -d /proc/\$LOCK_PID 2>/dev/null || { echo '  V2 stopped gracefully.'; break; }; sleep 1; done; else echo '  V2 not running.'; fi"

  echo "--- Building + recreating container(s) on server ---"
  remote "cd $REMOTE_DIR && docker compose up -d --build $BUILD_TARGETS"
fi

echo "--- Running DB migration ---"
remote "cd $REMOTE_DIR && docker compose exec -T -e HOME=/tmp -u root frontend node /app/node_modules/prisma/build/index.js migrate deploy"

if [ -n "$RESTART_TARGETS" ]; then
  echo "--- Restarting $RESTART_TARGETS (ensure new image is running) ---"
  remote "cd $REMOTE_DIR && chown -R 1001:1001 ./worker/results 2>/dev/null || true; docker compose restart $RESTART_TARGETS"
  echo "  Waiting for worker health..."
  remote "cd $REMOTE_DIR && for i in \$(seq 1 15); do if docker compose exec -T worker curl -sf http://localhost:8000/health >/dev/null 2>&1; then echo '  OK worker healthy'; break; fi; sleep 2; done"
fi

echo "--- Reloading nginx ---"
remote "systemctl reload nginx"

echo "--- Cleaning up old Docker images & build cache ---"
remote "docker image prune -f --filter 'until=24h' 2>/dev/null | tail -1 || true; docker builder prune -f --filter 'until=24h' 2>/dev/null | tail -1 || true"
remote "echo '  Disk:' \$(df -h / | awk 'NR==2 {print \$3 \" / \" \$2 \" (\" \$5 \")\"}')"

echo ""
echo "[$(date)] Health check..."
sleep 3
if curl -s -o /dev/null -w "%{http_code}" https://verifa.sk | grep -q "200\|301\|302"; then
  echo "  OK site is responding"
else
  echo "  WARN site not responding — check: ssh $SERVER 'cd $REMOTE_DIR && docker compose logs -f --tail=50'"
fi

echo ""
echo "[$(date)] Deploy complete!"
echo "  Site: https://verifa.sk"
echo "  Status: ssh $SERVER 'cd $REMOTE_DIR && docker compose ps'"
echo "  Logs: ssh $SERVER 'cd $REMOTE_DIR && docker compose logs -f --tail=50'"
echo "  Rollback: ssh $SERVER \"cd $REMOTE_DIR && $(for img in "${IMAGES[@]}"; do printf 'docker tag %s:rollback %s && ' "$img" "$img"; done)docker compose up -d --force-recreate $BUILD_TARGETS\""
