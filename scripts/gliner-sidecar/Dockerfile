# GLiNER-BioMed NER sidecar
#
# Build:  docker build -t phr2-gliner-sidecar .
# Run:    docker run -p 8001:8001 -v hf_cache:/root/.cache/huggingface phr2-gliner-sidecar
# Use `docker compose up` (see docker-compose.yml) for the recommended dev workflow.

FROM python:3.12-slim

# torch/transformers need a C++ runtime; libgomp for OpenMP.
RUN apt-get update \
    && apt-get install -y --no-install-recommends libgomp1 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir --upgrade pip \
    && pip install --no-cache-dir -r requirements.txt

COPY main.py .

# Model weights cache under ~/.cache/huggingface — mount a volume to persist
# across container restarts (see docker-compose.yml).
RUN mkdir -p /root/.cache/huggingface

EXPOSE 8001
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8001"]
