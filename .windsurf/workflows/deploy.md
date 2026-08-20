---
description: Deploy worker and frontend changes to production server
---

## Deploy Workflow

1. Run tests locally to verify changes
   ```
   cd worker && python3 -m pytest tests/ -v --tb=short
   ```

2. Commit changes to git
   ```
   git add -A && git commit -m "description" && git push
   ```

3. SSH to server and rebuild worker container
   ```
   ssh root@verifa.sk "cd /opt/scripta && git pull && docker compose build worker --no-cache"
   ```

4. Restart worker container
   ```
   ssh root@verifa.sk "docker compose up -d worker"
   ```

5. Verify worker is healthy
   ```
   ssh root@verifa.sk "docker logs verifa_worker --tail 20"
   ```

6. If frontend changes, rebuild and restart frontend
   ```
   ssh root@verifa.sk "cd /opt/scripta && docker compose build frontend --no-cache && docker compose up -d frontend"
   ```

7. Verify frontend is responding
   ```
   curl -s -o /dev/null -w "%{http_code}" https://verifa.sk
   ```

## Rollback

If something breaks:
```
ssh root@verifa.sk "cd /opt/scripta && git revert HEAD && docker compose build worker && docker compose up -d worker"
```
