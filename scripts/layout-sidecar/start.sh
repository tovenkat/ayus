#!/usr/bin/env bash
# Start the PaddleOCR PP-Structure sidecar.
# Used by `npm run sidecar:start` — keeps venv activation + env vars + the
# Apple-Silicon KMP workaround in one place so npm can invoke it portably.

set -e
cd "$(dirname "$0")"

# ── Preflight ────────────────────────────────────────────────────────────
if [ ! -d ".venv" ]; then
  cat >&2 <<'EOF'
❌ scripts/layout-sidecar/.venv not found.

One-time setup:
  brew install python@3.12
  cd scripts/layout-sidecar
  /opt/homebrew/bin/python3.12 -m venv .venv
  source .venv/bin/activate
  pip install --upgrade pip
  pip install -r requirements.txt

Then re-run `npm run sidecar:start`.
EOF
  exit 1
fi

# ── Activate venv ────────────────────────────────────────────────────────
# shellcheck disable=SC1091
source .venv/bin/activate

# ── Apple-Silicon workaround ─────────────────────────────────────────────
# paddlepaddle links against libomp; if the app process (or a dependency)
# has already loaded a different libomp, imports crash with "OMP: Error #15".
# This flag tells the runtime to keep going.
export KMP_DUPLICATE_LIB_OK=TRUE

# ── Startup banner ───────────────────────────────────────────────────────
PORT="${PORT:-8000}"
cat <<EOF
▲ PaddleOCR PP-Structure sidecar
  Listening on http://localhost:${PORT}
  Health:  curl http://localhost:${PORT}/health
  Analyze: curl -X POST -F 'file=@lab.pdf' http://localhost:${PORT}/analyze
  Stop:    Ctrl+C

  First request downloads ~300 MB of model weights (one-time, into
  ~/.paddleocr/). Later calls are 3-8 s per page.

EOF

# exec so uvicorn replaces this shell — Ctrl+C then signals uvicorn directly.
exec uvicorn main:app --port "${PORT}"
