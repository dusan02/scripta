FROM python:3.11-slim

# Enable BuildKit apt cache
RUN rm -f /etc/apt/apt.conf.d/docker-clean; echo 'Binary::apt::APT::Keep-Downloaded-Packages "true";' > /etc/apt/apt.conf.d/keep-cache

# Inštalácia systémových závislostí pre Playwright, Prisma Python klienta (potrebuje Node) a ďalšie knižnice
RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,target=/var/lib/apt,sharing=locked \
    apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    gosu \
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
# Install to /ms-playwright (shared, accessible by non-root user)
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
RUN playwright install chromium && \
    chmod -R a+rx /ms-playwright

# Create non-root user
RUN addgroup --system --gid 1001 worker && \
    adduser --system --uid 1001 --ingroup worker --home /app workeruser

# Ensure results directory exists and is writable by workeruser
RUN mkdir -p /app/results && chown workeruser:worker /app/results

# Create log files writable by workeruser (pipeline.py writes errors.log in CWD)
RUN touch /app/errors.log /app/uvicorn.log && chown workeruser:worker /app/errors.log /app/uvicorn.log

# Kopírovanie zdrojového kódu
COPY --chown=workeruser:worker . .

# Entrypoint script — fixes volume permissions at runtime (runs as root, then drops to workeruser)
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

# Vygenerovanie Prisma klienta (iba raz)
# Set HOME=/tmp so Prisma downloads query engine to /tmp/.cache (accessible by workeruser)
ENV HOME=/tmp
RUN prisma generate --schema=./prisma/schema.prisma && chown -R workeruser:worker /tmp/.cache

# Entrypoint runs as root to fix volume permissions, then drops to workeruser via gosu
ENTRYPOINT ["/entrypoint.sh"]

EXPOSE 8000

CMD ["python", "-m", "uvicorn", "src.main:app", "--host", "0.0.0.0", "--port", "8000"]
