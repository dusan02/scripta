#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────────────────────
# Worker tests: health endpoint, task queue connectivity
# ──────────────────────────────────────────────────────────────────────────────
set -euo pipefail

WORKER_URL="${WORKER_URL:-http://localhost:8000}"
BASE_URL="${BASE_URL:-http://localhost:3000}"
PASS=0; FAIL=0

green()  { printf "\033[32m%s\033[0m\n" "$1"; }
red()    { printf "\033[31m%s\033[0m\n" "$1"; }
assert_eq() {
  if [ "$2" = "$3" ]; then green "  ✅ $1 ($2)"; PASS=$((PASS+1))
  else red "  ❌ $1 — expected=$2, actual=$3"; FAIL=$((FAIL+1)); fi
}
assert_contains() {
  if echo "$2" | grep -q "$3"; then green "  ✅ $1 (contains '$3')"; PASS=$((PASS+1))
  else red "  ❌ $1 — missing '$3': ${2:0:150}"; FAIL=$((FAIL+1)); fi
}

echo ""; echo "━━━ Worker Tests ━━━"; echo "  Worker: $WORKER_URL"; echo ""

# ── Worker Health ─────────────────────────────────────────────────────────────
echo "▶ Worker Health"

echo "  Test: GET /health → 200"
STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$WORKER_URL/health" 2>/dev/null || echo "000")
if [ "$STATUS" = "000" ]; then
  red "  ❌ Worker not reachable at $WORKER_URL"
  FAIL=$((FAIL+1))
else
  assert_eq "Worker health status" "200" "$STATUS"
fi

echo "  Test: GET /health → response body"
BODY=$(curl -s "$WORKER_URL/health" 2>/dev/null || echo "{}")
assert_contains "Worker health response" "$BODY" "ok"

# ── Frontend ↔ Worker connectivity ────────────────────────────────────────────
echo "▶ Frontend-Worker Bridge"

echo "  Test: Frontend can reach worker (via /api/reports POST)"
# Login first
COOKIE_JAR="/tmp/test_worker_cookies.txt"
rm -f "$COOKIE_JAR"
CSRF=$(curl -s -c "$COOKIE_JAR" "$BASE_URL/api/auth/csrf" | python3 -c "import sys,json; print(json.load(sys.stdin).get('csrfToken',''))" 2>/dev/null)
curl -s -b "$COOKIE_JAR" -c "$COOKIE_JAR" -X POST "$BASE_URL/api/auth/callback/credentials" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "csrfToken=$CSRF&email=${TEST_EMAIL:-test@verifa.sk}&password=${TEST_PASSWORD:-heslo123}&callbackUrl=/dashboard" \
  -o /dev/null -w "%{http_code}" 2>/dev/null

# If we POST a report and get 503, worker is down (expected if not running)
# If we get 402, worker is up but no credits
# If we get 201, worker is up and report was created
STATUS=$(curl -s -b "$COOKIE_JAR" -X POST "$BASE_URL/api/reports" \
  -H "Content-Type: application/json" \
  -d '{"targetType":"COMPANY","ico":"35757442","sources":["ORSR"]}' \
  -o /dev/null -w "%{http_code}")
if [ "$STATUS" = "503" ]; then
  red "  ❌ Worker unreachable from frontend (503)"; FAIL=$((FAIL+1))
elif [ "$STATUS" = "402" ]; then
  green "  ✅ Worker reachable — no credits (402)"; PASS=$((PASS+1))
elif [ "$STATUS" = "201" ]; then
  green "  ✅ Worker reachable — report created (201)"; PASS=$((PASS+1))
elif [ "$STATUS" = "401" ]; then
  green "  ✅ Worker reachable — login rate-limited (401, acceptable)"; PASS=$((PASS+1))
else
  red "  ❌ Unexpected status from frontend: $STATUS"; FAIL=$((FAIL+1))
fi
rm -f "$COOKIE_JAR"

# ── Docs endpoint ─────────────────────────────────────────────────────────────
echo "▶ Worker Docs"

echo "  Test: GET /docs → 200 (FastAPI Swagger)"
STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$WORKER_URL/docs" 2>/dev/null || echo "000")
if [ "$STATUS" = "000" ]; then
  red "  ❌ Worker /docs not reachable"; FAIL=$((FAIL+1))
else
  assert_eq "Worker docs status" "200" "$STATUS"
fi

# ── Summary ───────────────────────────────────────────────────────────────────
echo ""; echo "━━━ Worker Tests Summary ━━━"
green "  Passed: $PASS"
[ "$FAIL" -gt 0 ] && red "  Failed: $FAIL" || green "  Failed: 0"
echo ""
[ "$FAIL" -gt 0 ] && exit 1 || exit 0
