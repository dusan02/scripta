FROM python:3.11-slim

# Enable BuildKit apt cache
RUN rm -f /etc/apt/apt.conf.d/docker-clean; echo 'Binary::apt::APT::Keep-Downloaded-Packages "true";' > /etc/apt/apt.conf.d/keep-cache

# Inštalácia systémových závislostí pre Playwright, Prisma Python klienta (potrebuje Node) a ďalšie knižnice
RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,target=/var/lib/apt,sharing=locked \
    apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    nodejs \
    npm \
    wget \
    gnupg \
    libnss3 \
    libnspr4 \
    libatk1.0-0 \
    libatk-bridge2.0-0 \
    libcups2 \
    libdrm2 \
    libxkbcommon0 \
    libxcomposite1 \
    libxdamage1 \
    libxfixes3 \
    libxrandr2 \
    libgbm1 \
    libasound2 \
    libpango-1.0-0 \
    libcairo2

WORKDIR /app

# Kopírovanie requirements a inštalácia Python závislostí
COPY requirements.txt .
RUN --mount=type=cache,target=/root/.cache/pip \
    pip install --default-timeout=120 --retries=5 -r requirements.txt && \
    pip install --default-timeout=120 --retries=5 prisma

# Inštalácia Playwright prehliadačov (ak sa scraper používa)
# Note: Playwright browsers are installed in /root/.cache/ms-playwright
RUN playwright install chromium

# Kopírovanie zdrojového kódu
COPY . .

# Vygenerovanie Prisma klienta (iba raz)
RUN prisma generate --schema=./prisma/schema.prisma

CMD ["python", "-m", "uvicorn", "src.main:app", "--host", "0.0.0.0", "--port", "8000"]
