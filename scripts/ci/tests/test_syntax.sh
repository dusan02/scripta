#!/usr/bin/env bash
# Syntax and static safety checks for all Stream 5 shell scripts and CI workflow.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
PASS=0
FAIL=0

assert_ok() {
  local label="$1"
  shift
  if "$@"; then
    echo "  [PASS] $label"
    PASS=$((PASS + 1))
  else
    echo "  [FAIL] $label"
    FAIL=$((FAIL + 1))
  fi
}

SCRIPTS=(
  "scripts/ci/pre-deploy-gate.sh"
  "scripts/ops/post-deploy-healthcheck.sh"
  "scripts/ops/rollback-release.sh"
  "scripts/ops/system-monitor.sh"
  "scripts/ci/tests/run-all.sh"
  "scripts/ci/tests/test_syntax.sh"
  "scripts/ci/tests/test_pre_deploy_gate.sh"
  "scripts/ci/tests/test_post_deploy_healthcheck.sh"
  "scripts/ci/tests/test_rollback_release.sh"
  "scripts/ci/tests/test_system_monitor.sh"
)

for rel in "${SCRIPTS[@]}"; do
  full="$REPO_ROOT/$rel"
  assert_ok "bash -n $rel" bash -n "$full"
  assert_ok "strict mode (set -euo pipefail) in $rel" grep -q "set -euo pipefail" "$full"
done

# Ensure rollback script never uses destructive volume flags
assert_ok "rollback-release.sh never runs 'compose down -v'" bash -c "! grep -qE 'compose[[:space:]]+down.*-v' '$REPO_ROOT/scripts/ops/rollback-release.sh'"

# Ensure CI workflow exists and has required jobs
WF="$REPO_ROOT/.github/workflows/ci-quality-gate.yml"
assert_ok "ci-quality-gate.yml exists" test -f "$WF"
assert_ok "ci-quality-gate.yml has scripts-and-ops-tests job" grep -q "scripts-and-ops-tests:" "$WF"
assert_ok "ci-quality-gate.yml has frontend-quality job" grep -q "frontend-quality:" "$WF"
assert_ok "ci-quality-gate.yml has frontend-build job" grep -q "frontend-build:" "$WF"
assert_ok "ci-quality-gate.yml has worker-tests job" grep -q "worker-tests:" "$WF"
assert_ok "ci-quality-gate.yml has quality-gate-summary job" grep -q "quality-gate-summary:" "$WF"

echo "test_syntax.sh: pass=$PASS fail=$FAIL"
[ "$FAIL" -eq 0 ]
