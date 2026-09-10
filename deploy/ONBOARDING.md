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

**Demo data is seeded automatically** on the first deploy when `SEED_DEMO=true`
(default): reference biomarkers + synonyms, and demo accounts with populated
dashboards. Log in (phone + OTP `123456`):

| Kind | Phone |
|---|---|
| Individual | `+910000000001` |
| Laboratory | `+910000000010` |
| Doctor | `+910000000020` |
| Hospital | `+910000000030` |

⚠ These demo accounts use a fixed OTP — **set `SEED_DEMO=false` and remove them
before a real production launch.**

Re-seed manually anytime: `docker compose run --rm migrate npm run seed:demo`.

**LOINC + ICD-10** reference tables need licensed CSVs that aren't in the repo
(`ionic/LoincTableCore.csv`, `ionic/icd10.csv`). The app works without them
(biomarker resolution, organ maps, and care flags don't depend on them). To add
them, copy the CSVs to `ionic/` on the droplet and run
`docker compose run --rm migrate sh -c "npm run loinc:seed && npm run diseases:seed"`.

### Optional: GLiNER NER sidecar (clinical text)
GLiNER-BioMed extracts entities (diseases, medications, lab tests, anatomy) from
**narrative** clinical documents — prescriptions, doctor notes, imaging reports.
Lab reports use the structured-table path and don't need it. It's **off by
default**; enable it only on a droplet with spare RAM (**8 GB+**; the model is a
PyTorch transformer).

Turn it on in `.env` and redeploy:
```bash
cd /opt/ayus
sed -i 's/^ENABLE_GLINER=.*/ENABLE_GLINER=true/' .env || echo "ENABLE_GLINER=true" >> .env
bash deploy/deploy.sh        # builds + starts the "gliner" sidecar (profile-gated)
```
`deploy.sh` activates the compose `gliner` profile and the app reaches it at
`http://gliner:8001` automatically — no URL to set. The **first** build pulls
PyTorch and the first start downloads ~500 MB of model weights (cached in the
`hf_cache` volume thereafter), so the first deploy takes a few extra minutes.

Verify and watch it:
```bash
DC="docker compose -f docker-compose.yml -f docker-compose.nginx.yml --profile gliner"
$DC logs -f gliner           # model loading on first start
$DC exec -T gliner python -c "import urllib.request;print(urllib.request.urlopen('http://localhost:8001/health').read())"
```
Then upload a prescription/doctor-note PDF — extraction classifies it and adds
medications/findings from the NER entities. On a GPU droplet set
`GLINER_DEVICE=cuda` in `.env`. To turn it off: set `ENABLE_GLINER=false` and
redeploy (the sidecar won't start).

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

### Alternative: GitHub Actions (SSH deploy — no open port)
Prefer not to expose port 9000? Use the included workflow
(`.github/workflows/deploy.yml`) instead — it SSHes in and runs `deploy.sh` on
every push to `main`. **Use one or the other, not both** (both = double-deploy);
if you go this route, don't enable `ayus-webhook`.

Setup:
```bash
# On the droplet: create a deploy key and authorize it
ssh-keygen -t ed25519 -f ~/.ssh/ayus_deploy -N ""
cat ~/.ssh/ayus_deploy.pub >> ~/.ssh/authorized_keys
cat ~/.ssh/ayus_deploy        # copy the PRIVATE key
```
In **GitHub → repo → Settings → Secrets and variables → Actions**, add:
`DROPLET_HOST` (IP), `DROPLET_USER` (e.g. `root`), `DROPLET_SSH_KEY` (the private
key above), and optionally `DROPLET_SSH_PORT`. Pushes to `main` now deploy via
the Actions tab (serialized; watch runs there). The SSH user needs docker access
(root, or a member of the `docker` group).

## 5. Backups (DB + uploads/PHI)
Nightly `pg_dump` + an archive of the uploads volume, kept `BACKUP_RETAIN_DAYS`
(default 14). Enable the timer:
```bash
sudo cp deploy/backup.service /etc/systemd/system/ayus-backup.service
sudo cp deploy/backup.timer   /etc/systemd/system/ayus-backup.timer
sudo systemctl enable --now ayus-backup.timer
bash deploy/backup.sh                         # run one now to verify
systemctl list-timers ayus-backup.timer       # confirm the schedule
```
Backups land in `/opt/ayus/backups/`. **Copy them off the droplet** — set
`SPACES_BUCKET`/`SPACES_ENDPOINT` in `.env` (+ the `aws` CLI and credentials) and
`backup.sh` pushes to DO Spaces automatically. A droplet-only backup won't
survive the droplet dying.

**Restore:**
```bash
# DB
gunzip -c backups/db-<ts>.sql.gz | docker compose exec -T -e PGPASSWORD=$PW postgres psql -U $USER -d $DB
# uploads
docker run --rm -v ayus_uploads:/data -v "$PWD/backups":/backup alpine \
  sh -c "cd /data && tar xzf /backup/uploads-<ts>.tar.gz"
```

## Notes
- **Migrations:** `deploy.sh` bootstraps a fresh DB from `init-db.sql`, then uses
  `prisma migrate deploy` for new migrations. Destructive schema changes should be
  reviewed manually.
- **CPU inference:** the default `.env` uses a **3B extractor** (`qwen2.5:3b`) so a
  report takes seconds, not minutes. OCR only runs on scanned PDFs. For better
  extraction with more RAM/GPU, switch to the 7B preset in `.env` and redeploy.
  Don't change `EMBED_MODEL` (its 768-dim output matches the pgvector column).
- **Local-only AI:** new orgs default to `OLLAMA_LOCAL`. To use a cloud provider,
  set it per-org in settings (or change the org default).
- **GLiNER/Docling sidecars** are off by default; add them as extra compose
  services when needed.
