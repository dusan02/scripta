---
description: Deploy worker and frontend changes to production server
---

## Server facts

- Deploy path on server: `/var/www/verifa` (NOT `/opt/scripta`)
- Containers sharing `verifa-worker-image`: `verifa_worker` (FastAPI/API) AND
  `verifa_arq_worker` (background report-generation jobs). Both must be
  rebuilt/restarted together — restarting only `worker` leaves the arq
  worker running stale code.
- `docker compose build ... --no-cache` builds the image; it does NOT restart
  the container. Always follow with `docker compose up -d <service>`.
- Production Postgres runs in `verifa_postgres` (`docker exec verifa_postgres
  psql -U verifa -d verifa ...`). It is a separate DB from any local/dev DB —
  do not assume a locally-applied migration is present in prod.

## Deploy Workflow

1. Run tests locally to verify changes
   ```
   cd worker && python3 -m pytest tests/ -q --tb=short -m "not integration"
   cd frontend && npx tsc --noEmit && npm run test:unit && npm run build
   ```
   Always check the actual exit code (`echo $?` or a separate `echo "EXIT=$?"`
   line) — piping through `| tail` masks the real exit code of the command
   before the pipe, not the exit code of `tail`.

2. If the change adds/alters a required (NOT NULL, no `@default`) Prisma
   column, verify EVERY FinancialStatement/Company `create`/`upsert` call
   site includes it — both in `worker/src/*.py` and `frontend/src/**/*.ts`:
   ```
   grep -rn "financialStatement\.\(create\|upsert\|createMany\)" frontend/src
   grep -rn "FinancialStatement" worker/src/*.py
   ```
   `frontend/src/scripts/*` is excluded from `tsc`/`next build` type-checking
   (see `tsconfig.json` `exclude`), so bugs there won't surface in CI — check
   them manually.

3. Commit changes to git
   ```
   git add -A && git commit -m "description" && git push
   ```

4. SSH to server, pull, and check whether a new Prisma migration needs to be
   applied to production BEFORE rebuilding (a NOT NULL column with no
   default will break every INSERT until the column exists):
   ```
   ssh root@verifa.sk "cd /var/www/verifa && git pull"
   ssh root@verifa.sk "docker exec verifa_postgres psql -U verifa -d verifa -c \"\\d \\\"FinancialStatement\\\"\"" | grep -i <new_column>
   ```
   If missing, apply it (from the frontend container, which has the Prisma
   Node client and migration files) before restarting worker/arq_worker:
   ```
   ssh root@verifa.sk "cd /var/www/verifa && docker compose exec frontend npx prisma migrate deploy"
   ```

5. Rebuild worker image
   ```
   ssh root@verifa.sk "cd /var/www/verifa && docker compose build worker --no-cache"
   ```

6. Restart BOTH worker and arq_worker (same image)
   ```
   ssh root@verifa.sk "cd /var/www/verifa && docker compose up -d worker arq_worker"
   ```

7. Verify both are healthy and the fix actually landed in the running
   container (rebuilds can silently reuse cached layers):
   ```
   ssh root@verifa.sk "docker ps --format '{{.Names}}: {{.Status}}' | grep verifa"
   ssh root@verifa.sk "docker logs verifa_worker --tail 30"
   ssh root@verifa.sk "docker logs verifa_arq_worker --tail 20"
   ssh root@verifa.sk "docker exec verifa_worker grep -n '<distinctive string from the fix>' /app/src/<file>.py"
   ```

8. If frontend changes, rebuild and restart frontend
   ```
   ssh root@verifa.sk "cd /var/www/verifa && docker compose build frontend --no-cache && docker compose up -d frontend"
   ```

9. Verify frontend is responding
   ```
   curl -s -o /dev/null -w "%{http_code}\n" https://verifa.sk
   ssh root@verifa.sk "docker logs verifa_frontend --tail 20; docker ps --format '{{.Names}}: {{.Status}}' | grep verifa_frontend"
   ```

## Rollback

If something breaks:
```
ssh root@verifa.sk "cd /var/www/verifa && git revert HEAD --no-edit && docker compose build worker frontend --no-cache && docker compose up -d worker arq_worker frontend"
```
