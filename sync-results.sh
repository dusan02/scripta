#!/bin/bash
# Automaticky synchronizuje PDF výsledky z Docker kontajnera do lokálneho priečinka.
# Použitie: ./sync-results.sh (beží na pozadí, Ctrl+C pre zastavenie)

CONTAINER="verifa_worker"
REMOTE="/app/results"
LOCAL="worker/results"
INTERVAL=5  # sekundy

echo "🔄 Sync: $CONTAINER:$REMOTE → $LOCAL (every ${INTERVAL}s)"
mkdir -p "$LOCAL"

while true; do
  docker cp "$CONTAINER:$REMOTE/." "$LOCAL/" 2>/dev/null
  sleep "$INTERVAL"
done
