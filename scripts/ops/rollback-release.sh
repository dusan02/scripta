#!/usr/bin/env bash
# ─── Verifa Safe Release Rollback ───────────────────────────────────────────
#
# Safely rolls back Verifa application containers to their `:rollback` (or
# specified) Docker image tag WITHOUT touching PostgreSQL, Redis, volumes,
# or database migrations.
#
# Safety guarantees:
#   - Verifies target image tag(s) exist BEFORE mutating anything
#   - Tags currently active image(s) as `:pre-rollback-<UTC_TS>` for reversibility
#   - Uses `docker compose up -d --force-recreate --no-build --no-deps` so
#     postgres, redis, browserless, db-backup, and all named volumes are untouched
#   - Runs post-deploy-healthcheck.sh after rollback to confirm recovery
#
# Usage:
#   bash scripts/ops/rollback-release.sh [options]
#
# Options:
#   --service=all|frontend|worker   Services to roll back (default: all)
#   --tag=TAG                       Source image tag (default: rollback)
#   --project-dir=DIR               Compose project directory (default: /var/www/verifa)
#   --base-url=URL                  Base URL for post-rollback healthcheck (default: https://verifa.sk)
#   --dry-run                       Print planned actions and verify tags without mutating
#   --skip-verify                   Skip post-rollback healthcheck
#   --yes                           Confirm execution (required in non-interactive mode)
#   -h, --help                      Show this help message
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

SERVICE="all"
ROLLBACK_TAG="rollback"
PROJECT_DIR="${PROJECT_DIR:-/var/www/verifa}"
BASE_URL="${BASE_URL:-https://verifa.sk}"
DRY_RUN=false
SKIP_VERIFY=false
AUTO_YES=false

DOCKER_BIN="${DOCKER_BIN:-docker}"
HEALTHCHECK_SCRIPT="${HEALTHCHECK_SCRIPT:-$SCRIPT_DIR/post-deploy-healthcheck.sh}"
WAIT_AFTER_UP="${WAIT_AFTER_UP:-5}"

for arg in "$@"; do
  case "$arg" in
    --service=*) SERVICE="${arg#--service=}" ;;
    --tag=*) ROLLBACK_TAG="${arg#--tag=}" ;;
    --project-dir=*) PROJECT_DIR="${arg#--project-dir=}" ;;
    --base-url=*) BASE_URL="${arg#--base-url=}" ;;
    --dry-run) DRY_RUN=true ;;
    --skip-verify) SKIP_VERIFY=true ;;
    --yes) AUTO_YES=true ;;
    -h|--help)
      sed -n '2,28p' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *)
      echo "ERROR: Unknown option: $arg (use --help)" >&2
      exit 2
      ;;
  esac
done

case "$SERVICE" in
  all)
    IMAGES=("verifa-frontend" "verifa-worker-image")
    COMPOSE_TARGETS=("frontend" "worker" "arq_worker")
    ;;
  frontend)
    IMAGES=("verifa-frontend")
    COMPOSE_TARGETS=("frontend")
    ;;
  worker)
    IMAGES=("verifa-worker-image")
    COMPOSE_TARGETS=("worker" "arq_worker")
    ;;
  *)
    echo "ERROR: Invalid --service value '$SERVICE' (expected: all|frontend|worker)" >&2
    exit 2
    ;;
esac

if [ -z "$ROLLBACK_TAG" ]; then
  echo "ERROR: --tag cannot be empty" >&2
  exit 2
fi

echo "=== Verifa Safe Release Rollback ==="
echo "  Service scope : $SERVICE (${COMPOSE_TARGETS[*]})"
echo "  Target tag    : :$ROLLBACK_TAG"
echo "  Project dir   : $PROJECT_DIR"
echo "  Mode          : $([ "$DRY_RUN" = true ] && echo "DRY-RUN (no changes)" || echo "EXECUTE")"
echo "  DB/Volumes    : UNTOUCHED (--no-deps, no migrations, no volume removal)"

# 1. Pre-flight: verify every target image:<tag> exists locally
echo "--- Pre-flight image verification ---"
for img in "${IMAGES[@]}"; do
  src="${img}:${ROLLBACK_TAG}"
  img_id="$("$DOCKER_BIN" image inspect --format '{{.Id}}' "$src" 2>/dev/null || true)"
  if [ -z "$img_id" ]; then
    echo "ERROR: Required rollback image '$src' not found! Aborting without changes." >&2
    exit 1
  fi
  echo "  OK $src -> ${img_id:0:19}"
done

if [ ! -d "$PROJECT_DIR" ]; then
  echo "ERROR: Project directory '$PROJECT_DIR' does not exist." >&2
  exit 1
fi

BACKUP_TAG="pre-rollback-$(date -u +%Y%m%dT%H%M%SZ)"

if [ "$DRY_RUN" = true ]; then
  echo "--- Planned actions (dry-run) ---"
  for img in "${IMAGES[@]}"; do
    echo "  [dry-run] $DOCKER_BIN tag ${img}:latest ${img}:${BACKUP_TAG}"
    echo "  [dry-run] $DOCKER_BIN tag ${img}:${ROLLBACK_TAG} ${img}:latest"
  done
  echo "  [dry-run] (cd $PROJECT_DIR && $DOCKER_BIN compose up -d --force-recreate --no-build --no-deps ${COMPOSE_TARGETS[*]})"
  if [ "$SKIP_VERIFY" = false ]; then
    echo "  [dry-run] bash $HEALTHCHECK_SCRIPT --base-url=$BASE_URL"
  fi
  echo "Dry-run complete. Re-run with --yes (without --dry-run) to execute."
  exit 0
fi

if [ "$AUTO_YES" = false ]; then
  if [ -t 0 ]; then
    printf "Proceed with rollback of [%s] to :%s? [y/N] " "${COMPOSE_TARGETS[*]}" "$ROLLBACK_TAG"
    read -r reply
    case "$reply" in
      y|Y|yes|YES) ;;
      *) echo "Aborted by user."; exit 1 ;;
    esac
  else
    echo "ERROR: Non-interactive rollback requires --yes (or use --dry-run to preview)." >&2
    exit 2
  fi
fi

# 2. Preserve currently active images before retagging
echo "--- Preserving current images as :$BACKUP_TAG ---"
for img in "${IMAGES[@]}"; do
  if "$DOCKER_BIN" image inspect "${img}:latest" >/dev/null 2>&1; then
    "$DOCKER_BIN" tag "${img}:latest" "${img}:${BACKUP_TAG}"
    echo "  Saved ${img}:latest -> ${img}:${BACKUP_TAG}"
  else
    echo "  WARN: ${img}:latest not present, skipping backup tag"
  fi
done

# 3. Retag rollback images to :latest
echo "--- Retagging :$ROLLBACK_TAG -> :latest ---"
for img in "${IMAGES[@]}"; do
  "$DOCKER_BIN" tag "${img}:${ROLLBACK_TAG}" "${img}:latest"
  echo "  Tagged ${img}:${ROLLBACK_TAG} -> ${img}:latest"
done

# 4. Recreate ONLY the selected application containers (--no-deps preserves DB/Redis/volumes)
echo "--- Recreating containers (${COMPOSE_TARGETS[*]}) ---"
(
  cd "$PROJECT_DIR"
  "$DOCKER_BIN" compose up -d --force-recreate --no-build --no-deps "${COMPOSE_TARGETS[@]}"
)

if [ "$WAIT_AFTER_UP" -gt 0 ]; then
  sleep "$WAIT_AFTER_UP"
fi

# 5. Post-rollback verification
if [ "$SKIP_VERIFY" = false ]; then
  echo "--- Running post-rollback healthcheck ---"
  if [ -f "$HEALTHCHECK_SCRIPT" ]; then
    bash "$HEALTHCHECK_SCRIPT" --base-url="$BASE_URL"
  else
    echo "WARN: Healthcheck script not found at $HEALTHCHECK_SCRIPT" >&2
  fi
fi

echo ""
echo "Rollback complete!"
echo "  Previous images saved as: :$BACKUP_TAG"
echo "  To undo this rollback: bash $0 --service=$SERVICE --tag=$BACKUP_TAG --yes"
