#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────────────────────
# Integračné testy: API endpoints (reports, credits, settings, feedback, lookup)
# ──────────────────────────────────────────────────────────────────────────────
set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost:3000}"
TEST_EMAIL="${TEST_EMAIL:-test@verifa.sk}"
TEST_PASSWORD="${TEST_PASSWORD:-heslo123}"
COOKIE_JAR="/tmp/test_api_cookies.txt"
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
assert_not_contains() {
  if echo "$2" | grep -q "$3"; then red "  ❌ $1 — should NOT contain '$3'"; FAIL=$((FAIL+1))
  else green "  ✅ $1 (no '$3')"; PASS=$((PASS+1)); fi
}

echo ""; echo "━━━ API Integration Tests ━━━"; echo "  Target: $BASE_URL"; echo ""

# Login first
CSRF=$(curl -s -c "$COOKIE_JAR" "$BASE_URL/api/auth/csrf" | python3 -c "import sys,json; print(json.load(sys.stdin).get('csrfToken',''))" 2>/dev/null)
curl -s -b "$COOKIE_JAR" -c "$COOKIE_JAR" -X POST "$BASE_URL/api/auth/callback/credentials" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "csrfToken=$CSRF&email=$TEST_EMAIL&password=$TEST_PASSWORD&callbackUrl=/dashboard" \
  -o /dev/null -w "%{http_code}" 2>/dev/null

# ── Credits API ───────────────────────────────────────────────────────────────
echo "▶ Credits API"

echo "  Test: GET /api/credits → 200"
STATUS=$(curl -s -b "$COOKIE_JAR" -o /dev/null -w "%{http_code}" "$BASE_URL/api/credits")
assert_eq "Credits GET status" "200" "$STATUS"

echo "  Test: GET /api/credits → has usedThisMonth"
BODY=$(curl -s -b "$COOKIE_JAR" "$BASE_URL/api/credits")
assert_contains "Credits has usedThisMonth" "$BODY" "usedThisMonth"

echo "  Test: GET /api/credits/plan → 200"
STATUS=$(curl -s -b "$COOKIE_JAR" -o /dev/null -w "%{http_code}" "$BASE_URL/api/credits/plan")
assert_eq "Credits/plan GET status" "200" "$STATUS"

echo "  Test: GET /api/credits/plan → has remaining + monthly fields"
BODY=$(curl -s -b "$COOKIE_JAR" "$BASE_URL/api/credits/plan")
assert_contains "Plan has remaining" "$BODY" "remaining"
assert_contains "Plan has successfulReports" "$BODY" "successfulReports"
assert_contains "Plan has failedReports" "$BODY" "failedReports"
assert_contains "Plan has periodStart" "$BODY" "periodStart"

echo "  Test: GET /api/credits without auth → 401"
STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$BASE_URL/api/credits")
assert_eq "Credits without auth (401)" "401" "$STATUS"

# ── Reports API ───────────────────────────────────────────────────────────────
echo "▶ Reports API"

echo "  Test: GET /api/reports → 200"
STATUS=$(curl -s -b "$COOKIE_JAR" -o /dev/null -w "%{http_code}" "$BASE_URL/api/reports")
assert_eq "Reports GET status" "200" "$STATUS"

echo "  Test: GET /api/reports → has reports array + pagination"
BODY=$(curl -s -b "$COOKIE_JAR" "$BASE_URL/api/reports")
assert_contains "Reports has reports array" "$BODY" "reports"
assert_contains "Reports has total" "$BODY" "total"
assert_contains "Reports has totalPages" "$BODY" "totalPages"

echo "  Test: GET /api/reports with pagination params"
BODY=$(curl -s -b "$COOKIE_JAR" "$BASE_URL/api/reports?page=1&limit=5")
assert_contains "Reports pagination page=1" "$BODY" "\"page\":1"
assert_contains "Reports pagination limit=5" "$BODY" "\"limit\":5"

echo "  Test: POST /api/reports with invalid IČO → 400"
BODY=$(curl -s -b "$COOKIE_JAR" -X POST "$BASE_URL/api/reports" \
  -H "Content-Type: application/json" \
  -d '{"targetType":"COMPANY","ico":"123","sources":["ORSR"]}')
STATUS=$(curl -s -b "$COOKIE_JAR" -X POST "$BASE_URL/api/reports" \
  -H "Content-Type: application/json" \
  -d '{"targetType":"COMPANY","ico":"123","sources":["ORSR"]}' \
  -o /dev/null -w "%{http_code}")
assert_eq "Reports POST invalid IČO (400)" "400" "$STATUS"

echo "  Test: POST /api/reports with no sources → 400"
STATUS=$(curl -s -b "$COOKIE_JAR" -X POST "$BASE_URL/api/reports" \
  -H "Content-Type: application/json" \
  -d '{"targetType":"COMPANY","ico":"35757442","sources":[]}' \
  -o /dev/null -w "%{http_code}")
assert_eq "Reports POST no sources (400)" "400" "$STATUS"

echo "  Test: GET /api/reports without auth → 401"
STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$BASE_URL/api/reports")
assert_eq "Reports without auth (401)" "401" "$STATUS"

# ── Settings API ──────────────────────────────────────────────────────────────
echo "▶ Settings API"

echo "  Test: GET /api/settings → 200"
STATUS=$(curl -s -b "$COOKIE_JAR" -o /dev/null -w "%{http_code}" "$BASE_URL/api/settings")
assert_eq "Settings GET status" "200" "$STATUS"

echo "  Test: GET /api/settings → has orsrExtractType"
BODY=$(curl -s -b "$COOKIE_JAR" "$BASE_URL/api/settings")
assert_contains "Settings has orsrExtractType" "$BODY" "orsrExtractType"
assert_contains "Settings has defaultSources" "$BODY" "defaultSources"
assert_contains "Settings has reportLanguage" "$BODY" "reportLanguage"

echo "  Test: PATCH /api/settings with invalid orsrExtractType → 400"
STATUS=$(curl -s -b "$COOKIE_JAR" -X PATCH "$BASE_URL/api/settings" \
  -H "Content-Type: application/json" \
  -d '{"orsrExtractType":"INVALID"}' \
  -o /dev/null -w "%{http_code}")
assert_eq "Settings PATCH invalid extract type (400)" "400" "$STATUS"

echo "  Test: PATCH /api/settings with no fields → 400"
STATUS=$(curl -s -b "$COOKIE_JAR" -X PATCH "$BASE_URL/api/settings" \
  -H "Content-Type: application/json" \
  -d '{}' \
  -o /dev/null -w "%{http_code}")
assert_eq "Settings PATCH no fields (400)" "400" "$STATUS"

echo "  Test: GET /api/settings without auth → 401"
STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$BASE_URL/api/settings")
assert_eq "Settings without auth (401)" "401" "$STATUS"

# ── Feedback API ──────────────────────────────────────────────────────────────
echo "▶ Feedback API"

echo "  Test: POST /api/feedback with valid data → 200"
BODY=$(curl -s -b "$COOKIE_JAR" -X POST "$BASE_URL/api/feedback" \
  -H "Content-Type: application/json" \
  -d '{"category":"QUESTION","message":"Test feedback from integration tests"}')
assert_contains "Feedback POST returns ok" "$BODY" "ok"

echo "  Test: POST /api/feedback with invalid category → 400"
STATUS=$(curl -s -b "$COOKIE_JAR" -X POST "$BASE_URL/api/feedback" \
  -H "Content-Type: application/json" \
  -d '{"category":"INVALID","message":"test"}' \
  -o /dev/null -w "%{http_code}")
assert_eq "Feedback POST invalid category (400)" "400" "$STATUS"

echo "  Test: POST /api/feedback with empty message → 400"
STATUS=$(curl -s -b "$COOKIE_JAR" -X POST "$BASE_URL/api/feedback" \
  -H "Content-Type: application/json" \
  -d '{"category":"BUG","message":""}' \
  -o /dev/null -w "%{http_code}")
assert_eq "Feedback POST empty message (400)" "400" "$STATUS"

echo "  Test: POST /api/feedback without auth → 401"
STATUS=$(curl -s -X POST "$BASE_URL/api/feedback" \
  -H "Content-Type: application/json" \
  -d '{"category":"BUG","message":"test"}' \
  -o /dev/null -w "%{http_code}")
assert_eq "Feedback without auth (401)" "401" "$STATUS"

# ── Lookup API ────────────────────────────────────────────────────────────────
echo "▶ Lookup API"

echo "  Test: GET /api/lookup?ico=35757442 → 200 with companyName"
BODY=$(curl -s -b "$COOKIE_JAR" "$BASE_URL/api/lookup?ico=35757442")
assert_contains "Lookup found company" "$BODY" "found"
assert_contains "Lookup has companyName" "$BODY" "companyName"

echo "  Test: GET /api/lookup with invalid IČO → 400"
STATUS=$(curl -s -b "$COOKIE_JAR" -o /dev/null -w "%{http_code}" "$BASE_URL/api/lookup?ico=abc")
assert_eq "Lookup invalid IČO (400)" "400" "$STATUS"

echo "  Test: GET /api/lookup without auth → 401"
STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$BASE_URL/api/lookup?ico=35757442")
assert_eq "Lookup without auth (401)" "401" "$STATUS"

# ── Summary ───────────────────────────────────────────────────────────────────
echo ""; echo "━━━ API Tests Summary ━━━"
green "  Passed: $PASS"
[ "$FAIL" -gt 0 ] && red "  Failed: $FAIL" || green "  Failed: 0"
echo ""; rm -f "$COOKIE_JAR"
[ "$FAIL" -gt 0 ] && exit 1 || exit 0
