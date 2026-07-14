# Fietsrouteplanner — Infrastructure overview

Reference document for humans and AI assistants: how the whole setup fits
together, what it depends on, and how to operate it.

## The three environments

1. **Replit workspace (development)** — where the app is built and changed.
   Every completed change is automatically pushed to GitHub.
2. **GitHub** (`kooijmanknoworries/fietsroute`) — the single source of truth
   for the code. The home server pulls from here; it never talks to Replit
   directly.
3. **Ubuntu home server (production)** — runs the live app via Docker Compose
   from `fietsroute/deploy/selfhost/`.
   - LAN IP: `192.168.3.71`
   - Public IP: `84.31.83.101`
   - Domain: `thuis.nicokooijman.nl` (DNS A record → public IP)

Code flows one way: Replit → GitHub → home server (`git pull`).
Data (the Postgres database) lives only on the home server.

## What runs on the server (Docker Compose stack)

All containers use `restart: unless-stopped`, so the whole stack survives
reboots automatically (Docker itself starts on boot via systemd).

| Container | Role |
|---|---|
| `caddy` | The only public entrypoint (ports 80/443). Serves `https://thuis.nicokooijman.nl` with automatic Let's Encrypt certificates, and `http://192.168.3.71` for plain-HTTP LAN access. Proxies everything to `web`. |
| `web` | nginx: serves the web route planner at `/`, routes `/api/*` → api-server and `/mobile` → mobile. |
| `api-server` | Node.js API. Talks to Postgres. On first start it preloads the entire NL/BE cycling-node network from OpenStreetMap (Overpass 429/504 warnings in its logs during this are normal rate-limiting, retried automatically). |
| `mobile` | Serves the Expo Go phone-app bundles + QR landing page at `/mobile`. The public domain is **baked in at build time** — changing `PUBLIC_DOMAIN` requires `docker compose build mobile`. |
| `postgres` | The database. All data lives in the `pgdata` Docker volume. Irreplaceable tables: `saved_routes`, `visited_segments`, `user_access`; the network/cache tables are rebuildable. |
| `migrate` | One-shot: applies the database schema on every `up`. Normal state: `Exited (0)`. |

## External dependencies

- **Clerk** (clerk.com) — sign-in / user accounts. Development keys
  (`pk_test_`/`sk_test_`) work on any address; production keys (`pk_live_`)
  only on the domain. Keys live in `deploy/selfhost/.env` (never in the repo).
- **OpenStreetMap services** — Overpass API (cycling network), Nominatim
  (place search), elevation APIs. All results are cached in Postgres, so
  outages degrade gracefully.
- **Let's Encrypt** — free HTTPS certificates via Caddy; requires external
  ports 80 **and** 443 forwarded to the server.

## Network requirements (router)

| External port | Forwards to | Purpose |
|---|---|---|
| 80 | 192.168.3.71:80 | HTTP + Let's Encrypt validation (mandatory) |
| 443 | 192.168.3.71:443 | HTTPS |

Note: testing the public domain from *inside* the LAN may fail on routers
without NAT hairpin support — test from mobile data, or use the LAN URL.

## Key files on the server (`fietsroute/deploy/selfhost/`)

- `.env` — all secrets/config: Postgres password, Clerk keys, `DOMAIN`,
  `PUBLIC_DOMAIN`. **Not in git — keep a backup copy somewhere safe.**
- `docker-compose.yml` — the stack definition.
- `Caddyfile` — public HTTPS site + LAN HTTP site.
- `README.md` — full runbook: first start, HTTPS/Clerk-production switch,
  backups, moving data, troubleshooting.

## Routine operations

```bash
# Update to the latest code
cd fietsroute && git pull
cd deploy/selfhost && docker compose build && docker compose up -d

# Status / logs
docker compose ps
docker compose logs -f api-server

# Backup (see README for the nightly cron example)
docker compose exec postgres pg_dump -U fietsroute -Fc fietsroute > backup-$(date +%F).dump
```

## Addresses

| URL | What |
|---|---|
| `https://thuis.nicokooijman.nl/` | web route planner (public, HTTPS) |
| `http://192.168.3.71/` | web route planner (LAN only, plain HTTP) |
| `.../api/healthz` | API health check |
| `.../mobile` | QR landing page for the Expo Go mobile app (needs HTTPS) |
