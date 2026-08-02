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

# Drop privileges and run the actual command as workeruser
exec gosu workeruser "$@"
