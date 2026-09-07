"""
GLiNER-BioMed NER sidecar.

Zero-shot biomedical named-entity recognition for UNSTRUCTURED clinical text
(doctor notes, prescriptions, discharge summaries) — the narrative path, not
the tabular lab flow (Docling handles those). The Node client forwards spans to
the LOINC synonym resolver for coding.

Runs the OFFICIAL GLiNER model in Python because the JS/transformers.js path
has no working GLiNER-BioMed ONNX build (verified — community exports mis-decode).

POST /ner
  body: { "text": "...", "labels"?: ["lab test", ...], "threshold"?: 0.5 }
  → { "entities": [{ "text", "label", "score", "start", "end" }], "model", "ms" }

GET /health → { "status": "ok", "model", "ready" }

Run:
    cd scripts/gliner-sidecar
    python -m venv .venv && source .venv/bin/activate
    pip install -r requirements.txt
    uvicorn main:app --port 8001

Config (env):
    GLINER_MODEL      default "Ihor/gliner-biomed-base-v1.0"
    GLINER_DEVICE     "cpu" | "cuda"   (default "cpu")
    GLINER_LABELS     comma-separated default labels
    GLINER_THRESHOLD  default min score (default 0.5)

First load downloads the model (~500 MB base) to ~/.cache/huggingface.
"""
from __future__ import annotations

import os
import time
import logging
from contextlib import asynccontextmanager
from typing import Any

from fastapi import FastAPI
from pydantic import BaseModel

logging.basicConfig(level=logging.INFO)
log = logging.getLogger("gliner-sidecar")

MODEL_ID = os.environ.get("GLINER_MODEL", "Ihor/gliner-biomed-base-v1.0")
DEVICE = os.environ.get("GLINER_DEVICE", "cpu")
DEFAULT_THRESHOLD = float(os.environ.get("GLINER_THRESHOLD", "0.5"))
DEFAULT_LABELS = [
    s.strip() for s in os.environ.get(
        "GLINER_LABELS", "lab test,biomarker,disease,medication,anatomical site"
    ).split(",") if s.strip()
]

# Filled at startup.
_model: Any = None


@asynccontextmanager
async def lifespan(_app: FastAPI):
    global _model
    t0 = time.time()
    log.info("loading GLiNER model %s on %s …", MODEL_ID, DEVICE)
    from gliner import GLiNER  # imported here so /health can answer before load finishes
    _model = GLiNER.from_pretrained(MODEL_ID)
    try:
        _model = _model.to(DEVICE)
    except Exception as e:  # noqa: BLE001 — cuda not present etc.; fall back to cpu
        log.warning("could not move model to %s (%s); using cpu", DEVICE, e)
    log.info("model ready in %.1fs", time.time() - t0)
    yield
    _model = None


app = FastAPI(title="GLiNER-BioMed sidecar", lifespan=lifespan)


class NerRequest(BaseModel):
    text: str
    labels: list[str] | None = None
    threshold: float | None = None


@app.get("/health")
async def health() -> dict[str, Any]:
    return {"status": "ok", "model": MODEL_ID, "ready": _model is not None}


@app.post("/ner")
async def ner(req: NerRequest) -> dict[str, Any]:
    if _model is None:
        return {"entities": [], "model": MODEL_ID, "ms": 0, "error": "model still loading"}

    labels = req.labels or DEFAULT_LABELS
    threshold = req.threshold if req.threshold is not None else DEFAULT_THRESHOLD
    text = req.text or ""

    t0 = time.time()
    # predict_entities returns [{"text","label","score","start","end"}]
    entities = _model.predict_entities(text, labels, threshold=threshold)
    ms = int((time.time() - t0) * 1000)

    # Normalize score to a plain float and keep a stable field order.
    out = [
        {
            "text": e["text"],
            "label": e["label"],
            "score": round(float(e["score"]), 4),
            "start": int(e["start"]),
            "end": int(e["end"]),
        }
        for e in entities
    ]
    return {"entities": out, "model": MODEL_ID, "ms": ms}
