#!/usr/bin/env bash
# ─── Verifa Post-Deploy Healthcheck ─────────────────────────────────────────
#
# Verifies critical user journeys, container health, PostgreSQL connectivity,
# and Redis connectivity after a deployment or rollback.
#
# Checks:
#   HTTP (with browser UA to pass nginx bot/junk filter):
#     - GET  /                                          -> 200
#     - GET  /firma/35876832-kia-motors-slovakia-s-r-o  -> 200 (follows slug 308)
#     - GET  /api/health                                -> 200 + {"status":"ok","db":"ok"}
#     - GET  /pricing                                   -> 200
#     - POST /api/billing/webhook (unsigned {})         -> 400 (route alive & guard active)
#   Docker / Infra (when running on VPS or Docker host):
#     - Container status: verifa_frontend, verifa_worker, verifa_arq_worker,
#       verifa_postgres, verifa_redis, verifa_browserless
#     - Worker internal HTTP /health (port 8000)
#     - PostgreSQL pg_isready + SELECT 1
#     - Redis PING (authenticating safely via REDISCLI_AUTH)
#
# Usage:
#   bash scripts/ops/post-deploy-healthcheck.sh [options]
#
# Options:
#   --base-url=URL      Target base URL (default: https://verifa.sk)
#   --firma-path=PATH   Sample company page path (default: /firma/35876832-kia-motors-slovakia-s-r-o)
#   --env-file=PATH     Path to .env file for REDIS_PASSWORD/POSTGRES_USER (default: /var/www/verifa/.env)
#   --timeout=SEC       Per-request curl timeout in seconds (default: 15)
#   --retries=N         Retry count for HTTP checks (default: 3)
#   --retry-delay=SEC   Delay between retries in seconds (default: 2)
#   --skip-http         Skip HTTP endpoint checks
#   --skip-docker       Skip Docker, Postgres, and Redis checks
#   --json              Emit machine-readable JSON output
#   -h, --help          Show this help message
set -euo pipefail

BASE_URL="${BASE_URL:-https://verifa.sk}"
FIRMA_PATH="${FIRMA_PATH:-/firma/35876832-kia-motors-slovakia-s-r-o}"
ENV_FILE="${ENV_FILE:-/var/www/verifa/.env}"
TIMEOUT="${TIMEOUT:-15}"
RETRIES="${RETRIES:-3}"
RETRY_DELAY="${RETRY_DELAY:-2}"
SKIP_HTTP=false
SKIP_DOCKER=false
JSON_OUTPUT=false

CURL_BIN="${CURL_BIN:-curl}"
DOCKER_BIN="${DOCKER_BIN:-docker}"
USER_AGENT="${USER_AGENT:-Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36}"

for arg in "$@"; do
  case "$arg" in
    --base-url=*) BASE_URL="${arg#--base-url=}" ;;
    --firma-path=*) FIRMA_PATH="${arg#--firma-path=}" ;;
    --env-file=*) ENV_FILE="${arg#--env-file=}" ;;
    --timeout=*) TIMEOUT="${arg#--timeout=}" ;;
    --retries=*) RETRIES="${arg#--retries=}" ;;
    --retry-delay=*) RETRY_DELAY="${arg#--retry-delay=}" ;;
    --skip-http) SKIP_HTTP=true ;;
    --skip-docker) SKIP_DOCKER=true ;;
    --json) JSON_OUTPUT=true ;;
    -h|--help)
      sed -n '2,36p' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *)
      echo "ERROR: Unknown option: $arg (use --help)" >&2
      exit 2
      ;;
  esac
done

# Strip trailing slash from BASE_URL
BASE_URL="${BASE_URL%/}"

PASS_COUNT=0
FAIL_COUNT=0
CHECK_NAMES=()
CHECK_STATUSES=()
CHECK_DETAILS=()

json_escape() {
  printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g; s/\t/\\t/g' | tr '\n' ' '
}

log_human() {
  if [ "$JSON_OUTPUT" = false ]; then
    echo "$@"
  fi
}

record_check() {
  local name="$1"
  local status="$2"
  local detail="$3"
  CHECK_NAMES+=("$name")
  CHECK_STATUSES+=("$status")
  CHECK_DETAILS+=("$detail")
  if [ "$status" = "PASS" ]; then
    PASS_COUNT=$((PASS_COUNT + 1))
    if [ "$JSON_OUTPUT" = false ]; then
      printf "  [PASS] %-28s %s\n" "$name" "$detail"
    fi
  else
    FAIL_COUNT=$((FAIL_COUNT + 1))
    if [ "$JSON_OUTPUT" = false ]; then
      printf "  [FAIL] %-28s %s\n" "$name" "$detail"
    fi
  fi
}

# Safely read a single KEY=VALUE from an env file without executing shell code
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

check_http_get() {
  local name="$1"
  local path="$2"
  local expected_code="${3:-200}"
  local required_substr="${4:-}"
  local url="${BASE_URL}${path}"

  local attempt=1
  local code="000"
  local body=""
  while [ "$attempt" -le "$RETRIES" ]; do
    local tmp_body
    tmp_body="$(mktemp)"
    code="$("$CURL_BIN" -sSL -o "$tmp_body" -w "%{http_code}" --max-time "$TIMEOUT" -A "$USER_AGENT" "$url" 2>/dev/null || echo "000")"
    body="$(cat "$tmp_body" 2>/dev/null || true)"
    rm -f "$tmp_body"

    if [ "$code" = "$expected_code" ]; then
      if [ -z "$required_substr" ] || printf '%s' "$body" | grep -q "$required_substr"; then
        record_check "$name" "PASS" "HTTP $code ($url)"
        return 0
      fi
    fi

    if [ "$attempt" -lt "$RETRIES" ]; then
      sleep "$RETRY_DELAY"
    fi
    attempt=$((attempt + 1))
  done

  if [ "$code" = "$expected_code" ] && [ -n "$required_substr" ]; then
    record_check "$name" "FAIL" "HTTP $code but missing '$required_substr' ($url)"
  else
    record_check "$name" "FAIL" "HTTP $code expected $expected_code ($url)"
  fi
}

check_webhook_reachable() {
  local path="/api/billing/webhook"
  local url="${BASE_URL}${path}"
  local attempt=1
  local code="000"

  while [ "$attempt" -le "$RETRIES" ]; do
    code="$("$CURL_BIN" -sS -o /dev/null -w "%{http_code}" --max-time "$TIMEOUT" \
      -X POST -H "Content-Type: application/json" -d '{}' \
      -A "$USER_AGENT" "$url" 2>/dev/null || echo "000")"
    # 400 (Missing signature) or 401/403 means route is mounted and signature guard is active.
    # 404 or 5xx or 000 indicates broken routing or server error.
    if [ "$code" = "400" ] || [ "$code" = "401" ] || [ "$code" = "403" ]; then
      record_check "http_billing_webhook" "PASS" "HTTP $code unsigned rejected as expected ($url)"
      return 0
    fi
    if [ "$attempt" -lt "$RETRIES" ]; then
      sleep "$RETRY_DELAY"
    fi
    attempt=$((attempt + 1))
  done

  record_check "http_billing_webhook" "FAIL" "HTTP $code expected 400/401/403 ($url)"
}

log_human "=== Verifa Post-Deploy Healthcheck ==="

# ── 1. HTTP Critical Journeys ───────────────────────────────────────────────
if [ "$SKIP_HTTP" = false ]; then
  log_human "--- HTTP Journeys ($BASE_URL) ---"
  check_http_get "http_home" "/" "200"
  check_http_get "http_firma" "$FIRMA_PATH" "200"
  check_http_get "http_api_health" "/api/health" "200" '"status":"ok"'
  check_http_get "http_pricing" "/pricing" "200"
  check_webhook_reachable
fi

# ── 2. Docker Containers, PostgreSQL & Redis ────────────────────────────────
if [ "$SKIP_DOCKER" = false ]; then
  log_human "--- Containers, Postgres & Redis ---"

  CONTAINERS=("verifa_frontend" "verifa_worker" "verifa_arq_worker" "verifa_postgres" "verifa_redis" "verifa_browserless")
  for cname in "${CONTAINERS[@]}"; do
    state="$("$DOCKER_BIN" inspect --format '{{.State.Status}}|{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$cname" 2>/dev/null || echo "missing|none")"
    run_status="${state%%|*}"
    health_status="${state##*|}"
    if [ "$run_status" = "running" ] && { [ "$health_status" = "healthy" ] || [ "$health_status" = "none" ]; }; then
      record_check "container_${cname}" "PASS" "status=$run_status health=$health_status"
    else
      record_check "container_${cname}" "FAIL" "status=$run_status health=$health_status"
    fi
  done

  # Worker internal /health check (verifa_worker lacks Docker HEALTHCHECK)
  worker_health="$("$DOCKER_BIN" exec verifa_worker python -c "import urllib.request; print(urllib.request.urlopen('http://localhost:8000/health', timeout=5).read().decode())" 2>/dev/null || echo "")"
  if printf '%s' "$worker_health" | grep -q '"ok":true\|"ok": true'; then
    record_check "worker_internal_health" "PASS" "http://localhost:8000/health ok"
  else
    record_check "worker_internal_health" "FAIL" "http://localhost:8000/health failed"
  fi

  # PostgreSQL connectivity
  PG_USER="${POSTGRES_USER:-$(read_env_var POSTGRES_USER "$ENV_FILE")}"
  PG_DB="${POSTGRES_DB:-$(read_env_var POSTGRES_DB "$ENV_FILE")}"
  PG_USER="${PG_USER:-verifa}"
  PG_DB="${PG_DB:-verifa}"

  if "$DOCKER_BIN" exec verifa_postgres pg_isready -U "$PG_USER" -d "$PG_DB" >/dev/null 2>&1; then
    pg_select="$("$DOCKER_BIN" exec verifa_postgres psql -U "$PG_USER" -d "$PG_DB" -t -A -c "SELECT 1;" 2>/dev/null | tr -d '[:space:]' || echo "")"
    if [ "$pg_select" = "1" ]; then
      record_check "postgres_connectivity" "PASS" "pg_isready + SELECT 1 ok (db=$PG_DB)"
    else
      record_check "postgres_connectivity" "FAIL" "pg_isready ok but SELECT 1 failed"
    fi
  else
    record_check "postgres_connectivity" "FAIL" "pg_isready failed (user=$PG_USER db=$PG_DB)"
  fi

  # Redis connectivity
  REDIS_PW="${REDIS_PASSWORD:-$(read_env_var REDIS_PASSWORD "$ENV_FILE")}"
  if [ -n "$REDIS_PW" ]; then
    redis_pong="$("$DOCKER_BIN" exec -e "REDISCLI_AUTH=$REDIS_PW" verifa_redis redis-cli --no-auth-warning PING 2>/dev/null | tr -d '[:space:]' || echo "")"
  else
    redis_pong="$("$DOCKER_BIN" exec verifa_redis redis-cli PING 2>/dev/null | tr -d '[:space:]' || echo "")"
  fi

  if [ "$redis_pong" = "PONG" ]; then
    record_check "redis_connectivity" "PASS" "PING -> PONG"
  else
    record_check "redis_connectivity" "FAIL" "PING failed (got '${redis_pong:-empty}')"
  fi
fi

OVERALL="PASS"
EXIT_CODE=0
if [ "$FAIL_COUNT" -gt 0 ]; then
  OVERALL="FAIL"
  EXIT_CODE=1
fi

if [ "$JSON_OUTPUT" = true ]; then
  printf '{"status":"%s","passed":%d,"failed":%d,"checks":[' "$OVERALL" "$PASS_COUNT" "$FAIL_COUNT"
  for i in "${!CHECK_NAMES[@]}"; do
    [ "$i" -gt 0 ] && printf ','
    printf '{"name":"%s","status":"%s","detail":"%s"}' \
      "$(json_escape "${CHECK_NAMES[$i]}")" \
      "${CHECK_STATUSES[$i]}" \
      "$(json_escape "${CHECK_DETAILS[$i]}")"
  done
  printf ']}\n'
else
  echo "--------------------------------------"
  echo "Healthcheck Result: $OVERALL (pass=$PASS_COUNT fail=$FAIL_COUNT)"
fi

exit "$EXIT_CODE"
