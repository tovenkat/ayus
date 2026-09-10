#!/usr/bin/env bash
# Ayus deploy — run on the droplet (by the webhook listener, or manually).
# Pulls the deploy branch, rebuilds, bootstraps/migrates the DB, pulls Ollama
# models, and restarts. Idempotent and safe to re-run.
set -euo pipefail
cd "$(dirname "$0")/.."   # repo root

log() { echo "▶ $*"; }

# ── config from .env ────────────────────────────────────────────────────────
val() { grep -E "^$1=" .env 2>/dev/null | head -1 | cut -d= -f2- | tr -d '"'; }
BRANCH="$(val DEPLOY_BRANCH)"; BRANCH="${BRANCH:-main}"
PGUSER="$(val POSTGRES_USER)"; PGDB="$(val POSTGRES_DB)"; PGPW="$(val POSTGRES_PASSWORD)"
COMPUTE_MODE="$(val COMPUTE_MODE)"; COMPUTE_MODE="${COMPUTE_MODE:-cpu}"
REVERSE_PROXY="$(val REVERSE_PROXY)"; REVERSE_PROXY="${REVERSE_PROXY:-caddy}"
MODELS="$(val OLLAMA_MODELS)"; MODELS="${MODELS:-qwen2.5:7b-instruct deepseek-ocr:latest nomic-embed-text}"

COMPOSE="-f docker-compose.yml"
[ "$COMPUTE_MODE" = "gpu" ] && COMPOSE="$COMPOSE -f docker-compose.gpu.yml"
# nginx mode: app on 127.0.0.1:3000, caddy releases 80/443 (host Nginx fronts).
[ "$REVERSE_PROXY" = "nginx" ] && COMPOSE="$COMPOSE -f docker-compose.nginx.yml"
dc() { docker compose $COMPOSE "$@"; }
psql_c() { dc exec -T -e PGPASSWORD="$PGPW" postgres psql -U "$PGUSER" -d "$PGDB" "$@"; }

# ── pull latest code ──────────────────────────────────────────────────────────
log "fetching origin/$BRANCH"
git fetch --prune origin "$BRANCH"
git reset --hard "origin/$BRANCH"

# ── build images ──────────────────────────────────────────────────────────────
log "building images"
dc build app migrate

# ── datastores up + wait for postgres ──────────────────────────────────────────
log "starting postgres + ollama"
dc up -d postgres ollama
log "waiting for postgres"
for _ in $(seq 1 30); do psql_c -tAc "SELECT 1" >/dev/null 2>&1 && break; sleep 2; done

# ── DB: first-run bootstrap, else migrate ──────────────────────────────────────
EXISTS="$(psql_c -tAc "SELECT to_regclass('public.\"User\"') IS NOT NULL" 2>/dev/null || echo f)"
if [ "$EXISTS" = "t" ]; then
  log "applying pending migrations"
  dc run --rm migrate
else
  log "fresh DB — applying baseline (deploy/init-db.sql)"
  psql_c < deploy/init-db.sql
  log "marking existing migrations as applied"
  for d in prisma/migrations/*/; do
    name="$(basename "$d")"
    [ -f "$d/migration.sql" ] || continue
    dc run --rm migrate npx prisma migrate resolve --applied "$name" >/dev/null 2>&1 || true
  done
  # Seed reference biomarkers + demo accounts/data on first deploy only.
  if [ "$(val SEED_DEMO)" = "true" ]; then
    log "seeding reference + demo data (SEED_DEMO=true)"
    dc run --rm migrate npm run seed:demo || log "! seed:demo had issues (continuing)"
  fi
fi

# ── ollama models (idempotent) ──────────────────────────────────────────────────
log "ensuring ollama models: $MODELS"
for m in $MODELS; do dc exec -T ollama ollama pull "$m" || true; done

# ── restart app + proxy ─────────────────────────────────────────────────────────
if [ "$REVERSE_PROXY" = "nginx" ]; then
  log "starting app (host Nginx fronts it on 127.0.0.1:${APP_PORT:-3000})"
  dc up -d app
else
  log "starting app + caddy"
  dc up -d app caddy
fi

log "pruning old images"
docker image prune -f >/dev/null 2>&1 || true
log "✓ deployed $(git rev-parse --short HEAD) ($BRANCH, compute=$COMPUTE_MODE)"
