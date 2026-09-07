# GLiNER-BioMed NER sidecar

Zero-shot biomedical NER for **unstructured** clinical text — doctor notes,
prescriptions, discharge summaries. Extracts entity spans (lab tests, diseases,
medications, biomarkers, anatomy); the Node client (`src/lib/clinical-extraction/gliner-client.ts`)
forwards lab-test spans to the LOINC synonym resolver for coding.

This is **not** for lab reports with tables — Docling + the deterministic row
parser handle those (and better, since they recover value/unit/range). GLiNER
is for prose where there is no table.

## Why a Python sidecar (not JS)

The JS / `@huggingface/transformers` path was tried and **does not work**: there
is no official transformers.js-compatible ONNX build of GLiNER-BioMed, and the
community exports mis-decode (verified — garbage spans at any threshold). The
official `gliner` **Python** library runs the real model correctly, so it lives
in a sidecar — the same pattern as the Docling layout sidecar.

## Run (local venv)

```bash
brew install python@3.12
cd scripts/gliner-sidecar
/opt/homebrew/bin/python3.12 -m venv .venv
source .venv/bin/activate
pip install --upgrade pip && pip install -r requirements.txt
npm run gliner:start          # or: uvicorn main:app --port 8001
```

## Run (Docker)

```bash
npm run gliner:up             # docker compose up -d
npm run gliner:logs
npm run gliner:down
```

## API

`GET /health` → `{ status, model, ready }`

`POST /ner`
```json
{ "text": "HbA1c 9.2% in a diabetic on metformin", "labels": ["lab test","disease","medication"], "threshold": 0.5 }
```
→
```json
{ "entities": [ { "text": "HbA1c", "label": "lab test", "score": 0.98, "start": 0, "end": 5 } ], "model": "...", "ms": 120 }
```

## Config (env)

| Var | Default | Meaning |
|---|---|---|
| `GLINER_MODEL` | `Ihor/gliner-biomed-base-v1.0` | swap small/base/large |
| `GLINER_DEVICE` | `cpu` | `cpu` \| `cuda` |
| `GLINER_THRESHOLD` | `0.5` | min entity score |
| `GLINER_LABELS` | see above | default zero-shot labels |
| `PORT` | `8001` | listen port |

The Node side is gated by `ENABLE_GLINER` (default **false**) and `GLINER_SIDECAR_URL`
in the app's `.env` — see `src/lib/ai/config.ts`.
