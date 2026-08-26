#!/bin/sh
set -e

# Fix permissions on mounted results volume.
# The bind mount from docker-compose may create the directory as root,
# overriding the chown from the Dockerfile. This ensures the non-root
# workeruser can write to /app/results at runtime.
# Use -h to not follow symlinks (prevents symlink attacks on bind mounts).
if [ -d /app/results ]; then
  chown -hR workeruser:worker /app/results
fi

# Fix Prisma binary permissions — Prisma downloads query engine to
# /root/.cache during build, but /root is 700 (root-only) so workeruser
# can't access it at runtime. Copy to /tmp/.cache and set HOME=/tmp.
if [ -d /root/.cache/prisma-python ] && [ ! -d /tmp/.cache/prisma-python ]; then
  mkdir -p /tmp/.cache
  cp -r /root/.cache/prisma-python /tmp/.cache/prisma-python
  chown -R workeruser:worker /tmp/.cache
fi

# Drop privileges and run the actual command as workeruser
# Set HOME=/tmp so Prisma can find its binary cache
export HOME=/tmp

# If this is the worker container (running uvicorn), start ORSR V2 supervisor in background.
# The supervisor auto-starts and auto-resumes the bulk seed after container recreation.
# It is a no-op if another V2 instance is already running (flock lock prevents concurrency).
if [ "$1" = "python" ] && echo "$*" | grep -q "uvicorn"; then
  chmod +x /app/orsr_v2_supervisor.sh 2>/dev/null || true
  gosu workeruser /app/orsr_v2_supervisor.sh &
fi

exec gosu workeruser "$@"
