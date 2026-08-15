# Deploy Notes — verifa.sk

## Produkčný server

- **IP:** 89.185.250.213
- **SSH:** `ssh root@89.185.250.213`
- **Projekt cesta:** `/var/www/verifa`
- **Stack:** Docker Compose (nginx reverse proxy + Next.js + PostgreSQL + Redis + Python worker)

## Deploy proces

```bash
# 1. SSH na server
ssh root@89.185.250.213

# 2. Git pull
cd /var/www/verifa
git pull origin master

# 3. Rebuild frontend container
docker compose build frontend

# 4. Reštart frontend containera
docker compose up -d frontend
```

## Overenie deployu

```bash
# Skontroluj HTML output — mali by byť nové CSS triedy
curl -s https://verifa.sk/firma/00684881 | grep -o '<td class="[^"]*"' | head -5
```

## Docker containers

| Container    | Názov              | Port  |
|--------------|--------------------|-------|
| Frontend     | verifa_frontend    | 3000  |
| PostgreSQL   | verifa_postgres    | 5432  |
| Redis        | verifa_redis       | 6379  |
| Worker       | verifa_worker      | -     |
| Arq Worker   | verifa_arq_worker  | -     |
| Browserless  | verifa_browserless | -     |
| DB Backup    | verifa_db_backup   | -     |

## Vercel (nie produkcia!)

- Vercel projekt: `scripta` (https://scripta-gamma.vercel.app)
- Slúži len ako preview/staging — **nie je produkcia**
- `verifa.sk` doména nesmeruje na Vercel

## Čo nerobiť

- **Nenasadzovať cez Vercel** — produkcia beží na vlastnom serveri
- **Nemodifikovať** `docker-compose.yml` bez testovania
- **Nemazať** `~/.next` cache v containery — Docker build ju regeneruje

## Posledný deploy

- **Dátum:** 2026-08-13
- **Commit:** `a39fa14` — table alignment, DRY refactor, formula tooltips, print CSS, Playwright PDF generator
- **Status:** ✅ Úspešný
