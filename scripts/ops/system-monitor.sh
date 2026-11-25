#!/usr/bin/env bash
# ─── Verifa Lightweight System & Container Monitor ──────────────────────────
#
# Collects host & Verifa service telemetry and evaluates alert thresholds:
#   - Host CPU usage (%) & load average
#   - Host RAM usage (MiB, %) & Swap usage (MiB, %)
#   - Root disk usage (GiB, %)
#   - Container PIDs (especially verifa_frontend vs pids_limit)
#   - PostgreSQL active connections vs max_connections
#   - Redis PING + memory usage vs maxmemory
#
# Exit codes:
#   0 = OK (all metrics within thresholds)
#   1 = WARN (one or more warning thresholds exceeded)
#   2 = CRIT (one or more critical thresholds exceeded or service unreachable)
#
# Usage:
#   bash scripts/ops/system-monitor.sh [options]
#
# Options:
#   --json              Emit machine-readable JSON output
#   --env-file=PATH     Path to .env file for REDIS_PASSWORD/POSTGRES_USER (default: /var/www/verifa/.env)
#   --no-fail           Always exit 0 (useful for passive cron logging)
#   -h, --help          Show this help message
#
# Threshold overrides (env vars):
#   CPU_WARN_PCT=80       CPU_CRIT_PCT=95
#   RAM_WARN_PCT=80       RAM_CRIT_PCT=90
#   DISK_WARN_PCT=80      DISK_CRIT_PCT=90
#   PIDS_WARN_PCT=70      PIDS_CRIT_PCT=85
#   PG_CONN_WARN_PCT=70   PG_CONN_CRIT_PCT=85
#   REDIS_MEM_WARN_PCT=75 REDIS_MEM_CRIT_PCT=90
set -euo pipefail

ENV_FILE="${ENV_FILE:-/var/www/verifa/.env}"
JSON_OUTPUT=false
NO_FAIL=false

# Injectable binaries/overrides for testability
DOCKER_BIN="${DOCKER_BIN:-docker}"
DF_BIN="${DF_BIN:-df}"
FREE_BIN="${FREE_BIN:-free}"
HOST_NAME="${HOST_NAME:-$(hostname 2>/dev/null || echo unknown)}"
FRONTEND_CONTAINER="${FRONTEND_CONTAINER:-verifa_frontend}"
POSTGRES_CONTAINER="${POSTGRES_CONTAINER:-verifa_postgres}"
REDIS_CONTAINER="${REDIS_CONTAINER:-verifa_redis}"

# Alert thresholds
CPU_WARN_PCT="${CPU_WARN_PCT:-80}"
CPU_CRIT_PCT="${CPU_CRIT_PCT:-95}"
RAM_WARN_PCT="${RAM_WARN_PCT:-80}"
RAM_CRIT_PCT="${RAM_CRIT_PCT:-90}"
DISK_WARN_PCT="${DISK_WARN_PCT:-80}"
DISK_CRIT_PCT="${DISK_CRIT_PCT:-90}"
PIDS_WARN_PCT="${PIDS_WARN_PCT:-70}"
PIDS_CRIT_PCT="${PIDS_CRIT_PCT:-85}"
PG_CONN_WARN_PCT="${PG_CONN_WARN_PCT:-70}"
PG_CONN_CRIT_PCT="${PG_CONN_CRIT_PCT:-85}"
REDIS_MEM_WARN_PCT="${REDIS_MEM_WARN_PCT:-75}"
REDIS_MEM_CRIT_PCT="${REDIS_MEM_CRIT_PCT:-90}"

for arg in "$@"; do
  case "$arg" in
    --json) JSON_OUTPUT=true ;;
    --env-file=*) ENV_FILE="${arg#--env-file=}" ;;
    --no-fail) NO_FAIL=true ;;
    -h|--help)
      sed -n '2,33p' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *)
      echo "ERROR: Unknown option: $arg (use --help)" >&2
      exit 2
      ;;
  esac
done

json_escape() {
  printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g; s/\t/\\t/g' | tr '\n' ' '
}

read_env_var() {
  local key="$1"
  local file="$2"
  if [ ! -r "$file" ]; then
    return 0
  fi
  local line
  line="$(grep -E "^${key}=" "$file" 2>/dev/null | tail -n 1 || true)"
  if [ -n "$line" ]; then
    local val="${line#*=}"
    val="${val%\"}"
    val="${val#\"}"
    val="${val%\'}"
    val="${val#\'}"
    printf '%s' "$val"
  fi
}

ALERTS=()
OVERALL_STATUS="ok"

add_alert() {
  local level="$1"
  local message="$2"
  ALERTS+=("${level}:${message}")
  if [ "$level" = "CRIT" ]; then
    OVERALL_STATUS="crit"
  elif [ "$level" = "WARN" ] && [ "$OVERALL_STATUS" != "crit" ]; then
    OVERALL_STATUS="warn"
  fi
}

eval_pct_threshold() {
  local label="$1"
  local val="$2"
  local warn="$3"
  local crit="$4"
  local extra="${5:-}"
  if [ "$val" -ge "$crit" ]; then
    add_alert "CRIT" "${label} at ${val}% >= ${crit}%${extra}"
  elif [ "$val" -ge "$warn" ]; then
    add_alert "WARN" "${label} at ${val}% >= ${warn}%${extra}"
  fi
}

# ── 1. Host CPU & Load ──────────────────────────────────────────────────────
if [ -n "${MOCK_CPU_PCT:-}" ]; then
  CPU_PCT="$MOCK_CPU_PCT"
  LOAD_AVG="${MOCK_LOAD_AVG:-0.50}"
  CPU_CORES="${MOCK_CPU_CORES:-2}"
elif [ -r /proc/stat ]; then
  CPU_CORES="$(nproc 2>/dev/null || echo 1)"
  LOAD_AVG="$(awk '{print $1}' /proc/loadavg 2>/dev/null || echo "0.00")"
  read -r _ u1 n1 s1 i1 w1 irq1 sirq1 st1 _ < /proc/stat
  sleep 0.2
  read -r _ u2 n2 s2 i2 w2 irq2 sirq2 st2 _ < /proc/stat
  idle_delta=$(( (i2 + w2) - (i1 + w1) ))
  total_delta=$(( (u2 + n2 + s2 + i2 + w2 + irq2 + sirq2 + st2) - (u1 + n1 + s1 + i1 + w1 + irq1 + sirq1 + st1) ))
  if [ "$total_delta" -gt 0 ]; then
    CPU_PCT=$(( (100 * (total_delta - idle_delta)) / total_delta ))
  else
    CPU_PCT=0
  fi
else
  CPU_CORES="$(sysctl -n hw.ncpu 2>/dev/null || echo 1)"
  LOAD_AVG="$(uptime 2>/dev/null | awk -F'load averages?: ' '{print $2}' | awk '{print $1}' | tr -d ',' || echo "0.00")"
  CPU_PCT="$(awk -v l="$LOAD_AVG" -v c="$CPU_CORES" 'BEGIN { p=int((l/c)*100); if (p>100) p=100; if (p<0) p=0; print p }')"
fi
eval_pct_threshold "host_cpu" "$CPU_PCT" "$CPU_WARN_PCT" "$CPU_CRIT_PCT" " (load=${LOAD_AVG}, cores=${CPU_CORES})"

# ── 2. Host RAM & Swap ──────────────────────────────────────────────────────
RAM_TOTAL_MB=0
RAM_USED_MB=0
RAM_PCT=0
SWAP_TOTAL_MB=0
SWAP_USED_MB=0

if [ -n "${MOCK_RAM_PCT:-}" ]; then
  RAM_TOTAL_MB="${MOCK_RAM_TOTAL_MB:-8000}"
  RAM_USED_MB="${MOCK_RAM_USED_MB:-4000}"
  RAM_PCT="$MOCK_RAM_PCT"
  SWAP_TOTAL_MB="${MOCK_SWAP_TOTAL_MB:-4096}"
  SWAP_USED_MB="${MOCK_SWAP_USED_MB:-0}"
elif command -v "$FREE_BIN" >/dev/null 2>&1; then
  read -r RAM_TOTAL_MB RAM_USED_MB RAM_AVAIL_MB < <("$FREE_BIN" -m | awk '/^Mem:/ {print $2, $3, $7}')
  read -r SWAP_TOTAL_MB SWAP_USED_MB < <("$FREE_BIN" -m | awk '/^Swap:/ {print $2, $3}')
  if [ "${RAM_TOTAL_MB:-0}" -gt 0 ]; then
    # Use (total - available) for realistic Linux memory pressure
    if [ -n "${RAM_AVAIL_MB:-}" ] && [ "$RAM_AVAIL_MB" -ge 0 ] 2>/dev/null; then
      effective_used=$((RAM_TOTAL_MB - RAM_AVAIL_MB))
      RAM_USED_MB="$effective_used"
    fi
    RAM_PCT=$(( (RAM_USED_MB * 100) / RAM_TOTAL_MB ))
  fi
fi
eval_pct_threshold "host_ram" "$RAM_PCT" "$RAM_WARN_PCT" "$RAM_CRIT_PCT" " (${RAM_USED_MB}/${RAM_TOTAL_MB}MiB)"

# ── 3. Root Disk Usage ──────────────────────────────────────────────────────
DISK_TOTAL_GB=0
DISK_AVAIL_GB=0
DISK_PCT=0

if [ -n "${MOCK_DISK_PCT:-}" ]; then
  DISK_TOTAL_GB="${MOCK_DISK_TOTAL_GB:-100}"
  DISK_AVAIL_GB="${MOCK_DISK_AVAIL_GB:-25}"
  DISK_PCT="$MOCK_DISK_PCT"
else
  read -r DISK_TOTAL_KB DISK_AVAIL_KB DISK_PCT_RAW < <("$DF_BIN" -k / | awk 'NR==2 {print $2, $4, $5}')
  DISK_TOTAL_GB=$(( ${DISK_TOTAL_KB:-0} / 1024 / 1024 ))
  DISK_AVAIL_GB=$(( ${DISK_AVAIL_KB:-0} / 1024 / 1024 ))
  DISK_PCT="${DISK_PCT_RAW%%%}"
  DISK_PCT="${DISK_PCT:-0}"
fi
eval_pct_threshold "root_disk" "$DISK_PCT" "$DISK_WARN_PCT" "$DISK_CRIT_PCT" " (${DISK_AVAIL_GB}GiB free of ${DISK_TOTAL_GB}GiB)"

# ── 4. Container PIDs (verifa_frontend vs pids_limit) ───────────────────────
FE_PIDS=0
FE_PIDS_LIMIT=0
FE_PIDS_PCT=0

FE_PIDS_RAW="$("$DOCKER_BIN" stats --no-stream --format '{{.PIDs}}' "$FRONTEND_CONTAINER" 2>/dev/null | tr -d '[:space:]' || echo "")"
FE_PIDS_LIMIT_RAW="$("$DOCKER_BIN" inspect --format '{{.HostConfig.PidsLimit}}' "$FRONTEND_CONTAINER" 2>/dev/null | tr -d '[:space:]' || echo "")"

if [[ "$FE_PIDS_RAW" =~ ^[0-9]+$ ]]; then
  FE_PIDS="$FE_PIDS_RAW"
else
  add_alert "CRIT" "${FRONTEND_CONTAINER} PIDs unavailable (container down?)"
fi

if [[ "$FE_PIDS_LIMIT_RAW" =~ ^[0-9]+$ ]] && [ "$FE_PIDS_LIMIT_RAW" -gt 0 ]; then
  FE_PIDS_LIMIT="$FE_PIDS_LIMIT_RAW"
  FE_PIDS_PCT=$(( (FE_PIDS * 100) / FE_PIDS_LIMIT ))
  eval_pct_threshold "${FRONTEND_CONTAINER}_pids" "$FE_PIDS_PCT" "$PIDS_WARN_PCT" "$PIDS_CRIT_PCT" " (${FE_PIDS}/${FE_PIDS_LIMIT})"
fi

# ── 5. PostgreSQL Connections ───────────────────────────────────────────────
PG_USER="${POSTGRES_USER:-$(read_env_var POSTGRES_USER "$ENV_FILE")}"
PG_DB="${POSTGRES_DB:-$(read_env_var POSTGRES_DB "$ENV_FILE")}"
PG_USER="${PG_USER:-verifa}"
PG_DB="${PG_DB:-verifa}"

PG_CONNS=0
PG_MAX_CONNS=0
PG_CONN_PCT=0
PG_OK=false

PG_OUT="$("$DOCKER_BIN" exec "$POSTGRES_CONTAINER" psql -U "$PG_USER" -d "$PG_DB" -t -A -c "SELECT count(*), current_setting('max_connections') FROM pg_stat_activity;" 2>/dev/null | tr -d '[:space:]' || echo "")"
if [[ "$PG_OUT" =~ ^([0-9]+)\|([0-9]+)$ ]]; then
  PG_OK=true
  PG_CONNS="${BASH_REMATCH[1]}"
  PG_MAX_CONNS="${BASH_REMATCH[2]}"
  if [ "$PG_MAX_CONNS" -gt 0 ]; then
    PG_CONN_PCT=$(( (PG_CONNS * 100) / PG_MAX_CONNS ))
    eval_pct_threshold "postgres_connections" "$PG_CONN_PCT" "$PG_CONN_WARN_PCT" "$PG_CONN_CRIT_PCT" " (${PG_CONNS}/${PG_MAX_CONNS})"
  fi
else
  add_alert "CRIT" "postgres unreachable or query failed (${POSTGRES_CONTAINER})"
fi

# ── 6. Redis PING & Memory ──────────────────────────────────────────────────
REDIS_PW="${REDIS_PASSWORD:-$(read_env_var REDIS_PASSWORD "$ENV_FILE")}"
REDIS_OK=false
REDIS_USED_BYTES=0
REDIS_MAX_BYTES=0
REDIS_MEM_PCT=0

redis_exec() {
  if [ -n "$REDIS_PW" ]; then
    "$DOCKER_BIN" exec -e "REDISCLI_AUTH=$REDIS_PW" "$REDIS_CONTAINER" redis-cli --no-auth-warning "$@" 2>/dev/null
  else
    "$DOCKER_BIN" exec "$REDIS_CONTAINER" redis-cli "$@" 2>/dev/null
  fi
}

REDIS_PING="$(redis_exec PING | tr -d '[:space:]' || echo "")"
if [ "$REDIS_PING" = "PONG" ]; then
  REDIS_OK=true
  REDIS_INFO="$(redis_exec INFO memory || echo "")"
  REDIS_USED_BYTES="$(printf '%s\n' "$REDIS_INFO" | awk -F: '/^used_memory:/ {gsub(/\r/,"",$2); print $2; exit}')"
  REDIS_MAX_BYTES="$(printf '%s\n' "$REDIS_INFO" | awk -F: '/^maxmemory:/ {gsub(/\r/,"",$2); print $2; exit}')"
  REDIS_USED_BYTES="${REDIS_USED_BYTES:-0}"
  REDIS_MAX_BYTES="${REDIS_MAX_BYTES:-0}"
  if [[ "$REDIS_USED_BYTES" =~ ^[0-9]+$ ]] && [[ "$REDIS_MAX_BYTES" =~ ^[0-9]+$ ]] && [ "$REDIS_MAX_BYTES" -gt 0 ]; then
    REDIS_MEM_PCT=$(( (REDIS_USED_BYTES * 100) / REDIS_MAX_BYTES ))
    eval_pct_threshold "redis_memory" "$REDIS_MEM_PCT" "$REDIS_MEM_WARN_PCT" "$REDIS_MEM_CRIT_PCT" " ($((REDIS_USED_BYTES / 1048576))/$((REDIS_MAX_BYTES / 1048576))MiB)"
  fi
else
  add_alert "CRIT" "redis PING failed (${REDIS_CONTAINER})"
fi

# ── Output ──────────────────────────────────────────────────────────────────
TIMESTAMP="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
REDIS_USED_MB=$(( REDIS_USED_BYTES / 1048576 ))
REDIS_MAX_MB=$(( REDIS_MAX_BYTES / 1048576 ))

if [ "$JSON_OUTPUT" = true ]; then
  printf '{"timestamp":"%s","hostname":"%s","status":"%s",' \
    "$TIMESTAMP" "$(json_escape "$HOST_NAME")" "$OVERALL_STATUS"
  printf '"metrics":{'
  printf '"cpu":{"percent":%d,"load_1m":"%s","cores":%d},' "$CPU_PCT" "$(json_escape "$LOAD_AVG")" "$CPU_CORES"
  printf '"ram":{"used_mb":%d,"total_mb":%d,"percent":%d,"swap_used_mb":%d,"swap_total_mb":%d},' \
    "$RAM_USED_MB" "$RAM_TOTAL_MB" "$RAM_PCT" "$SWAP_USED_MB" "$SWAP_TOTAL_MB"
  printf '"disk":{"avail_gb":%d,"total_gb":%d,"percent":%d},' "$DISK_AVAIL_GB" "$DISK_TOTAL_GB" "$DISK_PCT"
  printf '"frontend_pids":{"current":%d,"limit":%d,"percent":%d},' "$FE_PIDS" "$FE_PIDS_LIMIT" "$FE_PIDS_PCT"
  printf '"postgres":{"ok":%s,"connections":%d,"max_connections":%d,"percent":%d},' "$PG_OK" "$PG_CONNS" "$PG_MAX_CONNS" "$PG_CONN_PCT"
  printf '"redis":{"ok":%s,"used_mb":%d,"max_mb":%d,"percent":%d}' "$REDIS_OK" "$REDIS_USED_MB" "$REDIS_MAX_MB" "$REDIS_MEM_PCT"
  printf '},"alerts":['
  for i in "${!ALERTS[@]}"; do
    [ "$i" -gt 0 ] && printf ','
    printf '"%s"' "$(json_escape "${ALERTS[$i]}")"
  done
  printf ']}\n'
else
  echo "=== Verifa System Monitor ($HOST_NAME @ $TIMESTAMP) ==="
  printf "  Overall status  : %s\n" "$(printf '%s' "$OVERALL_STATUS" | tr '[:lower:]' '[:upper:]')"
  printf "  CPU             : %d%% (load=%s, cores=%d)\n" "$CPU_PCT" "$LOAD_AVG" "$CPU_CORES"
  printf "  RAM             : %d%% (%d/%d MiB, swap=%d/%d MiB)\n" "$RAM_PCT" "$RAM_USED_MB" "$RAM_TOTAL_MB" "$SWAP_USED_MB" "$SWAP_TOTAL_MB"
  printf "  Disk (/)        : %d%% (%d GiB free / %d GiB total)\n" "$DISK_PCT" "$DISK_AVAIL_GB" "$DISK_TOTAL_GB"
  printf "  Frontend PIDs   : %d / %d (%d%%)\n" "$FE_PIDS" "$FE_PIDS_LIMIT" "$FE_PIDS_PCT"
  printf "  PostgreSQL      : ok=%s (%d / %d conns, %d%%)\n" "$PG_OK" "$PG_CONNS" "$PG_MAX_CONNS" "$PG_CONN_PCT"
  printf "  Redis           : ok=%s (%d / %d MiB, %d%%)\n" "$REDIS_OK" "$REDIS_USED_MB" "$REDIS_MAX_MB" "$REDIS_MEM_PCT"
  if [ "${#ALERTS[@]}" -gt 0 ]; then
    echo "  Alerts:"
    for alert in "${ALERTS[@]}"; do
      echo "    - $alert"
    done
  else
    echo "  Alerts          : none"
  fi
fi

if [ "$NO_FAIL" = true ]; then
  exit 0
fi

case "$OVERALL_STATUS" in
  ok) exit 0 ;;
  warn) exit 1 ;;
  crit) exit 2 ;;
esac
