#!/bin/bash
# Daily process & container zombie cleanup
# Runs via cron at 04:15 daily
#
# 1. Terminates stuck one-off CLI scripts (tsx/node backfill, repair, fill, test, eval)
#    that have been running for more than 2 hours (7200s), without touching permanent
#    daemons (server.ts, polygonWorker.ts, analysis-keep-warm.ts, next-server, EarningsTable).
# 2. Kills orphaned Chromium processes inside verifa_worker / verifa_arq_worker older than 15m.
# 3. Restarts verifa_browserless if its PID count exceeds 40 (normal idle is ~14 PIDs).

set -u

LOG="/var/log/process-cleanup.log"
MAX_SCRIPT_AGE_SEC=7200
MAX_CHROMIUM_AGE_SEC=900
MAX_BROWSERLESS_PIDS=40

echo "[$(date '+%Y-%m-%d %H:%M:%S')] Starting process cleanup" >> "$LOG"

# 1. Clean up stuck one-off host CLI scripts (> 2h old)
STUCK_PIDS=$(ps -eo pid=,etimes=,args= | awk -v max_age="$MAX_SCRIPT_AGE_SEC" '
  $2 > max_age &&
  ($0 ~ /scripts\/(backfill-|repair-|fill-|qa-)/ || $0 ~ /\/tmp\/test-.*\.m?ts/ || $0 ~ /tsx -e / || $0 ~ /loader\.mjs --eval/) &&
  $0 !~ /server\.ts/ &&
  $0 !~ /polygonWorker\.ts/ &&
  $0 !~ /analysis-keep-warm\.ts/ &&
  $0 !~ /EarningsTable/ &&
  $0 !~ /awk/ {
    print $1
  }
')

KILLED_COUNT=0
if [ -n "$STUCK_PIDS" ]; then
  for pid in $STUCK_PIDS; do
    if kill -0 "$pid" 2>/dev/null; then
      CMD_INFO=$(ps -p "$pid" -o pid=,etimes=,rss=,args= 2>/dev/null || true)
      echo "[$(date '+%Y-%m-%d %H:%M:%S')] Killing stuck script: $CMD_INFO" >> "$LOG"
      kill -TERM "$pid" 2>/dev/null || true
      KILLED_COUNT=$((KILLED_COUNT + 1))
    fi
  done
  sleep 3
  for pid in $STUCK_PIDS; do
    if kill -0 "$pid" 2>/dev/null; then
      echo "[$(date '+%Y-%m-%d %H:%M:%S')] Force-killing (SIGKILL) PID $pid" >> "$LOG"
      kill -KILL "$pid" 2>/dev/null || true
    fi
  done
fi
echo "[$(date '+%Y-%m-%d %H:%M:%S')] Stuck host scripts terminated: $KILLED_COUNT" >> "$LOG"

# 2. Clean up orphaned local fallback Chromium processes inside worker containers (> 15m old)
for cname in verifa_worker verifa_arq_worker; do
  if docker ps --format '{{.Names}}' | grep -qx "$cname"; then
    docker exec "$cname" sh -c "
      ps -eo pid=,etimes=,args= | awk '\$2 > $MAX_CHROMIUM_AGE_SEC && (\$3 ~ /chrom/ || \$3 ~ /headless_shell/) { print \$1 }' | while read -r cpid; do
        [ -n \"\$cpid\" ] && kill -KILL \"\$cpid\" 2>/dev/null || true
      done
    " >> "$LOG" 2>&1 || true
  fi
done

# 3. Check verifa_browserless PID count (normal idle = ~14 PIDs)
if docker ps --format '{{.Names}}' | grep -qx "verifa_browserless"; then
  BL_PIDS=$(docker stats --no-stream --format '{{.PIDs}}' verifa_browserless 2>/dev/null | tr -dc '0-9')
  if [ -n "$BL_PIDS" ] && [ "$BL_PIDS" -gt "$MAX_BROWSERLESS_PIDS" ]; then
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] verifa_browserless has $BL_PIDS PIDs (> $MAX_BROWSERLESS_PIDS) — restarting container" >> "$LOG"
    docker restart verifa_browserless >> "$LOG" 2>&1 || true
  else
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] verifa_browserless PIDs healthy: ${BL_PIDS:-unknown}" >> "$LOG"
  fi
fi

FREE_MEM=$(free -h | awk '/^Mem:/ {print "used="$3" avail="$7}')
FREE_SWAP=$(free -h | awk '/^Swap:/ {print "used="$3" free="$4}')
echo "[$(date '+%Y-%m-%d %H:%M:%S')] Cleanup complete ($FREE_MEM, swap $FREE_SWAP)" >> "$LOG"
echo "---" >> "$LOG"
