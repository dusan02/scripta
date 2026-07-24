#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────────────────────
# Test runner — spustí všetky integračné, funkčné a unit testy
#
# Spustenie:
#   BASE_URL=https://verifa.sk WORKER_URL=http://localhost:8000 \
#     TEST_EMAIL=dusan02@gmail.com TEST_PASSWORD=22222222 \
#     bash tests/run_all.sh
#
# Pre Python testy (cez SSH na worker):
#   RUN_PYTHON=1 WORKER_SSH=root@89.185.250.213 bash tests/run_all.sh
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
chmod +x "$SCRIPT_DIR"/integration/*.sh "$SCRIPT_DIR"/functional/*.sh 2>/dev/null || true

# ── Integration tests ─────────────────────────────────────────────────────────
echo "┌──────────────────────────────────────────────────────┐"
echo "│  Integration Tests                                   │"
echo "└──────────────────────────────────────────────────────┘"
for suite in "$SCRIPT_DIR"/integration/test_*.sh; do
  if [ -f "$suite" ]; then
    echo "──────────────────────────────────────────────────────────"
    bash "$suite" || true
    echo ""
  fi
done

# ── Functional tests ──────────────────────────────────────────────────────────
echo "┌──────────────────────────────────────────────────────┐"
echo "│  Functional Tests                                    │"
echo "└──────────────────────────────────────────────────────┘"
for suite in "$SCRIPT_DIR"/functional/test_*.sh; do
  if [ -f "$suite" ]; then
    echo "──────────────────────────────────────────────────────────"
    bash "$suite" || true
    echo ""
  fi
done

# ── TypeScript unit tests ─────────────────────────────────────────────────────
if [ -f "$SCRIPT_DIR/unit/rateLimit_spec.ts" ]; then
  echo "┌──────────────────────────────────────────────────────┐"
  echo "│  TypeScript Unit Tests                               │"
  echo "└──────────────────────────────────────────────────────┘"
  echo "──────────────────────────────────────────────────────────"
  (cd "$SCRIPT_DIR/../frontend" && npx ts-node --transpile-only --compiler-options '{"module":"CommonJS"}' "$SCRIPT_DIR/unit/rateLimit_spec.ts") || true
  echo ""
fi

# ── Python unit tests (optional, via SSH) ─────────────────────────────────────
if [ "${RUN_PYTHON:-0}" = "1" ]; then
  WORKER_SSH="${WORKER_SSH:-root@89.185.250.213}"
  echo "┌──────────────────────────────────────────────────────┐"
  echo "│  Python Unit Tests (via SSH → Docker)                │"
  echo "└──────────────────────────────────────────────────────┘"
  echo "  Worker SSH: $WORKER_SSH"
  echo "──────────────────────────────────────────────────────────"
  ssh "$WORKER_SSH" "docker exec verifa_worker bash -c 'cd /app && python -m pytest tests/test_analytics.py tests/test_forensic_scorecard.py tests/test_attachment_filter.py tests/test_pdf_compiler.py tests/test_ruz_parser.py tests/test_pdf_ingestion.py -v --tb=short'" || true
  echo ""
fi

echo "══════════════════════════════════════════════════════════"
echo "  All test suites completed."
echo "══════════════════════════════════════════════════════════"
echo ""
