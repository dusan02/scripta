#!/bin/bash
set -euo pipefail

SERVER="root@89.185.250.213"
REMOTE_DIR="/var/www/verifa"
IMAGE_NAME="verifa-frontend"
ROLLBACK_TAG="verifa-frontend:rollback"

echo "=== Building frontend image for linux/amd64 ==="
docker buildx build --platform linux/amd64 \
  --build-arg NEXT_PUBLIC_GA_MEASUREMENT_ID=G-HLK37PR125 \
  -t "$IMAGE_NAME" ./frontend --load

echo "=== Shipping image to server ==="
docker save "$IMAGE_NAME" | gzip | ssh "$SERVER" "gunzip | docker load"

echo "=== Pulling latest code on server (hard reset to avoid conflicts) ==="
ssh "$SERVER" "cd $REMOTE_DIR && git fetch origin master && git reset --hard origin/master"

echo "=== Tagging current image for rollback ==="
ssh "$SERVER" "docker tag $IMAGE_NAME $ROLLBACK_TAG 2>/dev/null || true"

echo "=== Restarting frontend container (new image) ==="
ssh "$SERVER" "cd $REMOTE_DIR && docker compose up -d frontend --force-recreate"

echo "=== Waiting for container healthcheck ==="
ssh "$SERVER" "cd $REMOTE_DIR && timeout 60 bash -c 'until docker compose exec -T frontend node -e \"fetch(\\\"http://localhost:3000/api/health\\\").then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))\" 2>/dev/null; do sleep 2; done' || echo 'WARN: Healthcheck timeout, continuing anyway'"

echo "=== Running DB migrations ==="
ssh "$SERVER" "cd $REMOTE_DIR && docker compose exec -T -e HOME=/tmp frontend npx prisma migrate deploy"

echo "=== Cleaning up old Docker images and build cache ==="
ssh "$SERVER" "docker image prune -f --filter 'until=24h' && docker builder prune -f --filter 'until=24h'"

echo "=== Done ==="
echo "Check: https://verifa.sk"
echo "Rollback: ssh $SERVER 'docker tag $ROLLBACK_TAG $IMAGE_NAME && cd $REMOTE_DIR && docker compose up -d frontend --force-recreate'"
