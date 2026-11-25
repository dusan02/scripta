#!/usr/bin/env bash
# Mock unit tests for scripts/ops/rollback-release.sh
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
RB_SCRIPT="$REPO_ROOT/scripts/ops/rollback-release.sh"
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

assert_contains() {
  local label="$1" needle="$2" haystack="$3"
  if printf '%s' "$haystack" | grep -q -- "$needle"; then
    echo "  [PASS] $label"
    PASS=$((PASS + 1))
  else
    echo "  [FAIL] $label (missing '$needle')"
    FAIL=$((FAIL + 1))
  fi
}

mkdir -p "$TMPDIR_TEST/bin" "$TMPDIR_TEST/project"
LOG_FILE="$TMPDIR_TEST/docker.log"
: > "$LOG_FILE"

cat > "$TMPDIR_TEST/bin/mock_docker" <<EOF
#!/usr/bin/env bash
echo "\$*" >> "$LOG_FILE"
if [ "\$1" = "image" ] && [ "\$2" = "inspect" ]; then
  target="\${!#}"
  if [ "\${MOCK_MISSING_TAG:-0}" = "1" ] && [[ "\$target" == *":rollback" ]]; then
    exit 1
  fi
  echo "sha256:abcdef1234567890"
  exit 0
fi
exit 0
EOF
chmod +x "$TMPDIR_TEST/bin/mock_docker"

cat > "$TMPDIR_TEST/bin/mock_healthcheck.sh" <<EOF
#!/usr/bin/env bash
echo "HEALTHCHECK \$*" >> "$LOG_FILE"
exit 0
EOF
chmod +x "$TMPDIR_TEST/bin/mock_healthcheck.sh"

# Test 1: Dry-run verifies tags without calling docker tag or compose up
: > "$LOG_FILE"
DOCKER_BIN="$TMPDIR_TEST/bin/mock_docker" HEALTHCHECK_SCRIPT="$TMPDIR_TEST/bin/mock_healthcheck.sh" WAIT_AFTER_UP=0 \
  bash "$RB_SCRIPT" --service=all --project-dir="$TMPDIR_TEST/project" --dry-run >/dev/null
rc=$?
assert_eq "dry-run exits 0" "0" "$rc"
log_content="$(cat "$LOG_FILE")"
if printf '%s' "$log_content" | grep -qE "^(tag |compose )"; then
  echo "  [FAIL] dry-run must not invoke docker tag or compose"
  FAIL=$((FAIL + 1))
else
  echo "  [PASS] dry-run does not mutate containers or tags"
  PASS=$((PASS + 1))
fi

# Test 2: Missing :rollback tag aborts safely with non-zero exit
: > "$LOG_FILE"
rc=0
MOCK_MISSING_TAG=1 DOCKER_BIN="$TMPDIR_TEST/bin/mock_docker" WAIT_AFTER_UP=0 \
  bash "$RB_SCRIPT" --service=frontend --project-dir="$TMPDIR_TEST/project" --yes >/dev/null 2>&1 || rc=$?
assert_eq "missing rollback tag exits 1" "1" "$rc"

# Test 3: Non-interactive execution without --yes is refused
rc=0
DOCKER_BIN="$TMPDIR_TEST/bin/mock_docker" WAIT_AFTER_UP=0 \
  bash "$RB_SCRIPT" --service=frontend --project-dir="$TMPDIR_TEST/project" </dev/null >/dev/null 2>&1 || rc=$?
assert_eq "non-interactive without --yes exits 2" "2" "$rc"

# Test 4: Full frontend rollback with --yes preserves backup tag, uses --no-deps, and runs healthcheck
: > "$LOG_FILE"
DOCKER_BIN="$TMPDIR_TEST/bin/mock_docker" HEALTHCHECK_SCRIPT="$TMPDIR_TEST/bin/mock_healthcheck.sh" WAIT_AFTER_UP=0 \
  bash "$RB_SCRIPT" --service=frontend --project-dir="$TMPDIR_TEST/project" --base-url="https://verifa.sk" --yes >/dev/null
rc=$?
assert_eq "frontend rollback exits 0" "0" "$rc"
log_content="$(cat "$LOG_FILE")"
assert_contains "saves pre-rollback backup tag" "tag verifa-frontend:latest verifa-frontend:pre-rollback-" "$log_content"
assert_contains "retags :rollback to :latest" "tag verifa-frontend:rollback verifa-frontend:latest" "$log_content"
assert_contains "uses --no-deps --no-build --force-recreate" "compose up -d --force-recreate --no-build --no-deps frontend" "$log_content"
assert_contains "runs post-rollback healthcheck" "HEALTHCHECK --base-url=https://verifa.sk" "$log_content"

echo "test_rollback_release.sh: pass=$PASS fail=$FAIL"
[ "$FAIL" -eq 0 ]
