#!/usr/bin/env bash
# ─── Verifa Pre-Deploy Quality Gate ─────────────────────────────────────────
#
# Runs the local pre-deploy verification suite before shipping a release:
#   1. CI & Ops shell script syntax + unit tests
#   2. Frontend TypeScript typecheck (tsc --noEmit)
#   3. Frontend ESLint (npm run lint)
#   4. Frontend unit tests (npm run test:unit)
#   5. Frontend Next.js production build (npm run build)
#   6. Worker Python unit tests (pytest -m "not integration")
#
# Usage:
#   bash scripts/ci/pre-deploy-gate.sh [options]
#
# Options:
#   --skip-scripts      Skip CI/Ops shell script tests
#   --skip-frontend     Skip all frontend checks
#   --skip-build        Skip Next.js build check (still runs tsc, lint, unit tests)
#   --skip-worker       Skip worker pytest suite
#   --allow-lint-warn   Do not fail gate on ESLint non-zero exit (still reports)
#   --json              Emit machine-readable JSON summary to stdout
#   -h, --help          Show this help message
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="${REPO_ROOT:-$(cd "$SCRIPT_DIR/../.." && pwd)}"

NPM_BIN="${NPM_BIN:-npm}"
NPX_BIN="${NPX_BIN:-npx}"
PYTHON_BIN="${PYTHON_BIN:-}"

SKIP_SCRIPTS=false
SKIP_FRONTEND=false
SKIP_BUILD=false
SKIP_WORKER=false
ALLOW_LINT_WARN=false
JSON_OUTPUT=false

for arg in "$@"; do
  case "$arg" in
    --skip-scripts) SKIP_SCRIPTS=true ;;
    --skip-frontend) SKIP_FRONTEND=true ;;
    --skip-build) SKIP_BUILD=true ;;
    --skip-worker) SKIP_WORKER=true ;;
    --allow-lint-warn) ALLOW_LINT_WARN=true ;;
    --json) JSON_OUTPUT=true ;;
    -h|--help)
      sed -n '2,22p' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *)
      echo "ERROR: Unknown option: $arg (use --help)" >&2
      exit 2
      ;;
  esac
done

PASS_COUNT=0
FAIL_COUNT=0
SKIP_COUNT=0
WARN_COUNT=0

STEP_NAMES=()
STEP_STATUSES=()
STEP_DURATIONS=()

log_human() {
  if [ "$JSON_OUTPUT" = false ]; then
    echo "$@"
  fi
}

resolve_python() {
  if [ -n "$PYTHON_BIN" ]; then
    echo "$PYTHON_BIN"
    return 0
  fi
  if [ -x "$REPO_ROOT/worker/.venv/bin/python" ]; then
    echo "$REPO_ROOT/worker/.venv/bin/python"
    return 0
  fi
  if [ -x "$REPO_ROOT/.venv/bin/python" ]; then
    echo "$REPO_ROOT/.venv/bin/python"
    return 0
  fi
  if command -v python3 >/dev/null 2>&1; then
    command -v python3
    return 0
  fi
  if command -v python >/dev/null 2>&1; then
    command -v python
    return 0
  fi
  echo ""
}

record_step() {
  local name="$1"
  local status="$2"
  local duration="$3"
  STEP_NAMES+=("$name")
  STEP_STATUSES+=("$status")
  STEP_DURATIONS+=("$duration")
  case "$status" in
    PASS) PASS_COUNT=$((PASS_COUNT + 1)) ;;
    FAIL) FAIL_COUNT=$((FAIL_COUNT + 1)) ;;
    WARN) WARN_COUNT=$((WARN_COUNT + 1)) ;;
    SKIP) SKIP_COUNT=$((SKIP_COUNT + 1)) ;;
  esac
}

run_step() {
  local name="$1"
  local allow_warn="$2"
  shift 2

  local start_ts end_ts elapsed
  start_ts="$(date +%s)"
  log_human ""
  log_human "── [$name] ──"

  local rc=0
  if [ "$JSON_OUTPUT" = true ]; then
    "$@" >/dev/null 2>&1 || rc=$?
  else
    "$@" || rc=$?
  fi

  end_ts="$(date +%s)"
  elapsed=$((end_ts - start_ts))

  if [ "$rc" -eq 0 ]; then
    log_human "  [PASS] $name (${elapsed}s)"
    record_step "$name" "PASS" "$elapsed"
  elif [ "$allow_warn" = "true" ]; then
    log_human "  [WARN] $name exited $rc (${elapsed}s, --allow-lint-warn)"
    record_step "$name" "WARN" "$elapsed"
  else
    log_human "  [FAIL] $name exited $rc (${elapsed}s)"
    record_step "$name" "FAIL" "$elapsed"
  fi
}

log_human "=== Verifa Pre-Deploy Quality Gate ==="
log_human "Repo: $REPO_ROOT"

# 1. CI & Ops Shell Script Tests
if [ "$SKIP_SCRIPTS" = true ]; then
  record_step "scripts_tests" "SKIP" "0"
else
  if [ -f "$REPO_ROOT/scripts/ci/tests/run-all.sh" ]; then
    run_step "scripts_tests" "false" bash "$REPO_ROOT/scripts/ci/tests/run-all.sh"
  else
    log_human "  [FAIL] scripts/ci/tests/run-all.sh not found"
    record_step "scripts_tests" "FAIL" "0"
  fi
fi

# 2-5. Frontend checks
if [ "$SKIP_FRONTEND" = true ]; then
  record_step "frontend_typecheck" "SKIP" "0"
  record_step "frontend_lint" "SKIP" "0"
  record_step "frontend_unit_tests" "SKIP" "0"
  record_step "frontend_build" "SKIP" "0"
else
  FE_DIR="$REPO_ROOT/frontend"
  if [ ! -d "$FE_DIR" ]; then
    log_human "  [FAIL] frontend directory not found at $FE_DIR"
    record_step "frontend_typecheck" "FAIL" "0"
    record_step "frontend_lint" "FAIL" "0"
    record_step "frontend_unit_tests" "FAIL" "0"
    record_step "frontend_build" "FAIL" "0"
  else
    run_fe_cmd() {
      (cd "$FE_DIR" && "$@")
    }

    run_step "frontend_typecheck" "false" run_fe_cmd "$NPX_BIN" tsc --noEmit
    run_step "frontend_lint" "$ALLOW_LINT_WARN" run_fe_cmd "$NPM_BIN" run lint
    run_step "frontend_unit_tests" "false" run_fe_cmd "$NPM_BIN" run test:unit

    if [ "$SKIP_BUILD" = true ]; then
      record_step "frontend_build" "SKIP" "0"
    else
      run_fe_build() {
        (
          cd "$FE_DIR"
          export DATABASE_URL="${DATABASE_URL:-postgresql://dummy:dummy@localhost:5432/dummy}"
          export DATABASE_URL_UNPOOLED="${DATABASE_URL_UNPOOLED:-$DATABASE_URL}"
          export NEXTAUTH_SECRET="${NEXTAUTH_SECRET:-local-predeploy-gate-ephemeral-secret}"
          export NEXTAUTH_URL="${NEXTAUTH_URL:-http://localhost:3000}"
          "$NPM_BIN" run build
        )
      }
      run_step "frontend_build" "false" run_fe_build
    fi
  fi
fi

# 6. Worker Pytest
if [ "$SKIP_WORKER" = true ]; then
  record_step "worker_pytest" "SKIP" "0"
else
  WORKER_DIR="$REPO_ROOT/worker"
  PY="$(resolve_python)"
  if [ ! -d "$WORKER_DIR" ] || [ -z "$PY" ]; then
    log_human "  [FAIL] worker dir or python interpreter not found"
    record_step "worker_pytest" "FAIL" "0"
  else
    run_worker_pytest() {
      (cd "$WORKER_DIR" && "$PY" -m pytest tests/ -q --tb=short -m "not integration")
    }
    run_step "worker_pytest" "false" run_worker_pytest
  fi
fi

OVERALL="PASS"
EXIT_CODE=0
if [ "$FAIL_COUNT" -gt 0 ]; then
  OVERALL="FAIL"
  EXIT_CODE=1
fi

if [ "$JSON_OUTPUT" = true ]; then
  printf '{"status":"%s","passed":%d,"failed":%d,"warned":%d,"skipped":%d,"steps":[' \
    "$OVERALL" "$PASS_COUNT" "$FAIL_COUNT" "$WARN_COUNT" "$SKIP_COUNT"
  for i in "${!STEP_NAMES[@]}"; do
    [ "$i" -gt 0 ] && printf ','
    printf '{"name":"%s","status":"%s","duration_sec":%d}' \
      "${STEP_NAMES[$i]}" "${STEP_STATUSES[$i]}" "${STEP_DURATIONS[$i]}"
  done
  printf ']}\n'
else
  echo ""
  echo "=== Pre-Deploy Gate Summary ==="
  for i in "${!STEP_NAMES[@]}"; do
    printf "  %-22s %-6s (%ss)\n" "${STEP_NAMES[$i]}" "${STEP_STATUSES[$i]}" "${STEP_DURATIONS[$i]}"
  done
  echo "-------------------------------"
  echo "Result: $OVERALL (pass=$PASS_COUNT fail=$FAIL_COUNT warn=$WARN_COUNT skip=$SKIP_COUNT)"
fi

exit "$EXIT_CODE"
