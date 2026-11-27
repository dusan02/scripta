# syntax=docker/dockerfile:1.6
# ─── Stage 1: Dependencies ─────────────────────────────────
FROM node:20-slim AS deps

WORKDIR /app

RUN --mount=type=cache,target=/var/cache/apt \
    apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*

ENV PRISMA_CLI_QUERY_ENGINE_TYPE=library
ENV PRISMA_CLIENT_ENGINE_TYPE=library
ENV DATABASE_URL=postgresql://dummy:dummy@localhost:5432/dummy
ENV DATABASE_URL_UNPOOLED=postgresql://dummy:dummy@localhost:5432/dummy

COPY package*.json ./
RUN --mount=type=cache,target=/root/.npm npm ci --ignore-scripts

# ─── Stage 2: Build ────────────────────────────────────────
FROM node:20-slim AS builder

WORKDIR /app

RUN --mount=type=cache,target=/var/cache/apt \
    apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*

COPY --from=deps /app/node_modules ./node_modules
COPY prisma ./prisma
ENV DATABASE_URL=postgresql://dummy:dummy@localhost:5432/dummy
ENV DATABASE_URL_UNPOOLED=postgresql://dummy:dummy@localhost:5432/dummy
RUN npx prisma generate

COPY . .

ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production
ENV NEXTAUTH_URL=http://localhost:3000
# NEXTAUTH_SECRET intentionally not set during build — it's a runtime secret.
# Next.js build does not need it; setting it here would bake it into the image.
ENV WORKER_URL=http://localhost:8000
ENV SENTRY_AUTH_TOKEN=
ARG NEXT_PUBLIC_PADDLE_CLIENT_TOKEN
ARG NEXT_PUBLIC_PADDLE_ENVIRONMENT
ENV NEXT_PUBLIC_PADDLE_CLIENT_TOKEN=${NEXT_PUBLIC_PADDLE_CLIENT_TOKEN:-}
ENV NEXT_PUBLIC_PADDLE_ENVIRONMENT=${NEXT_PUBLIC_PADDLE_ENVIRONMENT:-sandbox}
ARG NEXT_PUBLIC_GA_MEASUREMENT_ID
ENV NEXT_PUBLIC_GA_MEASUREMENT_ID=$NEXT_PUBLIC_GA_MEASUREMENT_ID

RUN --mount=type=cache,target=/app/.next/cache npm run build

# ─── Stage 3: Runner (production) ──────────────────────────
FROM node:20-slim AS runner

WORKDIR /app

RUN --mount=type=cache,target=/var/cache/apt \
    apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

# Minimal isolated Prisma CLI for `prisma migrate deploy` without copying 700+ MB dev node_modules
RUN --mount=type=cache,target=/root/.npm \
    mkdir -p /opt/prisma-cli && cd /opt/prisma-cli && \
    npm init -y >/dev/null 2>&1 && npm install --no-save prisma@5.15.0

# Standalone runtime packages not traced by @vercel/nft:
# - ioredis: loaded via eval("require")("ioredis") in src/lib/rateLimit.ts
# - sharp: required by Next.js standalone image optimizer
RUN --mount=type=cache,target=/root/.npm \
    mkdir -p /opt/runtime-deps && cd /opt/runtime-deps && \
    npm init -y >/dev/null 2>&1 && \
    npm install --no-save --omit=dev ioredis@6.0.0 sharp@0.33.5

ENV NODE_PATH=/opt/runtime-deps/node_modules
ENV NEXT_SHARP_PATH=/opt/runtime-deps/node_modules/sharp

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder /app/prisma ./prisma

# Create ISR & fetch-cache directories for Docker volume mounts and unstable_cache
# (ensures correct ownership when named volumes are first created)
RUN mkdir -p /app/.next/cache/fetch-cache \
    /app/.next/server/app/firma \
    /app/.next/server/app/en \
    /app/.next/server/app/de \
    /app/.next/server/app/cs \
    /app/.next/server/app/hu \
    /app/.next/server/app/pl && \
    chown -R nextjs:nodejs /app/.next/cache \
    /app/.next/server/app/firma \
    /app/.next/server/app/en /app/.next/server/app/de \
    /app/.next/server/app/cs /app/.next/server/app/hu \
    /app/.next/server/app/pl

USER nextjs

EXPOSE 3000

CMD ["node", "server.js"]
