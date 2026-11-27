#!/bin/bash
# Daily Docker cleanup — prevents disk full (PostgreSQL PANIC)
# Runs via cron at 04:00 daily
set -e

LOG=/var/log/docker-cleanup.log
echo "[$(date '+%Y-%m-%d %H:%M:%S')] Starting cleanup" >> $LOG

# Disk before
BEFORE=$(df / | awk 'NR==2 {print $5}')
echo "[$(date '+%Y-%m-%d %H:%M:%S')] Disk usage before: $BEFORE" >> $LOG

# Prune build cache older than 7 days while keeping 4GB hot cache for fast deploys
docker builder prune -f --keep-storage=4GB --filter "until=168h" >> $LOG 2>&1

# Prune ONLY dangling (untagged) images older than 24h — preserves :rollback and :sha-* tags!
docker image prune -f --filter "until=24h" >> $LOG 2>&1

# Prune stopped containers (older than 24h)
docker container prune -f --filter "until=24h" >> $LOG 2>&1

# Prune unused volumes (safety — only truly unused)
# Skip: too risky, could remove named volumes

# Disk after
AFTER=$(df / | awk 'NR==2 {print $5}')
echo "[$(date '+%Y-%m-%d %H:%M:%S')] Disk usage after: $AFTER" >> $LOG

# Alert if still >90%
USAGE_NUM=$(echo $AFTER | tr -d '%')
if [ "$USAGE_NUM" -gt 90 ]; then
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] WARNING: disk still >90% ($AFTER)" >> $LOG
fi

echo "[$(date '+%Y-%m-%d %H:%M:%S')] Cleanup done" >> $LOG
echo '---' >> $LOG
