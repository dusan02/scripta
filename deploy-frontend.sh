#!/bin/bash
set -euo pipefail

SERVER="root@89.185.250.213"
REMOTE_DIR="/var/www/verifa"
IMAGE_NAME="verifa-frontend"

echo "=== Building frontend image for linux/amd64 ==="
docker buildx build --platform linux/amd64 \
  --build-arg NEXT_PUBLIC_GA_MEASUREMENT_ID=G-HLK37PR125 \
  -t "$IMAGE_NAME" ./frontend --load

echo "=== Shipping image to server ==="
docker save "$IMAGE_NAME" | gzip | ssh "$SERVER" "gunzip | docker load"

echo "=== Pulling latest code on server ==="
ssh "$SERVER" "cd $REMOTE_DIR && git pull origin master"

echo "=== Running DB migrations ==="
ssh "$SERVER" "cd $REMOTE_DIR && docker compose exec -T -e HOME=/tmp frontend npx prisma migrate deploy"

echo "=== Restarting frontend container ==="
ssh "$SERVER" "cd $REMOTE_DIR && docker compose up -d frontend --force-recreate"

echo "=== Cleaning up old Docker images and build cache ==="
ssh "$SERVER" "docker image prune -f --filter 'until=24h' && docker builder prune -f --filter 'until=24h'"

echo "=== Done ==="
echo "Check: https://verifa.sk"
