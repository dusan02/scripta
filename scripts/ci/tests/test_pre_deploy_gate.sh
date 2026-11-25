#!/usr/bin/env bash
# Mock unit tests for scripts/ci/pre-deploy-gate.sh
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
GATE_SCRIPT="$REPO_ROOT/scripts/ci/pre-deploy-gate.sh"
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

# Build a fake repo layout with mock bins
FAKE_REPO="$TMPDIR_TEST/repo"
mkdir -p "$FAKE_REPO/frontend" "$FAKE_REPO/worker" "$FAKE_REPO/scripts/ci/tests" "$TMPDIR_TEST/bin"

cat > "$FAKE_REPO/scripts/ci/tests/run-all.sh" <<'EOF'
#!/usr/bin/env bash
exit 0
EOF
chmod +x "$FAKE_REPO/scripts/ci/tests/run-all.sh"

cat > "$TMPDIR_TEST/bin/mock_npx" <<'EOF'
#!/usr/bin/env bash
if [ "${FAIL_TSC:-0}" = "1" ]; then exit 1; fi
exit 0
EOF
chmod +x "$TMPDIR_TEST/bin/mock_npx"

cat > "$TMPDIR_TEST/bin/mock_npm" <<'EOF'
#!/usr/bin/env bash
cmd="${2:-}"
if [ "$cmd" = "lint" ] && [ "${FAIL_LINT:-0}" = "1" ]; then exit 1; fi
if [ "$cmd" = "test:unit" ] && [ "${FAIL_UNIT:-0}" = "1" ]; then exit 1; fi
if [ "$cmd" = "build" ] && [ "${FAIL_BUILD:-0}" = "1" ]; then exit 1; fi
exit 0
EOF
chmod +x "$TMPDIR_TEST/bin/mock_npm"

cat > "$TMPDIR_TEST/bin/mock_python" <<'EOF'
#!/usr/bin/env bash
if [ "${FAIL_PYTEST:-0}" = "1" ]; then exit 1; fi
exit 0
EOF
chmod +x "$TMPDIR_TEST/bin/mock_python"

# Test 1: All steps pass + JSON output is valid
out="$(REPO_ROOT="$FAKE_REPO" NPM_BIN="$TMPDIR_TEST/bin/mock_npm" NPX_BIN="$TMPDIR_TEST/bin/mock_npx" PYTHON_BIN="$TMPDIR_TEST/bin/mock_python" \
  bash "$GATE_SCRIPT" --json)"
rc=$?
assert_eq "all-pass exits 0" "0" "$rc"
parsed_status="$(python3 -c 'import json,sys; d=json.loads(sys.argv[1]); print(d["status"], d["passed"], d["failed"])' "$out")"
assert_eq "all-pass JSON reports PASS 6 0" "PASS 6 0" "$parsed_status"

# Test 2: TypeScript failure fails gate
rc=0
out="$(FAIL_TSC=1 REPO_ROOT="$FAKE_REPO" NPM_BIN="$TMPDIR_TEST/bin/mock_npm" NPX_BIN="$TMPDIR_TEST/bin/mock_npx" PYTHON_BIN="$TMPDIR_TEST/bin/mock_python" \
  bash "$GATE_SCRIPT" --json)" || rc=$?
assert_eq "tsc failure exits 1" "1" "$rc"
parsed_status="$(python3 -c 'import json,sys; d=json.loads(sys.argv[1]); print(d["status"], d["failed"])' "$out")"
assert_eq "tsc failure JSON reports FAIL 1" "FAIL 1" "$parsed_status"

# Test 3: Lint failure fails by default, warns with --allow-lint-warn
rc=0
FAIL_LINT=1 REPO_ROOT="$FAKE_REPO" NPM_BIN="$TMPDIR_TEST/bin/mock_npm" NPX_BIN="$TMPDIR_TEST/bin/mock_npx" PYTHON_BIN="$TMPDIR_TEST/bin/mock_python" \
  bash "$GATE_SCRIPT" --json >/dev/null || rc=$?
assert_eq "lint failure exits 1 by default" "1" "$rc"

rc=0
out="$(FAIL_LINT=1 REPO_ROOT="$FAKE_REPO" NPM_BIN="$TMPDIR_TEST/bin/mock_npm" NPX_BIN="$TMPDIR_TEST/bin/mock_npx" PYTHON_BIN="$TMPDIR_TEST/bin/mock_python" \
  bash "$GATE_SCRIPT" --allow-lint-warn --json)" || rc=$?
assert_eq "lint failure exits 0 with --allow-lint-warn" "0" "$rc"
parsed_warn="$(python3 -c 'import json,sys; d=json.loads(sys.argv[1]); print(d["warned"])' "$out")"
assert_eq "lint warning counted in JSON" "1" "$parsed_warn"

# Test 4: --skip-build and --skip-worker skip those steps
out="$(FAIL_BUILD=1 FAIL_PYTEST=1 REPO_ROOT="$FAKE_REPO" NPM_BIN="$TMPDIR_TEST/bin/mock_npm" NPX_BIN="$TMPDIR_TEST/bin/mock_npx" PYTHON_BIN="$TMPDIR_TEST/bin/mock_python" \
  bash "$GATE_SCRIPT" --skip-build --skip-worker --json)"
rc=$?
assert_eq "skip flags bypass failing build & worker" "0" "$rc"
parsed_skip="$(python3 -c 'import json,sys; d=json.loads(sys.argv[1]); print(d["skipped"])' "$out")"
assert_eq "skip count is 2" "2" "$parsed_skip"

echo "test_pre_deploy_gate.sh: pass=$PASS fail=$FAIL"
[ "$FAIL" -eq 0 ]
