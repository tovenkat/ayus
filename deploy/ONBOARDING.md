# Deploying Ayus to a DigitalOcean droplet (Docker + GitHub webhook)

One droplet runs everything: the Next.js app, Postgres (pgvector), Ollama
(CPU by default), and Caddy (auto-HTTPS). A push to your deploy branch hits a
webhook that rebuilds and restarts.

```
GitHub push ──▶ webhook (:9000) ──▶ deploy.sh
                                      git reset → build → migrate → up
Droplet: caddy(:443) → app(:3000) → postgres · ollama · /data/uploads (PHI)
```

## 1. Droplet
- **CPU:** a Regular droplet, **≥ 8 GB RAM** (16 GB comfortable — 7B model + Postgres + build). Ubuntu 24.04.
- **GPU (optional):** an NVIDIA droplet + install the NVIDIA Container Toolkit, then set `COMPUTE_MODE=gpu` in `.env`.
- Point a DNS **A record** (your domain) at the droplet IP.

## 2. Host setup (once)
```bash
# Docker + compose plugin
curl -fsSL https://get.docker.com | sh

# Node (for the webhook listener only)
curl -fsSL https://deb.nodesource.com/setup_24.x | bash - && apt-get install -y nodejs git

# Clone the repo to /opt/ayus (read-only deploy key recommended)
git clone https://github.com/tovenkat/ayus /opt/ayus
cd /opt/ayus

# Config
cp .env.production.example .env
nano .env        # set DOMAIN, AUTH_SECRET, POSTGRES_PASSWORD, WEBHOOK_SECRET, FEEDBACK_EMAIL…
```

## 3. First deploy
```bash
cd /opt/ayus
bash deploy/deploy.sh
```
This builds the images, boots Postgres/Ollama, applies **`deploy/init-db.sql`**
(fresh-DB baseline), marks existing migrations applied, pulls the Ollama models
(first pull is a few GB), and starts the app behind Caddy. First model pull +
build takes a while; later deploys are fast.

Seed demo/reference data if you want it:
```bash
docker compose run --rm migrate sh -c "npm run loinc:seed && npm run biomarkers:seed && npm run nedl:reconcile && npm run diseases:seed && npm run dummy:seed"
```

## 4. Wire the GitHub webhook (auto-deploy on push)
```bash
sudo cp deploy/webhook.service /etc/systemd/system/ayus-webhook.service
sudo systemctl enable --now ayus-webhook
journalctl -u ayus-webhook -f          # watch deploys live
```
In **GitHub → repo → Settings → Webhooks → Add webhook**:
- Payload URL: `http://<droplet-ip>:9000/hooks/deploy` (open port 9000, or proxy it through Caddy)
- Content type: `application/json`
- Secret: the same `WEBHOOK_SECRET` from `.env`
- Events: **Just the push event**

Now every push to `DEPLOY_BRANCH` (default `main`) redeploys automatically.
Prefer GitHub Actions over an open port? An SSH-based deploy job can call
`deploy/deploy.sh` instead — ask and I'll add the workflow.

## Notes
- **Migrations:** `deploy.sh` bootstraps a fresh DB from `init-db.sql`, then uses
  `prisma migrate deploy` for new migrations. Destructive schema changes should be
  reviewed manually.
- **Uploads are PHI** and live on the `uploads` Docker volume (`/data/uploads`).
  Back them up (and `pgdata`) — e.g. a nightly `docker run … | s3cmd put` to Spaces.
- **CPU inference is slow.** Swap `EXTRACT_MODEL`/`OCR_MODEL` for smaller models in
  `.env` if extraction is too slow, then redeploy.
- **Local-only AI:** new orgs default to `OLLAMA_LOCAL`. To use a cloud provider,
  set it per-org in settings (or change the org default).
- **GLiNER/Docling sidecars** are off by default; add them as extra compose
  services when needed.
