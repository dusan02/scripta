#!/usr/bin/env bash
# Mock unit tests for scripts/ops/system-monitor.sh
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
MON_SCRIPT="$REPO_ROOT/scripts/ops/system-monitor.sh"
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
REDIS_PASSWORD=mock_pw
EOF

cat > "$TMPDIR_TEST/bin/mock_docker" <<'EOF'
#!/usr/bin/env bash
sub="$1"; shift
case "$sub" in
  stats)
    echo "${MOCK_FE_PIDS:-80}"
    ;;
  inspect)
    echo "${MOCK_FE_PIDS_LIMIT:-200}"
    ;;
  exec)
    if [[ "$*" == *"pg_stat_activity"* ]]; then
      if [ "${MOCK_PG_FAIL:-0}" = "1" ]; then exit 1; fi
      echo "${MOCK_PG_CONNS:-25}|${MOCK_PG_MAX:-100}"
    elif [[ "$*" == *"PING"* ]]; then
      if [ "${MOCK_REDIS_FAIL:-0}" = "1" ]; then echo "ERR"; exit 0; fi
      echo "PONG"
    elif [[ "$*" == *"INFO memory"* ]]; then
      printf 'used_memory:%s\r\nmaxmemory:%s\r\n' "${MOCK_REDIS_USED:-10485760}" "${MOCK_REDIS_MAX:-419430400}"
    fi
    ;;
esac
EOF
chmod +x "$TMPDIR_TEST/bin/mock_docker"

run_mon() {
  DOCKER_BIN="$TMPDIR_TEST/bin/mock_docker" \
  HOST_NAME="test-vps" \
  MOCK_CPU_PCT="${MOCK_CPU_PCT:-30}" \
  MOCK_RAM_PCT="${MOCK_RAM_PCT:-55}" \
  MOCK_DISK_PCT="${MOCK_DISK_PCT:-65}" \
    bash "$MON_SCRIPT" --env-file="$TMPDIR_TEST/.env" "$@"
}

# Test 1: Healthy system exits 0 with valid JSON and 0 alerts
out="$(run_mon --json)"
rc=$?
assert_eq "healthy state exits 0" "0" "$rc"
parsed="$(python3 -c 'import json,sys; d=json.loads(sys.argv[1]); print(d["status"], len(d["alerts"]), d["metrics"]["frontend_pids"]["percent"])' "$out")"
assert_eq "healthy JSON status=ok alerts=0 pids=40%" "ok 0 40" "$parsed"

# Test 2: High disk (85%) triggers WARN (exit 1)
rc=0
out="$(MOCK_DISK_PCT=85 run_mon --json)" || rc=$?
assert_eq "disk 85% exits 1 (WARN)" "1" "$rc"
parsed="$(python3 -c 'import json,sys; d=json.loads(sys.argv[1]); print(d["status"], len(d["alerts"]))' "$out")"
assert_eq "disk 85% JSON status=warn alerts=1" "warn 1" "$parsed"

# Test 3: High verifa_frontend PIDs (175/200 = 87%) triggers CRIT (exit 2)
rc=0
out="$(MOCK_FE_PIDS=175 run_mon --json)" || rc=$?
assert_eq "frontend PIDs 175/200 exits 2 (CRIT)" "2" "$rc"
parsed="$(python3 -c 'import json,sys; d=json.loads(sys.argv[1]); print(d["status"], "verifa_frontend_pids" in d["alerts"][0])' "$out")"
assert_eq "frontend PIDs alert emitted" "crit True" "$parsed"

# Test 4: Postgres connections 90/100 triggers CRIT (exit 2)
rc=0
out="$(MOCK_PG_CONNS=90 run_mon --json)" || rc=$?
assert_eq "postgres 90/100 conns exits 2 (CRIT)" "2" "$rc"

# Test 5: Redis PING failure triggers CRIT (exit 2)
rc=0
out="$(MOCK_REDIS_FAIL=1 run_mon --json)" || rc=$?
assert_eq "redis PING fail exits 2 (CRIT)" "2" "$rc"

# Test 6: --no-fail exits 0 even on CRIT
rc=0
out="$(MOCK_REDIS_FAIL=1 run_mon --json --no-fail)" || rc=$?
assert_eq "--no-fail exits 0 on CRIT" "0" "$rc"

echo "test_system_monitor.sh: pass=$PASS fail=$FAIL"
[ "$FAIL" -eq 0 ]
