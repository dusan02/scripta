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
echo "[1/5] Pulling latest code..."
git pull

# ─── 2. Rebuild containers ─────────────────────────────────
echo "[2/5] Rebuilding containers..."
docker compose up -d --build

# ─── 3. Run DB migration ───────────────────────────────────
echo "[3/5] Running DB migration..."
docker compose exec -T frontend npx prisma migrate deploy

# ─── 4. Reload nginx ───────────────────────────────────────
echo "[4/5] Reloading nginx..."
systemctl reload nginx

# ─── 5. Health check ───────────────────────────────────────
echo "[5/5] Health check..."
sleep 5
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
