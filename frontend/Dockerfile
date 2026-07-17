# ─── Stage 1: Dependencies ─────────────────────────────────
FROM node:18-slim AS deps

WORKDIR /app

RUN apt-get update && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*

ENV PRISMA_CLI_QUERY_ENGINE_TYPE=library
ENV PRISMA_CLIENT_ENGINE_TYPE=library
ENV DATABASE_URL=postgresql://dummy:dummy@localhost:5432/dummy
ENV DATABASE_URL_UNPOOLED=postgresql://dummy:dummy@localhost:5432/dummy

COPY package*.json ./
COPY prisma ./prisma

RUN npm ci --ignore-scripts
RUN cp prisma/schema.prisma prisma/schema.prisma.bak && \
    sed '/generator client_py/,/^}/d' prisma/schema.prisma > prisma/schema_js.prisma && \
    mv prisma/schema_js.prisma prisma/schema.prisma && \
    npx prisma generate && \
    mv prisma/schema.prisma.bak prisma/schema.prisma

# ─── Stage 2: Build ────────────────────────────────────────
FROM node:18-slim AS builder

WORKDIR /app

RUN apt-get update && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*

COPY --from=deps /app/node_modules ./node_modules
COPY . .

ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production
ENV DATABASE_URL=postgresql://dummy:dummy@localhost:5432/dummy
ENV DATABASE_URL_UNPOOLED=postgresql://dummy:dummy@localhost:5432/dummy
ENV NEXTAUTH_URL=http://localhost:3000
ENV NEXTAUTH_SECRET=change_me_in_production_please
ENV WORKER_URL=http://localhost:8000
ENV WORKER_SECRET=change_me_worker_secret

RUN npm run build

# ─── Stage 3: Runner (production) ──────────────────────────
FROM node:18-slim AS runner

WORKDIR /app

RUN apt-get update && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/node_modules/@prisma ./node_modules/@prisma
COPY --from=builder /app/node_modules/cookie ./node_modules/cookie
COPY --from=builder /app/node_modules/jose ./node_modules/jose
COPY --from=builder /app/node_modules/next-auth ./node_modules/next-auth
COPY --from=builder /app/node_modules/bcryptjs ./node_modules/bcryptjs

USER nextjs

EXPOSE 3000

CMD ["node", "server.js"]
