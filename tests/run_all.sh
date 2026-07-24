#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────────────────────
# Test runner — spustí všetky integračné a funkčné testy
#
# Spustenie:
#   BASE_URL=https://verifa.sk WORKER_URL=http://localhost:8000 \
#     TEST_EMAIL=dusan02@gmail.com TEST_PASSWORD=22222222 \
#     bash tests/run_all.sh
# ──────────────────────────────────────────────────────────────────────────────
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
TOTAL_PASS=0
TOTAL_FAIL=0

echo ""
echo "╔══════════════════════════════════════════════════════╗"
echo "║           Verifa.sk — Test Suite Runner              ║"
echo "╚══════════════════════════════════════════════════════╝"
echo "  Target: ${BASE_URL:-http://localhost:3000}"
echo "  Worker: ${WORKER_URL:-http://localhost:8000}"
echo "  Date:   $(date -u '+%Y-%m-%d %H:%M:%S UTC')"
echo ""

# Make scripts executable
chmod +x "$SCRIPT_DIR"/integration/*.sh 2>/dev/null || true

# ── Run each test suite ───────────────────────────────────────────────────────
for suite in "$SCRIPT_DIR"/integration/test_*.sh; do
  if [ -f "$suite" ]; then
    echo "──────────────────────────────────────────────────────────"
    bash "$suite" || true
    echo ""
  fi
done

echo "══════════════════════════════════════════════════════════"
echo "  All test suites completed."
echo "══════════════════════════════════════════════════════════"
echo ""
