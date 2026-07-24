#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────────────────────
# Integračné testy: Auth flow (login, logout, session, CSRF)
#
# Spustenie:
#   BASE_URL=https://verifa.sk TEST_EMAIL=dusan02@gmail.com TEST_PASSWORD=22222222 \
#     bash tests/integration/test_auth.sh
#
# Alebo s predvolenými hodnotami (localhost):
#   bash tests/integration/test_auth.sh
# ──────────────────────────────────────────────────────────────────────────────
set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost:3000}"
TEST_EMAIL="${TEST_EMAIL:-test@verifa.sk}"
TEST_PASSWORD="${TEST_PASSWORD:-heslo123}"
COOKIE_JAR="/tmp/test_auth_cookies.txt"
PASS=0
FAIL=0
SKIP=0

rm -f "$COOKIE_JAR"

# ── Helpers ───────────────────────────────────────────────────────────────────
green()  { printf "\033[32m%s\033[0m\n" "$1"; }
red()    { printf "\033[31m%s\033[0m\n" "$1"; }
yellow() { printf "\033[33m%s\033[0m\n" "$1"; }

assert_eq() {
  local label="$1" expected="$2" actual="$3"
  if [ "$expected" = "$actual" ]; then
    green "  ✅ $label (expected=$expected, actual=$actual)"
    PASS=$((PASS + 1))
  else
    red "  ❌ $label — expected=$expected, actual=$actual"
    FAIL=$((FAIL + 1))
  fi
}

assert_contains() {
  local label="$1" haystack="$2" needle="$3"
  if echo "$haystack" | grep -q "$needle"; then
    green "  ✅ $label (contains '$needle')"
    PASS=$((PASS + 1))
  else
    red "  ❌ $label — expected to contain '$needle', got: ${haystack:0:200}"
    FAIL=$((FAIL + 1))
  fi
}

assert_not_contains() {
  local label="$1" haystack="$2" needle="$3"
  if echo "$haystack" | grep -q "$needle"; then
    red "  ❌ $label — should NOT contain '$needle', but it does"
    FAIL=$((FAIL + 1))
  else
    green "  ✅ $label (does not contain '$needle')"
    PASS=$((PASS + 1))
  fi
}

# ── Tests ─────────────────────────────────────────────────────────────────────

echo ""
echo "━━━ Auth Integration Tests ━━━"
echo "  Target: $BASE_URL"
echo ""

# 1. Login page loads
echo "▶ Test: Login page loads (200)"
STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$BASE_URL/login")
assert_eq "Login page HTTP status" "200" "$STATUS"

# 2. CSRF token endpoint
echo "▶ Test: CSRF token endpoint returns token"
CSRF=$(curl -s -c "$COOKIE_JAR" "$BASE_URL/api/auth/csrf" | python3 -c "import sys,json; print(json.load(sys.stdin).get('csrfToken',''))" 2>/dev/null || echo "")
if [ -n "$CSRF" ] && [ "$CSRF" != "" ]; then
  green "  ✅ CSRF token obtained (${CSRF:0:16}...)"
  PASS=$((PASS + 1))
else
  red "  ❌ CSRF token not obtained"
  FAIL=$((FAIL + 1))
fi

# 3. Login with valid credentials
echo "▶ Test: Login with valid credentials → 302 redirect"
LOGIN_REDIRECT=$(curl -s -b "$COOKIE_JAR" -c "$COOKIE_JAR" \
  -X POST "$BASE_URL/api/auth/callback/credentials" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "csrfToken=$CSRF&email=$TEST_EMAIL&password=$TEST_PASSWORD&callbackUrl=/dashboard" \
  -o /dev/null -w "%{redirect_url}" 2>/dev/null || echo "")
assert_contains "Login redirect to /dashboard" "$LOGIN_REDIRECT" "/dashboard"

# 4. Session has user
echo "▶ Test: Session contains authenticated user"
SESSION_USER=$(curl -s -b "$COOKIE_JAR" "$BASE_URL/api/auth/session" | \
  python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('user',{}).get('email','NONE'))" 2>/dev/null || echo "NONE")
assert_eq "Session user email" "$TEST_EMAIL" "$SESSION_USER"

# 5. Auth providers (should be credentials + google only)
echo "▶ Test: Auth providers list (credentials + google, no azure)"
PROVIDERS=$(curl -s "$BASE_URL/api/auth/providers" | \
  python3 -c "import sys,json; print(','.join(sorted(json.load(sys.stdin).keys())))" 2>/dev/null || echo "")
assert_eq "Auth providers" "credentials,google" "$PROVIDERS"

# 6. Login with wrong password
echo "▶ Test: Login with wrong password → error redirect"
rm -f /tmp/test_auth_bad_cookies.txt
BAD_CSRF=$(curl -s -c /tmp/test_auth_bad_cookies.txt "$BASE_URL/api/auth/csrf" | \
  python3 -c "import sys,json; print(json.load(sys.stdin).get('csrfToken',''))" 2>/dev/null || echo "")
BAD_REDIRECT=$(curl -s -b /tmp/test_auth_bad_cookies.txt -c /tmp/test_auth_bad_cookies.txt \
  -X POST "$BASE_URL/api/auth/callback/credentials" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "csrfToken=$BAD_CSRF&email=$TEST_EMAIL&password=wrongpassword123&callbackUrl=/dashboard" \
  -o /dev/null -w "%{redirect_url}" 2>/dev/null || echo "")
assert_contains "Wrong password redirect to error" "$BAD_REDIRECT" "error"
rm -f /tmp/test_auth_bad_cookies.txt

# 7. Protected route with auth → 200
echo "▶ Test: /dashboard with auth → 200"
STATUS=$(curl -s -b "$COOKIE_JAR" -o /dev/null -w "%{http_code}" "$BASE_URL/dashboard")
assert_eq "Dashboard with auth" "200" "$STATUS"

# 8. Protected route without auth → 307
echo "▶ Test: /dashboard without auth → 307 redirect"
STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$BASE_URL/dashboard")
assert_eq "Dashboard without auth (307)" "307" "$STATUS"

# 9. /documents without auth → 307
echo "▶ Test: /documents without auth → 307 redirect"
STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$BASE_URL/documents")
assert_eq "Documents without auth (307)" "307" "$STATUS"

# 10. /credits without auth → 307
echo "▶ Test: /credits without auth → 307 redirect"
STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$BASE_URL/credits")
assert_eq "Credits without auth (307)" "307" "$STATUS"

# 11. Public routes → 200
echo "▶ Test: Public auth routes → 200"
for route in /login /register /forgot-password /reset-password; do
  STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$BASE_URL$route")
  assert_eq "$route (public, 200)" "200" "$STATUS"
done

# 12. Logout
echo "▶ Test: Logout clears session"
curl -s -b "$COOKIE_JAR" -c "$COOKIE_JAR" "$BASE_URL/api/auth/signout" -o /dev/null
# NextAuth signout via GET may not work — try POST with CSRF
LOGOUT_CSRF=$(curl -s -b "$COOKIE_JAR" "$BASE_URL/api/auth/csrf" | \
  python3 -c "import sys,json; print(json.load(sys.stdin).get('csrfToken',''))" 2>/dev/null || echo "")
curl -s -b "$COOKIE_JAR" -c "$COOKIE_JAR" \
  -X POST "$BASE_URL/api/auth/signout" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "csrfToken=$LOGOUT_CSRF" \
  -o /dev/null -w "%{http_code}" 2>/dev/null || true
SESSION_AFTER=$(curl -s -b "$COOKIE_JAR" "$BASE_URL/api/auth/session" | \
  python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('user',{}).get('email','NONE'))" 2>/dev/null || echo "NONE")
assert_eq "Session after logout" "NONE" "$SESSION_AFTER"

# ── Summary ───────────────────────────────────────────────────────────────────
echo ""
echo "━━━ Auth Tests Summary ━━━"
green "  Passed: $PASS"
[ "$FAIL" -gt 0 ] && red "  Failed: $FAIL" || green "  Failed: 0"
[ "$SKIP" -gt 0 ] && yellow "  Skipped: $SKIP"
echo ""

rm -f "$COOKIE_JAR"
[ "$FAIL" -gt 0 ] && exit 1 || exit 0
