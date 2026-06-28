#!/bin/bash
# ─── Verifa dev startup ───────────────────────────────────────────
# Spustí PostgreSQL, frontend (localhost:3000) a worker (localhost:8000).
# Použitie:  ./start.sh
# ────────────────────────────────────────────────────────────────────

set -e

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
FRONTEND_DIR="$ROOT_DIR/frontend"
WORKER_DIR="$ROOT_DIR/worker"
PIDS=()

cleanup() {
    echo ""
    echo "[start] Zatváram procesy..."
    for pid in "${PIDS[@]}"; do
        kill "$pid" 2>/dev/null || true
    done
    # Zabij konkrétne porty ak bežia
    lsof -ti:3000 2>/dev/null | xargs kill -9 2>/dev/null || true
    lsof -ti:8000 2>/dev/null | xargs kill -9 2>/dev/null || true
    echo "[start] Hotovo."
}
trap cleanup EXIT INT TERM

# ─── 1. PostgreSQL ─────────────────────────────────────────────────
if ! lsof -ti:5432 >/dev/null 2>&1; then
    echo "[start] Spúšťam PostgreSQL (docker-compose)..."
    docker compose -f "$ROOT_DIR/docker-compose.yml" up -d postgres
    echo "[start] Čakám na PostgreSQL..."
    for i in $(seq 1 15); do
        if docker exec scripta_postgres pg_isready -U scripta >/dev/null 2>&1; then
            echo "[start] PostgreSQL je ready."
            break
        fi
        sleep 1
    done
else
    echo "[start] PostgreSQL už beží na porte 5432."
fi

# ─── 2. Worker (port 8000) ─────────────────────────────────────────
if lsof -ti:8000 >/dev/null 2>&1; then
    echo "[start] Worker už beží na porte 8000."
else
    echo "[start] Spúšťam worker na porte 8000..."
    cd "$WORKER_DIR"
    .venv/bin/uvicorn src.main:app --host 0.0.0.0 --port 8000 --reload &
    PIDS+=($!)
    cd "$ROOT_DIR"
    sleep 2
    if curl -s http://localhost:8000/health | grep -q '"ok"'; then
        echo "[start] Worker je ready."
    else
        echo "[start] ⚠ Worker sa nespustil správne — skontroluj logy."
    fi
fi

# ─── 3. Frontend (port 3000) ───────────────────────────────────────
if lsof -ti:3000 >/dev/null 2>&1; then
    echo "[start] Frontend už beží na porte 3000."
else
    echo "[start] Spúšťam frontend na porte 3000..."
    cd "$FRONTEND_DIR"
    npm run dev &
    PIDS+=($!)
    cd "$ROOT_DIR"
    sleep 3
    if lsof -ti:3000 >/dev/null 2>&1; then
        echo "[start] Frontend je ready."
    else
        echo "[start] ⚠ Frontend sa nespustil správne — skontroluj logy."
    fi
fi

# ─── Summary ───────────────────────────────────────────────────────
echo ""
echo "═══════════════════════════════════════════════════════"
echo "  Verifa beží:"
echo "    Frontend:  http://localhost:3000"
echo "    Worker:    http://localhost:8000"
echo "    Health:    http://localhost:8000/health"
echo ""
echo "  Pre ukončenie stlač Ctrl+C"
echo "═══════════════════════════════════════════════════════"
echo ""

# Udržiavaj skript bežiaci — čakaj na Ctrl+C
wait
