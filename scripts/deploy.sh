#!/bin/bash
# ─── Verifa.sk Deploy Script ────────────────────────────────
# Usage: bash /var/www/verifa/scripts/deploy.sh
# Or via SSH: ssh root@89.185.250.213 "bash /var/www/verifa/scripts/deploy.sh"
set -euo pipefail

APP_DIR="/var/www/verifa"
cd "$APP_DIR"

echo "=== Verifa.sk Deploy ==="
echo "[$(date)] Starting deploy..."

# ─── 1. Pull latest code ───────────────────────────────────
echo "[1/6] Pulling latest code..."
git pull

# ─── 2. Rebuild containers ─────────────────────────────────
echo "[2/6] Rebuilding containers..."
docker compose up -d --build

# Ensure worker results directory is writable by container user (uid 1001)
chown -R 1001:1001 ./worker/results 2>/dev/null || true

# ─── 3. Run DB migration ───────────────────────────────────
echo "[3/6] Running DB migration..."
docker compose exec -T -e HOME=/tmp -u root frontend node /app/node_modules/prisma/build/index.js migrate deploy

# ─── 4. Reload nginx ───────────────────────────────────────
echo "[4/6] Reloading nginx..."
systemctl reload nginx

# ─── 5. Restart workers (ensure new image is running) ──────
echo "[5/6] Restarting workers..."
docker compose restart arq_worker worker
# Wait for worker to be healthy (max 30s)
for i in $(seq 1 15); do
  if docker compose exec -T worker curl -sf http://localhost:8000/health >/dev/null 2>&1; then
    echo "  ✓ Worker is healthy (${i}s)"
    break
  fi
  sleep 2
done

# ─── 6. Cleanup old Docker images & build cache ────────────
echo "[6/6] Cleaning up old Docker images & build cache..."
docker image prune -f 2>/dev/null | tail -1 || true
docker builder prune -f 2>/dev/null | tail -1 || true
echo "  Disk: $(df -h / | awk 'NR==2 {print $3 " / " $2 " (" $5 ")"}')"

# ─── Health check ──────────────────────────────────────────
echo "[$(date)] Health check..."
sleep 3
if curl -s -o /dev/null -w "%{http_code}" https://verifa.sk | grep -q "200\|301\|302"; then
  echo "  ✓ Site is responding"
else
  echo "  ⚠ Site not responding — check: docker compose logs"
fi

echo ""
echo "[$(date)] Deploy complete!"
echo "  Site: https://verifa.sk"
echo "  Status: docker compose ps"
echo "  Logs: docker compose logs -f --tail=50"
