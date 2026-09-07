#!/usr/bin/env bash
# Stop the PaddleOCR PP-Structure sidecar.
# Idempotent — succeeds silently if nothing is running.
#
# Kills by port (default 8000) rather than by process name so we handle the
# case where uvicorn was launched under a different parent (npm, tmux,
# nohup, etc.) and the process tree doesn't match "uvicorn main:app".

PORT="${PORT:-8000}"

PIDS=$(lsof -ti:"${PORT}" 2>/dev/null || true)

if [ -z "$PIDS" ]; then
  echo "✓ sidecar not running on port ${PORT}"
  exit 0
fi

echo "→ killing sidecar processes on port ${PORT}: ${PIDS}"
# TERM first (clean shutdown); after 2s, KILL any survivors.
kill $PIDS 2>/dev/null || true
sleep 2
STRAGGLERS=$(lsof -ti:"${PORT}" 2>/dev/null || true)
if [ -n "$STRAGGLERS" ]; then
  echo "→ force-killing stragglers: ${STRAGGLERS}"
  kill -9 $STRAGGLERS 2>/dev/null || true
fi

# Verify
sleep 0.5
REMAINING=$(lsof -ti:"${PORT}" 2>/dev/null || true)
if [ -z "$REMAINING" ]; then
  echo "✓ sidecar stopped"
else
  echo "⚠ port ${PORT} still bound: ${REMAINING}"
  exit 1
fi
