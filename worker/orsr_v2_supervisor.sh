#!/bin/sh
# ORSR V2 Supervisor — auto-starts and auto-resumes bulk seed after container recreation.
#
# Runs in a loop: start V2 with --bootstrap-from-db, wait for exit,
# sleep 30s, restart. The flock lock in V2 prevents concurrent instances.
#
# Graceful shutdown: V2 catches SIGTERM, saves checkpoint, exits cleanly.
# This supervisor also catches SIGTERM and forwards it to the V2 child.
#
# Log: /app/results/orsr_v2_supervisor.log
set -e

LOG_FILE="/app/results/orsr_v2_supervisor.log"
LOCK_FILE="/app/results/orsr_v2.lock"
V2_CMD="python -m src.bulk_seed_orsr_v2 --bootstrap-from-db"

log() {
  echo "$(date '+%Y-%m-%d %H:%M:%S') [supervisor] $*" >> "$LOG_FILE"
}

# Wait for DB to be ready (check via worker health endpoint)
log "Waiting for worker to be ready..."
for i in $(seq 1 30); do
  if curl -sf http://localhost:8000/health >/dev/null 2>&1; then
    log "Worker ready (DB connected)."
    break
  fi
  sleep 2
done

# Clean stale lock if PID is not alive
if [ -f "$LOCK_FILE" ]; then
  LOCK_PID=$(cat "$LOCK_FILE" 2>/dev/null || echo "")
  if [ -n "$LOCK_PID" ] && [ ! -d "/proc/$LOCK_PID" ]; then
    log "Stale lock detected (PID $LOCK_PID not alive) — removing."
    rm -f "$LOCK_FILE"
  fi
fi

# Supervisor loop
log "Starting ORSR V2 supervisor loop."
CHILD_PID=""

forward_signal() {
  if [ -n "$CHILD_PID" ] && kill -0 "$CHILD_PID" 2>/dev/null; then
    log "Forwarding SIGTERM to V2 (PID $CHILD_PID)."
    kill -TERM "$CHILD_PID" 2>/dev/null || true
    wait "$CHILD_PID" 2>/dev/null || true
    log "V2 exited."
  fi
  exit 0
}

trap forward_signal TERM INT

while true; do
  log "Launching V2: $V2_CMD"
  $V2_CMD >> "$LOG_FILE" 2>&1 &
  CHILD_PID=$!
  log "V2 started (PID $CHILD_PID)."

  wait "$CHILD_PID" 2>/dev/null
  EXIT_CODE=$?
  CHILD_PID=""
  log "V2 exited with code $EXIT_CODE."

  # If V2 exited because it couldn't acquire the lock, another instance is running.
  # Don't restart in that case — just exit the supervisor.
  if [ $EXIT_CODE -eq 0 ]; then
    log "V2 completed normally. Supervisor exiting."
    exit 0
  fi

  log "V2 exited unexpectedly. Restarting in 30s..."
  sleep 30
done
