---
description: Deploy worker and frontend changes to production server
---

## Deploy Workflow

1. Run tests locally to verify changes
   ```
   cd worker && python3 -m pytest tests/ -q --tb=short -m "not integration"
   cd frontend && npx tsc --noEmit && npm run test:unit && npm run build
   ```
   Always check the actual exit code (`echo $?` on its own line, or a
   separate `echo "EXIT=$?"`) — piping through `| tail` masks the real exit
   code of the command before the pipe, not the exit code of `tail`.

2. If the change adds/alters a required (NOT NULL, no `@default`) Prisma
   column, verify EVERY FinancialStatement/Company `create`/`upsert` call
   site includes it — both in `worker/src/*.py` and `frontend/src/**/*.ts`:
   ```
   grep -rn "financialStatement\.\(create\|upsert\|createMany\)" frontend/src
   grep -rn "FinancialStatement" worker/src/*.py
   ```
   `frontend/src/scripts/*` is excluded from `tsc`/`next build` type-checking
   (see `tsconfig.json` `exclude`), so bugs there won't surface in CI — check
   them manually. `scripts/deploy.sh`'s `prisma migrate deploy` step will
   apply the migration itself, but it won't catch missing fields in
   hand-written `create` payloads — that's a code-review concern, not a
   deploy-script concern.

3. Commit changes to git
   ```
   git add -A && git commit -m "description" && git push
   ```

4. Deploy via the unified script — from your local machine:
   ```
   bash scripts/deploy.sh                              # server-build, all services (default)
   bash scripts/deploy.sh --local-build                # build locally, ship images, all services
   bash scripts/deploy.sh --service=frontend           # only rebuild/restart frontend
   bash scripts/deploy.sh --local-build --service=worker  # local-build, worker+arq_worker only
   ```
   This single script (see its header comment for full details) handles:
   git pull on the server, build (locally or on the server), `prisma
   migrate deploy`, restarting `worker` + `arq_worker` together (never just
   one — they share the same image and both must run current code),
   `nginx reload`, tagging the previous image(s) for rollback, pruning old
   images/build cache, and a final HTTPS health check.

   It can also be run directly on the server (auto-detected):
   ```
   ssh root@verifa.sk "cd /var/www/verifa && bash scripts/deploy.sh"
   ```

5. Verify deployment
   ```
   ssh root@verifa.sk "cd /var/www/verifa && docker compose ps"
   ssh root@verifa.sk "docker logs verifa_worker --tail 20"
   ssh root@verifa.sk "docker logs verifa_arq_worker --tail 20"
   curl -s -o /dev/null -w "%{http_code}\n" https://verifa.sk
   ```
   For a code change you're not 100% sure landed (e.g. after a rebuild that
   might have reused cached layers), confirm directly in the running
   container:
   ```
   ssh root@verifa.sk "docker exec verifa_worker grep -n '<distinctive string from the fix>' /app/src/<file>.py"
   ```

## Rollback

`scripts/deploy.sh` prints a ready-to-run rollback command at the end of
every deploy (it tags the previous image(s) before overwriting them). If
you need it after the fact:
```
ssh root@89.185.250.213 "cd /var/www/verifa && docker tag verifa-frontend:rollback verifa-frontend && docker tag verifa-worker-image:rollback verifa-worker-image && docker compose up -d --force-recreate frontend worker arq_worker"
```
Or, to roll back the git history too:
```
ssh root@verifa.sk "cd /var/www/verifa && git revert HEAD --no-edit" && bash scripts/deploy.sh
```
