#!/usr/bin/env bash
# Mock unit tests for scripts/ops/post-deploy-healthcheck.sh
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
HC_SCRIPT="$REPO_ROOT/scripts/ops/post-deploy-healthcheck.sh"
TMPDIR_TEST="$(mktemp -d)"
trap 'rm -rf "$TMPDIR_TEST"' EXIT

PASS=0
FAIL=0

assert_eq() {
  local label="$1" expected="$2" actual="$3"
  if [ "$expected" = "$actual" ]; then
    echo "  [PASS] $label"
    PASS=$((PASS + 1))
  else
    echo "  [FAIL] $label (expected='$expected', actual='$actual')"
    FAIL=$((FAIL + 1))
  fi
}

mkdir -p "$TMPDIR_TEST/bin"
cat > "$TMPDIR_TEST/.env" <<'EOF'
POSTGRES_USER=verifa
POSTGRES_DB=verifa
REDIS_PASSWORD=test_secret_pw
EOF

cat > "$TMPDIR_TEST/bin/mock_curl" <<'EOF'
#!/usr/bin/env bash
out_file=""
url=""
method="GET"
while [ $# -gt 0 ]; do
  case "$1" in
    -o) out_file="$2"; shift 2 ;;
    -X) method="$2"; shift 2 ;;
    -w|--max-time|-A|-H|-d) shift 2 ;;
    http://*|https://*) url="$1"; shift ;;
    *) shift ;;
  esac
done

body="<html>ok</html>"
code="200"

case "$url" in
  */api/health)
    if [ "${MOCK_HEALTH_DEGRADED:-0}" = "1" ]; then
      body='{"status":"degraded","db":"error"}'
      code="503"
    else
      body='{"status":"ok","db":"ok"}'
      code="200"
    fi
    ;;
  */pricing)
    code="${MOCK_PRICING_CODE:-200}"
    ;;
  */api/billing/webhook)
    code="${MOCK_WEBHOOK_CODE:-400}"
    body='{"error":"Missing signature"}'
    ;;
esac

if [ -n "$out_file" ] && [ "$out_file" != "/dev/null" ]; then
  printf '%s' "$body" > "$out_file"
fi
printf '%s' "$code"
EOF
chmod +x "$TMPDIR_TEST/bin/mock_curl"

cat > "$TMPDIR_TEST/bin/mock_docker" <<'EOF'
#!/usr/bin/env bash
sub="$1"; shift
case "$sub" in
  inspect)
    cname="${!#}"
    if [ "$cname" = "verifa_frontend" ] && [ "${MOCK_FE_UNHEALTHY:-0}" = "1" ]; then
      echo "running|unhealthy"
    elif [ "$cname" = "verifa_worker" ]; then
      echo "running|none"
    else
      echo "running|healthy"
    fi
    ;;
  exec)
    if [[ "$*" == *"localhost:8000/health"* ]]; then
      echo '{"ok":true,"timestamp":"2026-11-25T13:00:00Z"}'
    elif [[ "$*" == *"pg_isready"* ]]; then
      [ "${MOCK_PG_DOWN:-0}" = "1" ] && exit 1
      echo "accepting connections"
    elif [[ "$*" == *"SELECT 1"* ]]; then
      echo "1"
    elif [[ "$*" == *"PING"* ]]; then
      [ "${MOCK_REDIS_DOWN:-0}" = "1" ] && { echo "NOAUTH"; exit 0; }
      echo "PONG"
    fi
    ;;
esac
EOF
chmod +x "$TMPDIR_TEST/bin/mock_docker"

# Test 1: All HTTP + Docker + Postgres + Redis checks pass
out="$(CURL_BIN="$TMPDIR_TEST/bin/mock_curl" DOCKER_BIN="$TMPDIR_TEST/bin/mock_docker" \
  bash "$HC_SCRIPT" --env-file="$TMPDIR_TEST/.env" --retries=1 --retry-delay=0 --json)"
rc=$?
assert_eq "all-healthy exits 0" "0" "$rc"
summary="$(python3 -c 'import json,sys; d=json.loads(sys.argv[1]); print(d["status"], d["passed"], d["failed"])' "$out")"
assert_eq "all-healthy JSON reports PASS 14 0" "PASS 14 0" "$summary"

# Test 2: /pricing returning 500 fails healthcheck
rc=0
out="$(MOCK_PRICING_CODE=500 CURL_BIN="$TMPDIR_TEST/bin/mock_curl" DOCKER_BIN="$TMPDIR_TEST/bin/mock_docker" \
  bash "$HC_SCRIPT" --env-file="$TMPDIR_TEST/.env" --retries=1 --retry-delay=0 --json)" || rc=$?
assert_eq "pricing 500 exits 1" "1" "$rc"

# Test 3: /api/billing/webhook returning 404 fails healthcheck
rc=0
out="$(MOCK_WEBHOOK_CODE=404 CURL_BIN="$TMPDIR_TEST/bin/mock_curl" DOCKER_BIN="$TMPDIR_TEST/bin/mock_docker" \
  bash "$HC_SCRIPT" --env-file="$TMPDIR_TEST/.env" --retries=1 --retry-delay=0 --json)" || rc=$?
assert_eq "webhook 404 exits 1" "1" "$rc"

# Test 4: Unhealthy frontend container fails healthcheck
rc=0
out="$(MOCK_FE_UNHEALTHY=1 CURL_BIN="$TMPDIR_TEST/bin/mock_curl" DOCKER_BIN="$TMPDIR_TEST/bin/mock_docker" \
  bash "$HC_SCRIPT" --env-file="$TMPDIR_TEST/.env" --retries=1 --retry-delay=0 --json)" || rc=$?
assert_eq "unhealthy container exits 1" "1" "$rc"

# Test 5: Redis PING failure fails healthcheck
rc=0
out="$(MOCK_REDIS_DOWN=1 CURL_BIN="$TMPDIR_TEST/bin/mock_curl" DOCKER_BIN="$TMPDIR_TEST/bin/mock_docker" \
  bash "$HC_SCRIPT" --env-file="$TMPDIR_TEST/.env" --retries=1 --retry-delay=0 --json)" || rc=$?
assert_eq "redis failure exits 1" "1" "$rc"

# Test 6: --skip-docker runs only 5 HTTP checks
out="$(CURL_BIN="$TMPDIR_TEST/bin/mock_curl" DOCKER_BIN="$TMPDIR_TEST/bin/mock_docker" \
  bash "$HC_SCRIPT" --skip-docker --retries=1 --retry-delay=0 --json)"
rc=$?
assert_eq "skip-docker exits 0" "0" "$rc"
summary="$(python3 -c 'import json,sys; d=json.loads(sys.argv[1]); print(d["passed"])' "$out")"
assert_eq "skip-docker runs 5 HTTP checks" "5" "$summary"

echo "test_post_deploy_healthcheck.sh: pass=$PASS fail=$FAIL"
[ "$FAIL" -eq 0 ]
