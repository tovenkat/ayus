# syntax=docker/dockerfile:1
# Multi-stage build for the Ayus Next.js app.
#   deps    — install node_modules
#   builder — prisma generate + next build (standalone)  [also used for migrations]
#   runner  — lean standalone runtime (what actually serves traffic)

FROM node:24-slim AS base
WORKDIR /app
# openssl: Prisma. ca-certificates: outbound TLS (Ollama/providers).
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# ── deps ──────────────────────────────────────────────────────────────────
FROM base AS deps
COPY package.json package-lock.json ./
RUN npm ci

# ── builder (also the migration runner — has full deps + prisma CLI + tsx) ──
FROM base AS builder
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npx prisma generate && npm run build

# ── runner (standalone) ─────────────────────────────────────────────────────
FROM base AS runner
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
# Run as the built-in non-root node user.
RUN mkdir -p /data/uploads && chown -R node:node /data /app
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public
# Generated Prisma client + engine (ensure it's present for the driver adapter).
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
USER node
EXPOSE 3000
# Next standalone entrypoint; instrumentation.ts (the extraction worker) boots here.
CMD ["node", "server.js"]
