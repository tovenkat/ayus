# Deploy checklist (ayus.in droplet)

Run these after pushing new commits. Assumes host-Nginx mode (`REVERSE_PROXY=nginx`).

```bash
# Handy alias for every command below:
cd /opt/ayus
DC="docker compose -f docker-compose.yml -f docker-compose.nginx.yml"
```

## 1. Ship the code (from your Mac)
```bash
cd /Users/venkat/development/phr2
git push origin main
```
The webhook / GitHub Action rebuilds the droplet. Watch it:
`journalctl -u ayus-webhook -f`  (or the GitHub **Actions** tab).

Confirm the droplet actually moved to the latest commit:
```bash
cd /opt/ayus && git log --oneline -1   # should match your local HEAD
```

## 2. `.env` keys on the droplet
The live `.env` predates several features. Ensure these are set (idempotent — safe to re-run):

```bash
cd /opt/ayus

# ── Required: secret that encrypts per-account BYOK keys (set ONCE, never change)
grep -q '^ENCRYPTION_KEY=' .env || echo "ENCRYPTION_KEY=$(openssl rand -hex 32)" >> .env

# ── Auth behind the reverse proxy (the code also sets trustHost; this is belt-and-suspenders)
grep -q '^AUTH_TRUST_HOST=' .env || echo "AUTH_TRUST_HOST=true" >> .env

# ── Demo OTP autofill (123456) so reviewers can click Sign in
grep -q '^DEMO_OTP_AUTOFILL=' .env || echo "DEMO_OTP_AUTOFILL=true" >> .env

# ── Models: 8 vCPU / 32 GB preset (7B chat+extract)
sed -i 's/^CHAT_MODEL=.*/CHAT_MODEL=qwen2.5:7b-instruct/'       .env
sed -i 's/^EXTRACT_MODEL=.*/EXTRACT_MODEL=qwen2.5:7b-instruct/' .env
sed -i 's#^OLLAMA_MODELS=.*#OLLAMA_MODELS=qwen2.5:7b-instruct deepseek-ocr:latest nomic-embed-text#' .env

# ── Ollama keep-warm / parallelism (good on 32 GB)
for kv in OLLAMA_KEEP_ALIVE=-1 OLLAMA_MAX_LOADED_MODELS=3 OLLAMA_NUM_PARALLEL=2 \
          RAG_CHUNK_LIMIT=6 RAG_CHUNK_CHARS=800 CHAT_NUM_CTX=4096 CHAT_NUM_PREDICT=1024; do
  k="${kv%%=*}"; grep -q "^${k}=" .env && sed -i "s#^${k}=.*#${kv}#" .env || echo "$kv" >> .env
done

# ── Optional: GLiNER NER sidecar (clinical PDFs). Needs the 8 GB+ droplet.
grep -q '^ENABLE_GLINER=' .env && sed -i 's/^ENABLE_GLINER=.*/ENABLE_GLINER=true/' .env || echo "ENABLE_GLINER=true" >> .env

# Sanity-check what you ended up with:
grep -E '^(ENCRYPTION_KEY|AUTH_TRUST_HOST|DEMO_OTP_AUTOFILL|CHAT_MODEL|EXTRACT_MODEL|OLLAMA_MODELS|OLLAMA_KEEP_ALIVE|OLLAMA_MAX_LOADED_MODELS|OLLAMA_NUM_PARALLEL|RAG_CHUNK_LIMIT|CHAT_NUM_CTX|CHAT_NUM_PREDICT|ENABLE_GLINER)=' .env
```

## 3. Apply + pull models
```bash
bash deploy/deploy.sh          # rebuilds, recreates containers, pulls OLLAMA_MODELS,
                               # runs `prisma migrate deploy` (applies new migrations),
                               # and (ENABLE_GLINER=true) builds + starts the gliner sidecar

# If you only edited .env (no redeploy needed), just recreate the affected containers:
$DC up -d app ollama
$DC exec -T ollama ollama pull qwen2.5:7b-instruct   # if not already pulled
```

**DB migration:** `deploy.sh` runs `prisma migrate deploy`, which applies the
`cloudExtractionOptIn` migration. The settings page selects that column, so the
migration must land or `/settings` 500s — `deploy.sh` runs it *before* starting
the app, so a normal deploy handles it. Verify:
```bash
$DC exec -T -e PGPASSWORD="$(grep '^POSTGRES_PASSWORD=' .env|cut -d= -f2-)" postgres \
  psql -U "$(grep '^POSTGRES_USER=' .env|cut -d= -f2-)" -d "$(grep '^POSTGRES_DB=' .env|cut -d= -f2-)" \
  -c '\d "User"' | grep cloudExtractionOptIn || echo "⚠ migration not applied — run: $DC run --rm migrate npx prisma migrate deploy"
```

**Gotcha — changing a model name:** editing `CHAT_MODEL`/`EXTRACT_MODEL`/
`OLLAMA_MODELS` in `.env` does **not** fetch the model. Either run `deploy.sh`
(it pulls `OLLAMA_MODELS`) or `ollama pull <model>` manually — otherwise uploads
hang right after "mean quality …" because Ollama is asked for a model it lacks.

## 4. Re-seed demo data (DB already exists → seeding doesn't auto-run)
```bash
$DC run --rm migrate npm run personal:seed-demo   # richer Aarav: 6 reports, all 16 organs,
                                                  # meds, meals, visits, PERSONAL tier + privacy off
# (full reset of all demo accounts, if ever needed: npm run seed:demo)
```

## 5. Verify
```bash
$DC ps                                             # all containers up
$DC exec -T ollama ollama list                     # 7B + deepseek-ocr + nomic-embed present
$DC exec -T app sh -c "wget -qO- http://ollama:11434/api/version"   # app → ollama OK
curl -I https://ayus.in                            # 200/redirect, valid TLS
$DC logs --tail=40 app | grep -iE "error|fetch|untrustedhost" || echo "app clean"
# GLiNER (if enabled):
docker compose -f docker-compose.yml -f docker-compose.nginx.yml --profile gliner \
  exec -T gliner python -c "import urllib.request;print(urllib.request.urlopen('http://localhost:8001/health').read())"
```

## 6. Smoke test in the browser
- **https://ayus.in/login** → `+910000000001` (country dropdown 🇮🇳 +91) → OTP prefilled `123456` → dashboard.
- Dashboard shows status pie + all-organ anatomy, Today's Medications/Meals, Recent Doctor Visits.
- Header **logo** clickable; mobile shows the **Sign in** button; favicon is the Ayus mark.
- **Settings → AI**: cloud providers (Gemini/OpenAI/Claude) selectable on **any tier incl. FREE** (BYOK).
  Paste a provider key — it's **validated on save** (a bad key is rejected immediately).
  By default **extraction stays local**; the "use my key for extraction too" toggle opts in.
- Logged-in user: **logo/user-menu → Home page** shows the marketing page with a "Go to Dashboard" CTA.
- Upload a **lab PDF** (extraction) and a **prescription PDF** (GLiNER path, if enabled).

## ⚠️ Before a real (non-demo) launch
- `SEED_DEMO=false`, remove the demo accounts (fixed OTP `123456`).
- `DEMO_OTP_AUTOFILL=false`.
- `ENABLE_GLINER` as you want it.
- Rotate any API keys that were ever pasted into chat/logs.
- Confirm nightly backups: `systemctl list-timers ayus-backup.timer`.
