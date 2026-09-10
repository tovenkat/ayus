# Multiple domains on one droplet (host Nginx reverse proxy)

Run several sites on the same droplet with **one host-level Nginx** owning ports
80/443 and terminating TLS, routing each domain to a dockerized app bound to a
private localhost port. Ayus drops its built-in Caddy in this mode.

```
Internet ─▶ Nginx (:80/:443, TLS via certbot)
              ├─ ayus.in           → 127.0.0.1:3000  (this app)
              ├─ other-site.com    → 127.0.0.1:3001  (another container)
              └─ …                 → 127.0.0.1:30xx
```

## 1. Put Ayus in nginx mode
In `/opt/ayus/.env`:
```bash
REVERSE_PROXY=nginx      # app publishes 127.0.0.1:3000; Caddy releases 80/443
# APP_PORT=3000          # change if 3000 is taken by another app
```
Redeploy: `bash deploy/deploy.sh`. The app is now reachable only at
`http://127.0.0.1:3000` on the droplet (not the public 80/443).

## 2. Install Nginx + certbot
```bash
apt-get update && apt-get install -y nginx certbot python3-certbot-nginx
# free 80/443 for nginx; the app no longer needs them
ufw allow 'Nginx Full'; ufw delete allow 9000/tcp 2>/dev/null || true
```

## 3. Front Ayus (ayus.in)
Make sure `ayus.in`'s DNS A record points at the droplet, then:
```bash
cp /opt/ayus/deploy/nginx/ayus.in.conf /etc/nginx/sites-available/ayus.in
ln -s /etc/nginx/sites-available/ayus.in /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default          # drop the welcome page
nginx -t && systemctl reload nginx
certbot --nginx -d ayus.in -d www.ayus.in       # TLS + auto 80→443 redirect
```
Open **https://ayus.in**. (Keep `NEXTAUTH_URL=https://ayus.in` in `.env` — the app
builds HTTPS URLs from Nginx's `X-Forwarded-Proto`.)

## 4. Add another domain
1. Run that app so it publishes a **unique** localhost port, e.g.
   `127.0.0.1:3001`. (Another Ayus instance? clone to a different dir — the
   compose project name changes — and set `APP_PORT=3001` in its `.env`.)
2. Add its Nginx server block:
   ```bash
   cp /opt/ayus/deploy/nginx/second-app.conf.example /etc/nginx/sites-available/other-site.com
   nano /etc/nginx/sites-available/other-site.com     # set server_name + proxy_pass port
   ln -s /etc/nginx/sites-available/other-site.com /etc/nginx/sites-enabled/
   nginx -t && systemctl reload nginx
   certbot --nginx -d other-site.com
   ```
Repeat per domain. certbot auto-renews (a systemd timer it installs).

## Notes
- **Use one proxy, not two.** In nginx mode the compose Caddy binds no ports, so
  it's inert — but don't also run a separate Caddy on 80/443.
- **Firewall:** only `80`, `443`, and `22` need to be open now. The app port is
  `127.0.0.1`-only (not reachable from outside).
- **Big uploads:** `client_max_body_size 60M` in the Ayus server block matches the
  50 MB upload cap — raise both together if you increase it.
- **Switching back** to the single-domain Caddy setup: set `REVERSE_PROXY=caddy`,
  stop Nginx (`systemctl disable --now nginx`), and redeploy.
