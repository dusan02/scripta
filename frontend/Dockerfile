# syntax=docker/dockerfile:1.6
# ─── Stage 1: Dependencies ─────────────────────────────────
FROM node:20-slim AS deps

WORKDIR /app

RUN --mount=type=cache,target=/var/cache/apt \
    apt-get update && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*

ENV PRISMA_CLI_QUERY_ENGINE_TYPE=library
ENV PRISMA_CLIENT_ENGINE_TYPE=library
ENV DATABASE_URL=postgresql://dummy:dummy@localhost:5432/dummy
ENV DATABASE_URL_UNPOOLED=postgresql://dummy:dummy@localhost:5432/dummy

COPY package*.json ./
COPY prisma ./prisma

RUN --mount=type=cache,target=/root/.npm npm ci --ignore-scripts
# Prisma client is pre-generated on host (avoids QEMU crash on Apple Silicon)
COPY node_modules/.prisma ./node_modules/.prisma
COPY node_modules/@prisma/client ./node_modules/@prisma/client

# ─── Stage 2: Build ────────────────────────────────────────
FROM node:20-slim AS builder

WORKDIR /app

RUN --mount=type=cache,target=/var/cache/apt \
    apt-get update && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*

COPY --from=deps /app/node_modules ./node_modules
COPY . .

ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production
ENV DATABASE_URL=postgresql://dummy:dummy@localhost:5432/dummy
ENV DATABASE_URL_UNPOOLED=postgresql://dummy:dummy@localhost:5432/dummy
ENV NEXTAUTH_URL=http://localhost:3000
# NEXTAUTH_SECRET intentionally not set during build — it's a runtime secret.
# Next.js build does not need it; setting it here would bake it into the image.
ENV WORKER_URL=http://localhost:8000
ENV SENTRY_AUTH_TOKEN=
ENV NEXT_PUBLIC_PADDLE_CLIENT_TOKEN=test_2dfbedc6df134bfeec344bb574e
ENV NEXT_PUBLIC_PADDLE_ENVIRONMENT=sandbox
ARG NEXT_PUBLIC_GA_MEASUREMENT_ID
ENV NEXT_PUBLIC_GA_MEASUREMENT_ID=$NEXT_PUBLIC_GA_MEASUREMENT_ID

# Regenerate Prisma client from schema (ensures new fields are typed)
RUN npx prisma generate

RUN npm run build

# ─── Stage 3: Runner (production) ──────────────────────────
FROM node:20-slim AS runner

WORKDIR /app

RUN --mount=type=cache,target=/var/cache/apt \
    apt-get update && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/node_modules ./node_modules

USER nextjs

EXPOSE 3000

CMD ["node", "server.js"]
