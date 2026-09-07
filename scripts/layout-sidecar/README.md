# layout-sidecar — PaddleOCR PP-Structure sidecar

FastAPI service wrapping PaddleOCR PP-StructureV2 for layout analysis. The
Next.js app talks to it over HTTP at `LAYOUT_SIDECAR_URL` (default
`http://localhost:8000`). The extraction dispatcher in
[`src/lib/extraction.ts`](../../src/lib/extraction.ts) routes to it when
`EXTRACTION_STRATEGY=layout` (or `=auto` for scanned/image PDFs).

## Endpoints

| Method + path | What it does |
|---|---|
| `GET /health` | Returns `{status, engine_loaded, cached_analyses}`. Non-blocking — always responds even during an analyze. |
| `POST /analyze` (multipart) | Runs layout detection + table structure + OCR. Returns per-page regions with bbox, text, and (for tables) reconstructed HTML. |
| `POST /crop` (json) | Crops a bbox from a cached analysis and returns a PNG. Used by the layout-agent tutorial. |

## Run it

Two paths — Docker is recommended.

### 🐳 Docker (recommended)

From the repo root:

```bash
npm run sidecar:build    # first time only, or after Dockerfile changes
npm run sidecar:up       # start in background
npm run sidecar:logs     # follow logs
npm run sidecar:down     # stop
```

The container binds `localhost:8000` on the host and mounts a named
volume `paddleocr_cache` so the ~300 MB of PaddleOCR models persist
across `up`/`down` cycles. Nuke the cache to force a re-download:

```bash
docker volume rm layout-sidecar_paddleocr_cache
```

### 🐍 Native venv (fallback)

Only pick this if you can't or won't use Docker. Python 3.10–3.12 required
(PaddlePaddle 2.6.2 doesn't have wheels for 3.13+).

```bash
brew install python@3.12
cd scripts/layout-sidecar
/opt/homebrew/bin/python3.12 -m venv .venv
source .venv/bin/activate
pip install --upgrade pip
pip install -r requirements.txt

# Then from repo root:
npm run sidecar:start    # foreground; Ctrl+C to stop
npm run sidecar:stop     # kill anything on port 8000
```

## What it returns

For each page of an image or PDF: a list of regions with `{id, type, bbox,
text}`, plus an `html` field on `type == "table"` regions containing the
reconstructed table structure.

Region types come from PP-Structure: `title`, `text`, `table`, `figure`,
`figure_caption`, `table_caption`, `header`, `footer`, `reference`,
`equation`.

## Config (env vars)

Applies to both Docker and venv paths. In Docker they live in
`docker-compose.yml`; native, just export before `npm run sidecar:start`.

| Var | Default | Effect |
|---|---|---|
| `WARM_ON_STARTUP` | `no` | If `yes`, load PP-Structure models at boot (~40-60 s). Trades boot time for a fast first request. |
| `ANALYZE_TIMEOUT_SEC` | `600` | Per-request ceiling. Aborts stuck inferences with a 504. |

## Quick verification

```bash
# Health (should be instant even while /analyze is running)
curl -s http://localhost:8000/health

# Real test — 3-8 s per page after models load
curl -F "file=@/path/to/lab-report.pdf" http://localhost:8000/analyze \
  | jq '.pages[0].regions[] | {type, bbox}'
```

Watch progress in the container/foreground log:

```
[sidecar] /analyze received: name='lab.pdf' size=387421
[sidecar] rasterizing PDF (387421 bytes)…
[sidecar] rasterized 3 page(s) in 1.8s
[sidecar] page 1/3: running PP-Structure (1668x2361 px)…
[sidecar] page 1/3: 14 regions (2 tables) in 17.1s
```

## Timing expectations (Apple Silicon Mac, CPU-only)

| Situation | Time |
|---|---|
| First `/analyze` on fresh volume | +40-60 s for model download |
| First `/analyze` with models cached | +30-40 s for engine load (first page only) |
| Per-page after engine loaded | 10-20 s per page |

Text-native PDFs (Thyrocare, SRL, Apollo digital reports) don't need this
sidecar at all — text is already extractable via `pdf-parse` and the LLM
path handles them faster. Set `EXTRACTION_STRATEGY=auto` (not `layout`) to
route only scanned/image PDFs through here.
