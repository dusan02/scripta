#!/usr/bin/env bash
# Runs all Stream 5 CI/Ops script tests and prints an aggregated summary.
set -euo pipefail

TESTS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TOTAL_PASS=0
TOTAL_FAIL=0

run_suite() {
  local script="$1"
  echo "=== Running $(basename "$script") ==="
  if bash "$script"; then
    TOTAL_PASS=$((TOTAL_PASS + 1))
  else
    TOTAL_FAIL=$((TOTAL_FAIL + 1))
  fi
}

run_suite "$TESTS_DIR/test_syntax.sh"
run_suite "$TESTS_DIR/test_pre_deploy_gate.sh"
run_suite "$TESTS_DIR/test_post_deploy_healthcheck.sh"
run_suite "$TESTS_DIR/test_rollback_release.sh"
run_suite "$TESTS_DIR/test_system_monitor.sh"

echo ""
echo "========================================"
echo "All Script Test Suites: pass=$TOTAL_PASS fail=$TOTAL_FAIL"
echo "========================================"

[ "$TOTAL_FAIL" -eq 0 ]
