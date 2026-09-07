# PaddleOCR PP-Structure sidecar
#
# Build:  docker build -t phr2-layout-sidecar .
# Run:    docker run -p 8000:8000 -v paddleocr_cache:/root/.paddleocr phr2-layout-sidecar
# Use `docker compose up` (see docker-compose.yml) for the recommended dev workflow.

FROM python:3.12-slim

# System libraries paddleocr / opencv / pymupdf need at runtime.
#   libgl1        — cv2 (opencv-python)
#   libglib2.0-0  — cv2
#   libgomp1      — paddlepaddle (OpenMP runtime)
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        libgl1 \
        libglib2.0-0 \
        libgomp1 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy requirements first so pip's layer cache survives code changes.
COPY requirements.txt .
RUN pip install --no-cache-dir --upgrade pip \
    && pip install --no-cache-dir -r requirements.txt

# App code.
COPY main.py .

# Model cache lives under /root/.paddleocr — mount a volume to persist across
# container restarts (see docker-compose.yml). Without the volume, PaddleOCR
# re-downloads ~300 MB on every fresh container.
RUN mkdir -p /root/.paddleocr

# Bind on 0.0.0.0 so the port is reachable from the host (not just from
# inside the container).
EXPOSE 8000
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
