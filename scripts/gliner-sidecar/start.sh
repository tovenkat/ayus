#!/usr/bin/env bash
# Start the GLiNER-BioMed NER sidecar.
# Used by `npm run gliner:start` — keeps venv activation + env in one place.

set -e
cd "$(dirname "$0")"

# ── Preflight ────────────────────────────────────────────────────────────
if [ ! -d ".venv" ]; then
  cat >&2 <<'EOF'
❌ scripts/gliner-sidecar/.venv not found.

One-time setup:
  brew install python@3.12
  cd scripts/gliner-sidecar
  /opt/homebrew/bin/python3.12 -m venv .venv
  source .venv/bin/activate
  pip install --upgrade pip
  pip install -r requirements.txt

Then re-run `npm run gliner:start`.
EOF
  exit 1
fi

# shellcheck disable=SC1091
source .venv/bin/activate

PORT="${PORT:-8001}"
MODEL="${GLINER_MODEL:-Ihor/gliner-biomed-base-v1.0}"
cat <<EOF
▲ GLiNER-BioMed NER sidecar
  Model:   ${MODEL}  (device: ${GLINER_DEVICE:-cpu})
  Listening on http://localhost:${PORT}
  Health:  curl http://localhost:${PORT}/health
  NER:     curl -X POST http://localhost:${PORT}/ner -H 'Content-Type: application/json' \\
             -d '{"text":"HbA1c 9.2% in a diabetic on metformin","labels":["lab test","disease","medication"]}'
  Stop:    Ctrl+C

  First start downloads the model (~500 MB) into ~/.cache/huggingface.

EOF

# exec so uvicorn replaces this shell — Ctrl+C then signals uvicorn directly.
exec uvicorn main:app --port "${PORT}"
