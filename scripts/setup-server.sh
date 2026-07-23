#!/bin/bash
# ─── Verifa.sk Server Setup ─────────────────────────────────
# Run as root on fresh Debian 12 server
# Usage: bash scripts/setup-server.sh
set -euo pipefail

SERVER_IP="89.185.250.213"
APP_DIR="/var/www/verifa"
REPO_URL="https://github.com/dusan02/scripta.git"

echo "=== Verifa.sk Server Setup ==="
echo ""

# ─── 1. System update ──────────────────────────────────────
echo "[1/7] Updating system..."
apt update && apt upgrade -y

# ─── 2. Install Docker ─────────────────────────────────────
echo "[2/7] Installing Docker..."
if ! command -v docker &> /dev/null; then
  curl -fsSL https://get.docker.com | sh
else
  echo "  Docker already installed, skipping."
fi

# ─── 3. Install nginx + certbot + git ──────────────────────
echo "[3/7] Installing nginx, certbot, git..."
apt install -y nginx certbot python3-certbot-nginx git

# ─── 4. Clone repo ─────────────────────────────────────────
echo "[4/7] Cloning repo..."
mkdir -p "$APP_DIR"
if [ -d "$APP_DIR/.git" ]; then
  echo "  Repo already exists, pulling..."
  cd "$APP_DIR" && git pull
else
  git clone "$REPO_URL" "$APP_DIR"
  cd "$APP_DIR"
fi

# ─── 5. Generate secrets ───────────────────────────────────
echo "[5/7] Generating secrets..."
NEXTAUTH_SECRET=$(openssl rand -base64 32)
WORKER_SECRET=$(openssl rand -base64 32)
DB_PASSWORD=$(openssl rand -base64 24 | tr -dc 'a-zA-Z0-9' | head -c 32)

echo "  NEXTAUTH_SECRET=$NEXTAUTH_SECRET"
echo "  WORKER_SECRET=$WORKER_SECRET"
echo "  DB_PASSWORD=$DB_PASSWORD"

# ─── 6. Create .env ────────────────────────────────────────
echo "[6/7] Creating .env..."
cat > "$APP_DIR/.env" << ENVEOF
# ─── Core ───
NEXTAUTH_URL=https://verifa.sk
NEXTAUTH_SECRET=$NEXTAUTH_SECRET
WORKER_SECRET=$WORKER_SECRET

# ─── Database ───
POSTGRES_USER=verifa
POSTGRES_PASSWORD=$DB_PASSWORD
POSTGRES_DB=verifa
DATABASE_URL=postgresql://verifa:$DB_PASSWORD@postgres:5432/verifa
DATABASE_URL_UNPOOLED=postgresql://verifa:$DB_PASSWORD@postgres:5432/verifa

# ─── Docker Compose ───
COMPOSE_PROJECT_NAME=verifa

# ─── OAuth (fill in later) ───
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
AZURE_AD_CLIENT_ID=
AZURE_AD_CLIENT_SECRET=
AZURE_AD_TENANT_ID=

# ─── Sentry (optional) ───
SENTRY_DSN=
SENTRY_ORG=
SENTRY_PROJECT=

# ─── CRE (for worker scraping) ───
CRE_USERNAME=
CRE_PASSWORD=

# ─── Stripe (legacy, will be replaced by Paddle) ───
STRIPE_SECRET_KEY=
STRIPE_PRICE_PAYG1=
STRIPE_PRICE_PAYG10=
STRIPE_PRICE_PAYG50=
STRIPE_PRICE_FREELANCE=
STRIPE_PRICE_FIRMA=
STRIPE_PRICE_KORPORAT=
STRIPE_PRICE_ADDON5=
STRIPE_WEBHOOK_SECRET=
ENVEOF

echo "  .env created at $APP_DIR/.env"

# ─── 7. Nginx config ───────────────────────────────────────
echo "[7/7] Configuring nginx..."
cat > /etc/nginx/sites-available/verifa.sk << 'NGINXEOF'
server {
    listen 80;
    server_name verifa.sk www.verifa.sk;

    client_max_body_size 50M;

    # Next.js frontend
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        proxy_read_timeout 300s;
    }

    # Worker API
    location /api/worker/ {
        proxy_pass http://127.0.0.1:8000/;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }

    # Static files (generated PDFs)
    location /results/ {
        alias /var/www/verifa/worker/results/;
        try_files $uri =404;
    }
}
NGINXEOF

ln -sf /etc/nginx/sites-available/verifa.sk /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl reload nginx
echo "  Nginx configured."

# ─── Build & start containers ──────────────────────────────
echo ""
echo "=== Building Docker containers (this may take 10-15 min) ==="
cd "$APP_DIR"
docker compose up -d --build

echo ""
echo "=== Running DB migration ==="
docker compose exec -T frontend npx prisma migrate deploy || echo "  Migration will run after frontend is healthy..."

# ─── SSL ───────────────────────────────────────────────────
echo ""
echo "=== Setting up SSL certificate ==="
echo "  Waiting 10s for containers to start..."
sleep 10
certbot --nginx -d verifa.sk -d www.verifa.sk --non-interactive --agree-tos --register-unsafely-without-email || echo "  SSL setup failed — run manually: certbot --nginx -d verifa.sk -d www.verifa.sk"

# ─── Done ──────────────────────────────────────────────────
echo ""
echo "=== SETUP COMPLETE ==="
echo ""
echo "  Site: https://verifa.sk"
echo "  .env: $APP_DIR/.env"
echo "  Containers: docker compose ps"
echo "  Logs: docker compose logs -f"
echo ""
echo "  Next steps:"
echo "    1. Check https://verifa.sk"
echo "    2. Fill OAuth keys in .env if needed"
echo "    3. Set up SSH keys: ssh-copy-id root@$SERVER_IP"
echo "    4. Disable password login in /etc/ssh/sshd_config"
echo ""
