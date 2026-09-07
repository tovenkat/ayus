#!/usr/bin/env bash
# Stop the GLiNER-BioMed NER sidecar. Idempotent — kills by port (default 8001).

PORT="${PORT:-8001}"

PIDS=$(lsof -ti:"${PORT}" 2>/dev/null || true)
if [ -z "$PIDS" ]; then
  echo "✓ gliner sidecar not running on port ${PORT}"
  exit 0
fi

echo "→ killing gliner sidecar on port ${PORT}: ${PIDS}"
kill $PIDS 2>/dev/null || true
sleep 2
STRAGGLERS=$(lsof -ti:"${PORT}" 2>/dev/null || true)
if [ -n "$STRAGGLERS" ]; then
  echo "→ force-killing stragglers: ${STRAGGLERS}"
  kill -9 $STRAGGLERS 2>/dev/null || true
fi

sleep 0.5
REMAINING=$(lsof -ti:"${PORT}" 2>/dev/null || true)
if [ -z "$REMAINING" ]; then
  echo "✓ gliner sidecar stopped"
else
  echo "⚠ port ${PORT} still bound: ${REMAINING}"
  exit 1
fi
