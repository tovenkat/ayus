"""
Docling-based layout-analysis sidecar.

POST /analyze
  multipart/form-data: file (PDF or image)
  → { "analysis_id": "...", "pages": [...] }

Same wire contract as the earlier PaddleOCR sidecar — Docling is the engine
underneath. Docling reads a PDF's text layer natively (no OCR wasted on
digital PDFs) and falls back to OCR only for scanned/image pages, so a
21-page text-native lab PDF completes in ~30 s instead of 5+ min.

Contract on `regions[].type`:  title | text | table | figure | header |
                                footer | caption | list_item

Table regions carry an `html` field (from Docling's structured table export)
that the Node.js row parser consumes directly.

Run:
    cd scripts/layout-sidecar
    python -m venv .venv
    source .venv/bin/activate
    pip install --upgrade pip setuptools
    pip install -r requirements.txt
    uvicorn main:app --port 8000
"""
from __future__ import annotations

import asyncio
import io
import logging
import os
import sys
import time
import uuid
from collections import OrderedDict
from contextlib import asynccontextmanager
from datetime import datetime
from typing import Any

import fitz  # PyMuPDF — for page-level rasterization + /crop
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from PIL import Image
from pydantic import BaseModel

# ── Line-buffer stdout so `docker logs`, `npm run`, and tail -f all see
#    each log line immediately, not batched by page buffering.
try:
    sys.stdout.reconfigure(line_buffering=True)  # type: ignore[attr-defined]
    sys.stderr.reconfigure(line_buffering=True)  # type: ignore[attr-defined]
except Exception:
    pass

logging.getLogger("docling").setLevel(logging.INFO)


def log(msg: str) -> None:
    """Structured log with wall-clock timestamp so hangs are obvious."""
    print(f"{datetime.now().strftime('%H:%M:%S')} [sidecar] {msg}", flush=True)


# ── Config ──────────────────────────────────────────────────────────────
ANALYZE_TIMEOUT_SEC = int(os.environ.get("ANALYZE_TIMEOUT_SEC", "600"))
# Warmup off by default — /health responds instantly, first /analyze pays
# the ~15-30 s model-load cost. Set WARM_ON_STARTUP=yes for the reverse.
WARM_ON_STARTUP = os.environ.get("WARM_ON_STARTUP", "no").lower() == "yes"


# ── Docling converter — lazy-loaded ──────────────────────────────────────
_converter: Any = None
_converter_ready: bool = False


def get_converter() -> Any:
    global _converter, _converter_ready
    if _converter is not None:
        return _converter

    log("lazy-loading Docling converter (this can take 15-45 s the first time; models cache to ~/.cache/docling/)…")
    t0 = time.time()

    # Import inside the function so cold FastAPI import stays fast.
    from docling.document_converter import DocumentConverter, PdfFormatOption
    from docling.datamodel.base_models import InputFormat
    from docling.datamodel.pipeline_options import PdfPipelineOptions

    pipeline_options = PdfPipelineOptions()
    pipeline_options.do_ocr = True                # OCR only when no text layer
    pipeline_options.do_table_structure = True    # TableFormer for cell layout
    pipeline_options.table_structure_options.do_cell_matching = True

    _converter = DocumentConverter(
        format_options={
            InputFormat.PDF: PdfFormatOption(pipeline_options=pipeline_options)
        }
    )
    _converter_ready = True
    log(f"Docling converter ready in {time.time() - t0:.1f}s")
    return _converter


@asynccontextmanager
async def lifespan(_app: FastAPI):
    if WARM_ON_STARTUP:
        log("warming Docling converter at startup (WARM_ON_STARTUP=yes)…")
        await asyncio.to_thread(get_converter)
        log("converter warmed. accepting requests.")
    else:
        log("skipping warmup (WARM_ON_STARTUP=no) — first /analyze will be slow")
    yield


app = FastAPI(title="Docling layout sidecar", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://localhost:3001"],
    allow_methods=["POST", "GET"],
    allow_headers=["*"],
)


# ── LRU cache for /crop (keeps rasterized pages between /analyze and /crop) ─
MAX_CACHED_ANALYSES = 50
_cache: "OrderedDict[str, dict[str, Any]]" = OrderedDict()


def _cache_put(analysis_id: str, entry: dict[str, Any]) -> None:
    _cache[analysis_id] = entry
    _cache.move_to_end(analysis_id)
    while len(_cache) > MAX_CACHED_ANALYSES:
        _cache.popitem(last=False)


def _cache_get(analysis_id: str) -> dict[str, Any] | None:
    entry = _cache.get(analysis_id)
    if entry is not None:
        _cache.move_to_end(analysis_id)
    return entry


# ── PDF rasterization (blocking; wrap in asyncio.to_thread) ─────────────
def render_pdf_pages(data: bytes, dpi: int = 200) -> list[Image.Image]:
    doc = fitz.open(stream=data, filetype="pdf")
    zoom = dpi / 72
    matrix = fitz.Matrix(zoom, zoom)
    images: list[Image.Image] = []
    for page in doc:
        pix = page.get_pixmap(matrix=matrix, alpha=False)
        images.append(Image.frombytes("RGB", (pix.width, pix.height), pix.samples))
    doc.close()
    return images


# ── Docling conversion (blocking; wrap in asyncio.to_thread) ────────────
def convert_with_docling(data: bytes, filename: str) -> Any:
    """Run Docling on the uploaded bytes. Returns the ConversionResult."""
    from docling.datamodel.base_models import DocumentStream
    converter = get_converter()
    stream = DocumentStream(name=filename or "upload.pdf", stream=io.BytesIO(data))
    result = converter.convert(stream)
    return result


# ── Translate Docling document → our region contract ────────────────────
def _label_to_region_type(label: Any) -> str:
    """Map Docling's DocItemLabel to our contract's region.type."""
    s = str(label).lower().rsplit(".", 1)[-1]  # "DocItemLabel.TITLE" -> "title"
    mapping = {
        "title": "title",
        "section_header": "title",
        "page_header": "header",
        "page_footer": "footer",
        "caption": "caption",
        "text": "text",
        "paragraph": "text",
        "list_item": "list_item",
        "footnote": "text",
        "reference": "reference",
        "formula": "equation",
        "code": "text",
        "picture": "figure",
    }
    return mapping.get(s, "text")


def extract_regions_from_document(doc: Any) -> list[dict[str, Any]]:
    """Walk a Docling document and produce per-page regions matching our contract.

    Returns a list of pages: [{ page, width, height, regions: [...] }].
    Region types are text/title/table/etc; table regions include `html`.
    """
    pages_dict: dict[int, dict[str, Any]] = {}
    r_counters: dict[int, int] = {}

    # 1. Seed the pages dict with page sizes.
    if hasattr(doc, "pages") and doc.pages:
        for page_no, page in doc.pages.items():
            idx = int(page_no) - 1  # docling 1-indexed → our 0-indexed
            width = int(getattr(getattr(page, "size", None), "width", 0)) or 1200
            height = int(getattr(getattr(page, "size", None), "height", 0)) or 1600
            pages_dict[idx] = {"page": idx, "width": width, "height": height, "regions": []}
            r_counters[idx] = 0

    # 2. Text-shaped items (titles, paragraphs, headers, footers…)
    for item in getattr(doc, "texts", []) or []:
        prov = getattr(item, "prov", None)
        if not prov:
            continue
        p = prov[0]
        page_idx = int(p.page_no) - 1
        pages_dict.setdefault(page_idx, {"page": page_idx, "width": 1200, "height": 1600, "regions": []})
        r_counters.setdefault(page_idx, 0)

        bbox = p.bbox
        int_bbox = [int(bbox.l), int(bbox.t), int(bbox.r), int(bbox.b)]
        region_id = f"p{page_idx}-r{r_counters[page_idx]}"
        r_counters[page_idx] += 1

        pages_dict[page_idx]["regions"].append({
            "id": region_id,
            "type": _label_to_region_type(getattr(item, "label", "text")),
            "bbox": int_bbox,
            "text": (getattr(item, "text", "") or "").strip(),
        })

    # 3. Table items — export each as HTML so the Node parser can consume.
    for table in getattr(doc, "tables", []) or []:
        prov = getattr(table, "prov", None)
        if not prov:
            continue
        p = prov[0]
        page_idx = int(p.page_no) - 1
        pages_dict.setdefault(page_idx, {"page": page_idx, "width": 1200, "height": 1600, "regions": []})
        r_counters.setdefault(page_idx, 0)

        bbox = p.bbox
        int_bbox = [int(bbox.l), int(bbox.t), int(bbox.r), int(bbox.b)]
        region_id = f"p{page_idx}-r{r_counters[page_idx]}"
        r_counters[page_idx] += 1

        # Docling's table export methods vary across versions — try both.
        html = ""
        try:
            html = table.export_to_html(doc=doc)
        except TypeError:
            try:
                html = table.export_to_html()
            except Exception:
                html = ""
        except Exception:
            html = ""

        text_parts: list[str] = []
        try:
            # `doc` arg required in docling ≥ 2.100; the older call still works
            # but emits a DeprecationWarning per table.
            try:
                df = table.export_to_dataframe(doc=doc)
            except TypeError:
                df = table.export_to_dataframe()
            text_parts = [" ".join(str(c) for c in row) for row in df.values.tolist()]
        except Exception:
            pass

        pages_dict[page_idx]["regions"].append({
            "id": region_id,
            "type": "table",
            "bbox": int_bbox,
            "text": " | ".join(text_parts).strip(),
            "html": html,
        })

    # 4. Sort by page index; sort regions inside each page by y-then-x.
    ordered = sorted(pages_dict.values(), key=lambda p: p["page"])
    for page in ordered:
        page["regions"].sort(key=lambda r: (r["bbox"][1], r["bbox"][0]))
    return ordered


# ── Analyze coroutine ────────────────────────────────────────────────────
async def _do_analyze(data: bytes, is_pdf: bool, filename: str) -> dict[str, Any]:
    total_t0 = time.time()

    # 1. Rasterize pages (needed for /crop; Docling doesn't expose page images).
    if is_pdf:
        log(f"rasterizing PDF ({len(data)} bytes)…")
        raster_t0 = time.time()
        images = await asyncio.to_thread(render_pdf_pages, data)
        log(f"rasterized {len(images)} page(s) in {time.time() - raster_t0:.1f}s")
    else:
        try:
            images = [Image.open(io.BytesIO(data)).convert("RGB")]
        except Exception as exc:
            raise HTTPException(status_code=400, detail=f"unsupported image: {exc}") from exc

    # 2. Docling conversion — reads text layer, structures tables.
    log(f"running Docling conversion on {len(images)} page(s)…")
    docling_t0 = time.time()
    result = await asyncio.to_thread(convert_with_docling, data, filename)
    log(f"Docling conversion complete in {time.time() - docling_t0:.1f}s")

    # 3. Translate to our contract.
    pages = extract_regions_from_document(result.document)

    # 4. Cache for /crop.
    regions_by_id: dict[str, dict[str, Any]] = {}
    for page_dict in pages:
        for region in page_dict["regions"]:
            regions_by_id[region["id"]] = {
                "id": region["id"],
                "page": page_dict["page"],
                "bbox": region["bbox"],
            }

    analysis_id = str(uuid.uuid4())
    _cache_put(analysis_id, {
        "created_at": time.time(),
        "pages": images,
        "regions_by_id": regions_by_id,
    })

    total_regions = sum(len(p["regions"]) for p in pages)
    total_tables = sum(1 for p in pages for r in p["regions"] if r["type"] == "table")
    log(f"analysis {analysis_id[:8]} done: {len(pages)} page(s), {total_regions} regions, {total_tables} tables, total {time.time() - total_t0:.1f}s")

    return {"analysis_id": analysis_id, "pages": pages}


# ── Endpoints ────────────────────────────────────────────────────────────
@app.get("/health")
async def health() -> dict[str, Any]:
    return {
        "status": "ok",
        "engine": "docling",
        "engine_loaded": _converter_ready,
        "cached_analyses": len(_cache),
    }


@app.post("/analyze")
async def analyze(file: UploadFile = File(...)) -> dict[str, Any]:
    data = await file.read()
    if not data:
        raise HTTPException(status_code=400, detail="empty file")

    content_type = (file.content_type or "").lower()
    name = (file.filename or "upload").lower()
    is_pdf = content_type == "application/pdf" or name.endswith(".pdf")

    log(f"/analyze received: name='{file.filename}' content_type='{content_type}' size={len(data)}")

    try:
        return await asyncio.wait_for(
            _do_analyze(data, is_pdf, name),
            timeout=ANALYZE_TIMEOUT_SEC,
        )
    except asyncio.TimeoutError as exc:
        log(f"/analyze exceeded {ANALYZE_TIMEOUT_SEC}s timeout")
        raise HTTPException(
            status_code=504,
            detail=f"analyze exceeded {ANALYZE_TIMEOUT_SEC}s timeout",
        ) from exc
    except Exception as exc:
        log(f"/analyze failed: {type(exc).__name__}: {exc}")
        raise HTTPException(status_code=500, detail=f"{type(exc).__name__}: {exc}") from exc


class CropRequest(BaseModel):
    analysis_id: str
    region_id: str
    pad: int = 4


@app.post("/crop")
async def crop(req: CropRequest) -> Response:
    entry = _cache_get(req.analysis_id)
    if not entry:
        raise HTTPException(status_code=404, detail="unknown analysis_id (may have aged out)")
    region = entry["regions_by_id"].get(req.region_id)
    if not region:
        raise HTTPException(status_code=404, detail="unknown region_id")

    def _render() -> bytes:
        page_img: Image.Image = entry["pages"][region["page"]]
        x1, y1, x2, y2 = region["bbox"]
        x1 = max(0, x1 - req.pad)
        y1 = max(0, y1 - req.pad)
        x2 = min(page_img.width, x2 + req.pad)
        y2 = min(page_img.height, y2 + req.pad)
        crop_img = page_img.crop((x1, y1, x2, y2))
        buf = io.BytesIO()
        crop_img.save(buf, format="PNG")
        return buf.getvalue()

    png_bytes = await asyncio.to_thread(_render)
    return Response(content=png_bytes, media_type="image/png")
