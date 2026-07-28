#!/bin/bash
# ─── Verifa.sk Local Build + Remote Deploy ───────────────────
# Builds Docker images locally, transfers them to the server,
# and restarts containers without building on the server.
#
# Usage from project root:
#   bash scripts/deploy-local.sh
set -euo pipefail

SERVER="root@89.185.250.213"
REMOTE_DIR="/var/www/verifa"
IMAGES=("verifa-frontend" "verifa-worker-image")
TAR_FILE="/tmp/verifa-images.tar.gz"

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$PROJECT_DIR"

echo "=== Verifa.sk Local Build + Deploy ==="
echo "[$(date)] Starting..."

# ─── 1. Build images locally ────────────────────────────────
echo "[1/6] Building Docker images locally (linux/amd64)..."
DOCKER_DEFAULT_PLATFORM=linux/amd64 docker compose build frontend worker

# ─── 2. Save images to tar ──────────────────────────────────
echo "[2/6] Saving images to tar..."
docker save "${IMAGES[@]}" | gzip > "$TAR_FILE"
echo "  Saved $(du -h "$TAR_FILE" | cut -f1)"

# ─── 3. Transfer to server ──────────────────────────────────
echo "[3/6] Transferring images to server..."
scp "$TAR_FILE" "$SERVER:$TAR_FILE"

# ─── 4. Load images on server + pull code ───────────────────
echo "[4/6] Loading images on server + pulling code..."
ssh "$SERVER" "
  set -euo pipefail
  cd $REMOTE_DIR
  echo '  Loading Docker images...'
  docker load < $TAR_FILE
  rm -f $TAR_FILE
  echo '  Pulling latest code...'
  git pull
"

# ─── 5. Restart containers (no build) + migrate ─────────────
echo "[5/6] Restarting containers + DB migration..."
ssh "$SERVER" "
  set -euo pipefail
  cd $REMOTE_DIR
  docker compose up -d --no-build
  docker compose exec -T -e HOME=/tmp frontend npx prisma migrate deploy
  systemctl reload nginx
"

# ─── 6. Health check ────────────────────────────────────────
echo "[6/6] Health check..."
sleep 5
if curl -s -o /dev/null -w "%{http_code}" https://verifa.sk | grep -q "200\|301\|302"; then
  echo "  ✓ Site is responding"
else
  echo "  ⚠ Site not responding — check: ssh $SERVER 'docker compose logs -f --tail=50'"
fi

# Cleanup local tar
rm -f "$TAR_FILE"

echo ""
echo "[$(date)] Deploy complete!"
echo "  Site: https://verifa.sk"
