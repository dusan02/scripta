#!/bin/bash
# Daily ISR cache cleanup — prevents Docker volume bloat from prerendered pages
# Runs via cron at 04:30 and 16:30 daily
#
# With ISR cache on named volumes, this clears localized cache (not in sitemap).
# The /firma/ SK canonical cache is preserved (valuable, in sitemap).
# Volumes persist across restarts — no MISS storm on redeploy.
set -e

LOG=/var/log/docker-cleanup.log
echo "[$(date '+%Y-%m-%d %H:%M:%S')] ISR cache cleanup starting" >> $LOG

BEFORE=$(df / | awk 'NR==2 {print $5}')
echo "[$(date '+%Y-%m-%d %H:%M:%S')] Disk before ISR cleanup: $BEFORE" >> $LOG

# Remove ISR cache for localized paths (not in sitemap, regenerated on-demand)
# Keep /firma/ SK cache (valuable), only clean localized variants
# With volumes: rm -rf clears volume contents, mount point remains (exit 1 suppressed)
docker exec verifa_frontend sh -c 'rm -rf /app/.next/server/app/de /app/.next/server/app/hu /app/.next/server/app/pl /app/.next/server/app/cs /app/.next/server/app/en 2>/dev/null' >> $LOG 2>&1

AFTER=$(df / | awk 'NR==2 {print $5}')
echo "[$(date '+%Y-%m-%d %H:%M:%S')] Disk after ISR cleanup: $AFTER" >> $LOG
echo "[$(date '+%Y-%m-%d %H:%M:%S')] ISR cache cleanup done" >> $LOG
echo '---' >> $LOG
