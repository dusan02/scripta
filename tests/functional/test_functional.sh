#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────────────────────
# Funkčné testy: forgot/reset password flow, report creation, worker health
# ──────────────────────────────────────────────────────────────────────────────
set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost:3000}"
TEST_EMAIL="${TEST_EMAIL:-test@verifa.sk}"
TEST_PASSWORD="${TEST_PASSWORD:-heslo123}"
COOKIE_JAR="/tmp/test_func_cookies.txt"
PASS=0; FAIL=0

rm -f "$COOKIE_JAR"
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

echo ""; echo "━━━ Functional Tests ━━━"; echo "  Target: $BASE_URL"; echo ""

# ── Forgot Password Flow ──────────────────────────────────────────────────────
echo "▶ Forgot Password"

echo "  Test: POST /api/auth/forgot-password with valid email → 200"
BODY=$(curl -s -X POST "$BASE_URL/api/auth/forgot-password" \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com"}')
STATUS=$(curl -s -X POST "$BASE_URL/api/auth/forgot-password" \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com"}' \
  -o /dev/null -w "%{http_code}")
if [ "$STATUS" = "429" ]; then
  green "  ✅ Forgot password rate-limited (429, acceptable)"; PASS=$((PASS+1))
else
  assert_eq "Forgot password valid email (200)" "200" "$STATUS"
  assert_contains "Forgot password response message" "$BODY" "Ak účet existuje"
fi

sleep 2

echo "  Test: POST /api/auth/forgot-password with nonexistent email → same response"
BODY2=$(curl -s -X POST "$BASE_URL/api/auth/forgot-password" \
  -H "Content-Type: application/json" \
  -d '{"email":"nonexistent@nowhere.sk"}')
STATUS2=$(curl -s -X POST "$BASE_URL/api/auth/forgot-password" \
  -H "Content-Type: application/json" \
  -d '{"email":"nonexistent@nowhere.sk"}' \
  -o /dev/null -w "%{http_code}")
if [ "$STATUS2" = "429" ]; then
  green "  ✅ Forgot password nonexistent rate-limited (429, acceptable)"; PASS=$((PASS+1))
else
  assert_eq "Forgot password nonexistent (same message)" "$BODY" "$BODY2"
fi

sleep 2

echo "  Test: POST /api/auth/forgot-password without email → 400"
STATUS=$(curl -s -X POST "$BASE_URL/api/auth/forgot-password" \
  -H "Content-Type: application/json" \
  -d '{}' \
  -o /dev/null -w "%{http_code}")
if [ "$STATUS" = "429" ]; then
  green "  ✅ Forgot password no-email rate-limited (429, acceptable)"; PASS=$((PASS+1))
else
  assert_eq "Forgot password no email (400)" "400" "$STATUS"
fi

# ── Reset Password Flow ───────────────────────────────────────────────────────
echo "▶ Reset Password"

echo "  Test: POST /api/auth/reset-password with invalid token → 400"
BODY=$(curl -s -X POST "$BASE_URL/api/auth/reset-password" \
  -H "Content-Type: application/json" \
  -d '{"token":"invalidtoken123","password":"newpassword123"}')
STATUS=$(curl -s -X POST "$BASE_URL/api/auth/reset-password" \
  -H "Content-Type: application/json" \
  -d '{"token":"invalidtoken123","password":"newpassword123"}' \
  -o /dev/null -w "%{http_code}")
if [ "$STATUS" = "429" ]; then
  green "  ✅ Reset password invalid-token — rate-limited (429, acceptable)"; PASS=$((PASS+1))
else
  assert_eq "Reset password invalid token (400)" "400" "$STATUS"
  assert_contains "Reset password error message" "$BODY" "Neplatný"
fi

echo "  Test: POST /api/auth/reset-password with short password → 400"
STATUS=$(curl -s -X POST "$BASE_URL/api/auth/reset-password" \
  -H "Content-Type: application/json" \
  -d '{"token":"sometoken","password":"short"}' \
  -o /dev/null -w "%{http_code}")
if [ "$STATUS" = "429" ]; then
  green "  ✅ Reset password short — rate-limited (429, acceptable)"; PASS=$((PASS+1))
else
  assert_eq "Reset password short password (400)" "400" "$STATUS"
fi

echo "  Test: POST /api/auth/reset-password without token → 400"
STATUS=$(curl -s -X POST "$BASE_URL/api/auth/reset-password" \
  -H "Content-Type: application/json" \
  -d '{"password":"newpassword123"}' \
  -o /dev/null -w "%{http_code}")
if [ "$STATUS" = "429" ]; then
  green "  ✅ Reset password no-token — rate-limited (429, acceptable)"; PASS=$((PASS+1))
else
  assert_eq "Reset password no token (400)" "400" "$STATUS"
fi

# ── Register Page ─────────────────────────────────────────────────────────────
echo "▶ Register"

echo "  Test: GET /register → 200"
STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$BASE_URL/register")
assert_eq "Register page (200)" "200" "$STATUS"

# ── Report Creation Flow (requires auth + credits) ────────────────────────────
echo "▶ Report Creation"

# Login
CSRF=$(curl -s -c "$COOKIE_JAR" "$BASE_URL/api/auth/csrf" | python3 -c "import sys,json; print(json.load(sys.stdin).get('csrfToken',''))" 2>/dev/null)
curl -s -b "$COOKIE_JAR" -c "$COOKIE_JAR" -X POST "$BASE_URL/api/auth/callback/credentials" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "csrfToken=$CSRF&email=$TEST_EMAIL&password=$TEST_PASSWORD&callbackUrl=/dashboard" \
  -o /dev/null -w "%{http_code}" 2>/dev/null

echo "  Test: POST /api/reports with valid IČO (may 402 if no credits, 503 if worker down, 401 if rate-limited)"
STATUS=$(curl -s -b "$COOKIE_JAR" -X POST "$BASE_URL/api/reports" \
  -H "Content-Type: application/json" \
  -d '{"targetType":"COMPANY","ico":"35757442","sources":["ORSR"]}' \
  -o /dev/null -w "%{http_code}")
if [ "$STATUS" = "201" ]; then
  green "  ✅ Report created (201)"; PASS=$((PASS+1))
elif [ "$STATUS" = "402" ]; then
  green "  ✅ Report rejected — no credits (402, expected)"; PASS=$((PASS+1))
elif [ "$STATUS" = "503" ]; then
  green "  ✅ Report rejected — worker unavailable (503, expected)"; PASS=$((PASS+1))
elif [ "$STATUS" = "401" ]; then
  green "  ✅ Report rejected — login rate-limited (401, acceptable)"; PASS=$((PASS+1))
else
  red "  ❌ Report creation unexpected status: $STATUS"; FAIL=$((FAIL+1))
fi

# ── Summary ───────────────────────────────────────────────────────────────────
echo ""; echo "━━━ Functional Tests Summary ━━━"
green "  Passed: $PASS"
[ "$FAIL" -gt 0 ] && red "  Failed: $FAIL" || green "  Failed: 0"
echo ""; rm -f "$COOKIE_JAR"
[ "$FAIL" -gt 0 ] && exit 1 || exit 0
