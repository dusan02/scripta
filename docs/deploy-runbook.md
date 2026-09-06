# Verifa.sk — Production Runbook

**Server:** root@89.185.250.213 · **App dir:** `/var/www/verifa` · **Domain:** https://verifa.sk
**Stack:** nginx (80/443) → frontend (127.0.0.1:3000, Docker) · worker/arq_worker · postgres · redis · browserless

---

## Deploy

**Štandardný deploy (z lokálneho stroja, odporúčané — VPS nerobí build):**

```bash
cd /Users/dusanbaran/Desktop/Projects/scripta
git push origin master                      # 1. kód musí byť v gite
bash scripts/deploy.sh --local-build        # build lokálne → docker save → scp → load → health-gated swap
```

**Server-build variant** (keď lokálny Docker nemôže):

```bash
bash scripts/deploy.sh                      # build na VPS (pomalé, ~15 min)
bash scripts/deploy.sh --service=frontend   # len frontend
bash scripts/deploy.sh --service=worker     # len worker + arq_worker
```

**Čo deploy.sh robí (v poradí):**

1. otaguje aktuálne images ako `:rollback` + `:sha-<SHA>` (immutable identity)
2. build (lokálne linux/amd64 alebo na serveri) → `docker save | scp | docker load`
3. `git pull` na serveri
4. graceful stop ORSR V2 seed (ak beží)
5. `docker compose up -d --no-build` (nový image už je loaded)
6. `prisma migrate deploy`
7. **health gate**: čaká na worker `/health` + frontend healthcheck (container health)
8. nginx reload
9. **smoke testy**: homepage 200, /api/health 200
10. pri health-gate faile → **automatický rollback** na `:rollback` image + exit 1

**Immutable tagy:** každý deploy otaguje image `:sha-<SHA>`. Rollback na ľubovoľnú verziu:

```bash
ssh root@89.185.250.213 "docker tag verifa-frontend:sha-<SHA> verifa-frontend:latest && \
  cd /var/www/verifa && docker compose up -d --force-recreate --no-build frontend"
```

---

## Rollback

```bash
# 1. Identify last known-good SHA:
ssh root@89.185.250.213 "docker images --format '{{.Repository}}:{{.Tag}}' | grep sha-"

# 2. Rollback frontend (worker analogicky s verifa-worker-image):
ssh root@89.185.250.213 "cd /var/www/verifa && \
  docker tag verifa-frontend:sha-<GOOD_SHA> verifa-frontend:latest && \
  docker compose up -d --force-recreate --no-build frontend"

# 3. Healthcheck + smoke:
curl -s https://verifa.sk/api/health && curl -s -o /dev/null -w '%{http_code}' https://verifa.sk/firma/35876832-kia-slovakia-s-r-o
```

## Failed deploy

| Symptom | Akcia |
|---|---|
| Health gate zlyhal | deploy.sh automaticky rollbackol → skontroluj `docker compose logs frontend --tail=100` |
| Build zlyhá na VPS | starý container beží ďalej (compose nerestartuje pri failed build); použi `--local-build` |
| Nový container nenabehne | `docker compose logs frontend --tail=50`; rollback príkaz z deploy výstupu |
| Migrácia zlyhá | DB je pred migráciou zálohovaná (`verifa_db_backup`); rollback image + `git revert` migrácie |

## Emergency

| Scenár | Postup |
|---|---|
| **Frontend down** | `ssh root@89.185.250.213 'cd /var/www/verifa && docker compose ps'` → `docker compose up -d --force-recreate frontend` → ak zlyhá: rollback image |
| **Worker down** | `docker compose restart worker arq_worker` → `curl localhost:8000/health` (v kontajneri) → reporty sa refundujú automaticky (recover-stuck cron) |
| **Browserless down** | `docker compose restart browserless` → worker má circuit breaker + lokálny Chromium fallback |
| **DB unavailable** | `docker compose restart postgres` → kontrola `docker logs verifa_postgres` → disk full? (`df -h /`) |
| **Disk full** | `docker system prune -af --filter 'until=48h'` + `docker builder prune -af` |

## Kritické fakty

- **Frontend port 3000 je len 127.0.0.1** (verejný prístup len cez nginx 80/443). Docker published ports bypassujú UFW — nikdy nepublikuj port na 0.0.0.0.
- **BROWSERLESS_TOKEN je povinný** (compose fail-fast).
- **fix-names-run kontajner** (name repair) beží na verifa_default sieti — nemaž ho, kým neskončí (~2-3 dni). Po dokončení: `docker rm fix-names-run`.
- Sieťová segmentácia (edge/backend/data networks) je pripravená na aplikáciu až PO skončení name repair (repair kontajner potrebuje prístup na postgres cez verifa_default).

## Monitoring (D7 — na aktiváciu manuálne)

UptimeRobot (free, 5-min interval) — 3 monitory:

| Monitor | URL | Interval | Alert |
|---|---|---|---|
| Homepage | `https://verifa.sk/` | 5 min | HTTP 200 |
| API health | `https://verifa.sk/api/health` | 5 min | HTTP 200 + `"ok":true` |
| Firma page (ISR) | https://verifa.sk/firma/35876832-kia-slovakia-s-r-o | 30 min | HTTP 200 |

Keyword monitoring na `/api/health`: alert ak odpoveď neobsahuje `"ok"`.
Notification: email + (voliteľne) Slack webhook. Nastavenie trvá ~5 min v
UptimeRobot UI (free plan stačí) — vyžaduje používateľský účet, preto nie je
automatizované.
