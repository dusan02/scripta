#!/bin/bash
set -euo pipefail

SERVER="root@89.185.250.213"
REMOTE_DIR="/var/www/verifa"
IMAGE_NAME="verifa-frontend"

echo "=== Building frontend image for linux/amd64 ==="
docker buildx build --platform linux/amd64 -t "$IMAGE_NAME" ./frontend --load

echo "=== Shipping image to server ==="
docker save "$IMAGE_NAME" | gzip | ssh "$SERVER" "gunzip | docker load"

echo "=== Pulling latest code on server ==="
ssh "$SERVER" "cd $REMOTE_DIR && git pull origin master"

echo "=== Restarting frontend container ==="
ssh "$SERVER" "cd $REMOTE_DIR && docker compose up -d frontend"

echo "=== Done ==="
echo "Check: https://verifa.sk"
