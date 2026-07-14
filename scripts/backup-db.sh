#!/bin/bash
# ─── PostgreSQL Backup Script ─────────────────────────────────
# Usage: ./scripts/backup-db.sh
# Or via cron: 0 3 * * * /path/to/scripts/backup-db.sh
#
# Requires: pg_dump, gzip, optional AWS CLI for S3 upload
# Env vars:
#   DB_HOST (default: localhost)
#   DB_PORT (default: 5432)
#   DB_USER (default: scripta)
#   DB_NAME (default: scripta)
#   BACKUP_DIR (default: ./backups)
#   S3_BUCKET (optional — if set, uploads to S3)
#   RETENTION_DAYS (default: 30)

set -euo pipefail

DB_HOST="${DB_HOST:-localhost}"
DB_PORT="${DB_PORT:-5432}"
DB_USER="${DB_USER:-scripta}"
DB_NAME="${DB_NAME:-scripta}"
BACKUP_DIR="${BACKUP_DIR:-./backups}"
RETENTION_DAYS="${RETENTION_DAYS:-30}"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="${BACKUP_DIR}/${DB_NAME}_${TIMESTAMP}.sql.gz"

mkdir -p "${BACKUP_DIR}"

echo "[$(date)] Starting backup of ${DB_NAME}..."

pg_dump \
  --host="${DB_HOST}" \
  --port="${DB_PORT}" \
  --username="${DB_USER}" \
  --dbname="${DB_NAME}" \
  --format=custom \
  --no-owner \
  --no-privileges \
  | gzip > "${BACKUP_FILE}"

BACKUP_SIZE=$(du -h "${BACKUP_FILE}" | cut -f1)
echo "[$(date)] Backup created: ${BACKUP_FILE} (${BACKUP_SIZE})"

# Upload to S3 if configured
if [ -n "${S3_BUCKET:-}" ]; then
  if command -v aws &> /dev/null; then
    echo "[$(date)] Uploading to S3: s3://${S3_BUCKET}/$(basename "${BACKUP_FILE}")"
    aws s3 cp "${BACKUP_FILE}" "s3://${S3_BUCKET}/" --quiet
    echo "[$(date)] S3 upload complete"
  else
    echo "[$(date)] WARNING: S3_BUCKET set but AWS CLI not found. Skipping upload."
  fi
fi

# Clean old backups
echo "[$(date)] Cleaning backups older than ${RETENTION_DAYS} days..."
find "${BACKUP_DIR}" -name "${DB_NAME}_*.sql.gz" -type f -mtime +${RETENTION_DAYS} -delete
echo "[$(date)] Done."
