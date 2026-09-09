#!/usr/bin/env bash
# Nightly backup of Postgres + the uploads (PHI) volume.
# Writes to ./backups, prunes old files, and — if SPACES_* is set — pushes an
# encrypted-at-rest copy to DigitalOcean Spaces (S3-compatible).
set -euo pipefail
cd "$(dirname "$0")/.."   # repo root

val() { grep -E "^$1=" .env 2>/dev/null | head -1 | cut -d= -f2- | tr -d '"'; }
PGUSER="$(val POSTGRES_USER)"; PGDB="$(val POSTGRES_DB)"; PGPW="$(val POSTGRES_PASSWORD)"
RETAIN="$(val BACKUP_RETAIN_DAYS)"; RETAIN="${RETAIN:-14}"
PROJECT="$(basename "$PWD" | tr '[:upper:]' '[:lower:]' | tr -cd 'a-z0-9')"
UPLOADS_VOL="${PROJECT}_uploads"

TS="$(date -u +%Y%m%dT%H%M%SZ)"
DIR="backups"; mkdir -p "$DIR"

echo "▶ backup $TS"

# ── Postgres logical dump ──────────────────────────────────────────────────────
docker compose exec -T -e PGPASSWORD="$PGPW" postgres \
  pg_dump -U "$PGUSER" -d "$PGDB" --no-owner | gzip > "$DIR/db-$TS.sql.gz"
echo "  db  → $DIR/db-$TS.sql.gz ($(du -h "$DIR/db-$TS.sql.gz" | cut -f1))"

# ── Uploads volume (PHI) archive ───────────────────────────────────────────────
if docker volume inspect "$UPLOADS_VOL" >/dev/null 2>&1; then
  docker run --rm -v "$UPLOADS_VOL":/data:ro -v "$PWD/$DIR":/backup alpine \
    tar czf "/backup/uploads-$TS.tar.gz" -C /data . 2>/dev/null || true
  echo "  uploads → $DIR/uploads-$TS.tar.gz ($(du -h "$DIR/uploads-$TS.tar.gz" 2>/dev/null | cut -f1))"
else
  echo "  ! uploads volume '$UPLOADS_VOL' not found — skipping"
fi

# ── Optional off-box copy to DO Spaces (S3) ────────────────────────────────────
SPACES_BUCKET="$(val SPACES_BUCKET)"
if [ -n "$SPACES_BUCKET" ] && command -v aws >/dev/null 2>&1; then
  ENDPOINT="$(val SPACES_ENDPOINT)"
  echo "  ↑ uploading to s3://$SPACES_BUCKET/backups/"
  aws s3 cp "$DIR/db-$TS.sql.gz" "s3://$SPACES_BUCKET/backups/db-$TS.sql.gz" ${ENDPOINT:+--endpoint-url "$ENDPOINT"} || echo "  ! db upload failed"
  [ -f "$DIR/uploads-$TS.tar.gz" ] && aws s3 cp "$DIR/uploads-$TS.tar.gz" "s3://$SPACES_BUCKET/backups/uploads-$TS.tar.gz" ${ENDPOINT:+--endpoint-url "$ENDPOINT"} || true
fi

# ── Retention ──────────────────────────────────────────────────────────────────
find "$DIR" -name 'db-*.sql.gz' -mtime +"$RETAIN" -delete 2>/dev/null || true
find "$DIR" -name 'uploads-*.tar.gz' -mtime +"$RETAIN" -delete 2>/dev/null || true
echo "✓ backup done (retain ${RETAIN}d)"
