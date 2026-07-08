# Self-hosting Fietsrouteplanner with Docker Compose

Runs the whole stack on a single Linux machine (tested target: Core i7 /
16 GB RAM) with one command. Reuses the exact same Docker images as the
Azure deployment.

```
                 http://LAN-IP  (or https://thuis.nicokooijman.nl)
                          │
                    ┌─────▼─────┐
                    │   caddy   │  ports 80/443 — the ONLY public entrypoint
                    └─────┬─────┘  (auto-HTTPS once DOMAIN is set)
                    ┌─────▼─────┐
                    │    web    │  nginx: serves the web app at /
                    └─┬───────┬─┘         proxies /api and /mobile
             ┌────────▼──┐ ┌──▼───────┐
             │ api-server│ │  mobile  │  Expo Go bundles + QR landing page
             └────────┬──┘ └──────────┘
                ┌─────▼─────┐
                │ postgres  │  data in the `pgdata` Docker volume
                └───────────┘
```

## Prerequisites

- Linux with [Docker Engine + the compose plugin](https://docs.docker.com/engine/install/)
  (`docker compose version` should work; add your user to the `docker` group).
- `git`.
- A Clerk application ([clerk.com](https://clerk.com), free tier is fine) —
  you need its **publishable key** and **secret key**. A *development*
  instance (`pk_test_...`) works immediately on any address; a *production*
  instance (`pk_live_...`) requires your custom domain (see below).
- ~10 GB free disk (images + build cache + database).

## First start

```bash
git clone https://github.com/kooijmanknoworries/fietsroute.git
cd fietsroute/deploy/selfhost
cp .env.example .env
nano .env        # set POSTGRES_PASSWORD and the CLERK_* keys
                 # (PUBLIC_DOMAIN/DOMAIN are prefilled with thuis.nicokooijman.nl;
                 #  blank DOMAIN and set PUBLIC_DOMAIN to the LAN IP for HTTP-only)
docker compose up -d --build
```

The first build takes a while (~10–20 min on an i7): the mobile image runs a
full Metro/Expo export. Subsequent builds are much faster thanks to the
Docker build cache.

What happens on `up`:
1. Postgres starts with a persistent volume and a healthcheck.
2. The one-shot `migrate` service applies the database schema
   (`drizzle-kit push --force`) — safe to re-run, it's idempotent.
3. The API server starts and begins preloading the NL/BE cycling network
   from OpenStreetMap into Postgres (takes a while on first run; the app
   works during the preload, planning just falls back to live queries).
4. nginx (`web`) and Caddy come up; open **http://\<LAN-IP\>/** in a browser.

Check status and logs:

```bash
docker compose ps                 # all services Up, migrate Exited (0)
docker compose logs -f api-server # or: web, mobile, caddy, postgres
curl -s http://localhost/api/healthz
```

## The three addresses

| Path | What |
|---|---|
| `/` | web route planner |
| `/api/...` | API (health: `/api/healthz`) |
| `/mobile` | QR landing page for the Expo Go mobile app |

## Important: PUBLIC_DOMAIN is baked into the mobile app

The mobile bundles hardcode `https://<PUBLIC_DOMAIN>` for API calls and
assets at **build time**. Consequences:

- Changing `PUBLIC_DOMAIN` (e.g. LAN IP → custom domain) requires a rebuild:
  ```bash
  docker compose build mobile && docker compose up -d
  ```
  Riders then re-scan the QR code at `/mobile`.
- **The mobile app needs HTTPS.** While you're running plain HTTP on a LAN
  IP, the web app works fully, but the Expo Go mobile app cannot reach the
  API (it always calls `https://...`). The mobile app becomes usable once
  the custom domain + HTTPS is live.

## Going HTTPS on thuis.nicokooijman.nl (runbook)

The stack's public domain is **`thuis.nicokooijman.nl`**. The steps below take
you from LAN-HTTP + Clerk dev keys to HTTPS + a Clerk production instance.
Do them in order — Clerk production setup (step 3) needs the domain to be
serving HTTPS first.

### Step 1 — DNS and router (one-time, outside this stack)

1. **DNS**: create an `A` record for `thuis.nicokooijman.nl` pointing at your
   home connection's static public IP. Verify from any machine:
   ```bash
   dig +short thuis.nicokooijman.nl    # must print your public IP
   ```
2. **Router**: forward external TCP ports **80 and 443** to the home server.
   Let's Encrypt validates the domain by connecting to it on ports 80/443 —
   these EXTERNAL ports are non-negotiable. If ports 80/443 are taken on the
   machine itself, keep `HTTP_PORT`/`HTTPS_PORT` in `.env` at whatever free
   ports you chose, and have the router map external 80→`HTTP_PORT` and
   external 443→`HTTPS_PORT`. Without that mapping certificate issuance
   (and later renewal) fails.

### Step 2 — Turn on HTTPS (on the home server)

```bash
cd fietsroute/deploy/selfhost
nano .env      # set DOMAIN=thuis.nicokooijman.nl and PUBLIC_DOMAIN=thuis.nicokooijman.nl
docker compose build mobile        # rebake the HTTPS domain into the bundles
docker compose up -d               # Caddy now auto-issues a Let's Encrypt cert
```

Caddy handles certificate issuance and renewal automatically (certificates
persist in the `caddy_data` volume). Port 80 redirects to 443. Check:

```bash
docker compose logs caddy | grep -i -E 'certificate|acme|error'
curl -sI https://thuis.nicokooijman.nl | head -1     # HTTP/2 200
```

At this point the site runs on HTTPS but still with the Clerk **development**
keys — sign-in works, with the dev-instance user cap and banner. Continue to
step 3 for production sign-in.

### Step 3 — Clerk production instance

| | Development (`pk_test_...`) | Production (`pk_live_...`) |
|---|---|---|
| Works on | any address (LAN IP, any domain) | only `thuis.nicokooijman.nl` |
| `CLERK_PROXY_URL` | leave **empty** | set to `/api/__clerk` |
| Limits | Clerk dev-instance limits (user cap, "development" banner) | none |

In the [Clerk dashboard](https://dashboard.clerk.com):

1. Open your application and **create the production instance** (top-left
   instance switcher → "Production"). Enter `thuis.nicokooijman.nl` as the
   domain when asked.
2. **Enable proxy mode** for the Frontend API: *Configure → Domains →
   Frontend API → Advanced → Proxy*, and set the proxy URL to
   ```
   https://thuis.nicokooijman.nl/api/__clerk
   ```
   Clerk verifies the proxy by calling that URL, so the stack must already be
   up on HTTPS (step 2). The api-server serves this proxy automatically in
   production mode — no extra config on the server side.
   With proxy mode on you do **not** need the `clerk.` Frontend-API CNAME
   record.
3. **Add the DNS records Clerk still asks for** on the Domains page
   (names shown here relative to `nicokooijman.nl`; your DNS provider may
   want the full name):
   - `accounts.thuis` → CNAME `accounts.clerk.services` (Account Portal;
     needed for hosted sign-in pages)
   - `clkmail.thuis` → CNAME (value shown in the dashboard — email sending)
   - `clk._domainkey.thuis` and `clk2._domainkey.thuis` → CNAMEs (values
     shown in the dashboard — DKIM for email)
   Wait until the dashboard shows all records verified.
4. If you use social login (e.g. Google), production instances require your
   **own OAuth credentials**: follow the dashboard's *Configure → SSO
   connections* instructions for each provider. Email-code sign-in works
   without extra setup.
5. Copy the production **`pk_live_...`** and **`sk_live_...`** keys
   (*Configure → API keys*).

Then on the home server:

```bash
nano .env      # set CLERK_PUBLISHABLE_KEY=pk_live_..., CLERK_SECRET_KEY=sk_live_...,
               # and CLERK_PROXY_URL=/api/__clerk
docker compose build web mobile    # both bake the key + proxy path in
docker compose up -d
```

Note: users of a dev instance do not carry over to a production instance —
they sign up again (and need to be re-approved in the app's access list).

### Step 4 — Smoke-test checklist

- [ ] `curl -sI https://thuis.nicokooijman.nl | head -1` → `HTTP/2 200`, and
      the browser shows a valid Let's Encrypt padlock (no warnings)
- [ ] `curl -s https://thuis.nicokooijman.nl/api/healthz` → `{"status":"ok"}`
- [ ] `curl -sI https://thuis.nicokooijman.nl/api/__clerk/v1/environment | head -1`
      → a non-5xx response (Clerk proxy is wired through)
- [ ] Web: open https://thuis.nicokooijman.nl, sign in, plan a route, save it
- [ ] Mobile: open https://thuis.nicokooijman.nl/mobile on the phone, scan the
      QR code in Expo Go — app loads over HTTPS and sign-in works
- [ ] `docker compose logs caddy` shows no recurring ACME errors

## Updating to the latest code

```bash
cd fietsroute
git pull
cd deploy/selfhost
docker compose build
docker compose up -d       # migrate re-applies any schema changes automatically
```

Optional alternative: the GitHub Actions workflow already pushes images to a
registry for Azure. You can mirror that idea (push to Docker Hub/GHCR from
CI, replace the `build:` sections here with `image:` references, and update
with `docker compose pull && docker compose up -d`) — useful if the self-host
machine is too slow to build.

## Backups

The only irreplaceable data is in Postgres (`saved_routes`,
`visited_segments`, `user_access`); the network/cache tables are rebuildable.

Manual backup / restore:

```bash
docker compose exec postgres pg_dump -U fietsroute -Fc fietsroute > backup-$(date +%F).dump
# restore (into a running stack; drops and recreates objects):
docker compose exec -T postgres pg_restore -U fietsroute -d fietsroute --clean --if-exists < backup-2026-07-07.dump
```

Nightly cron example (3:00, keep 14 days):

```cron
0 3 * * * cd /path/to/fietsroute/deploy/selfhost && docker compose exec -T postgres pg_dump -U fietsroute -Fc fietsroute > /path/to/backups/fietsroute-$(date +\%F).dump && find /path/to/backups -name 'fietsroute-*.dump' -mtime +14 -delete
```

## Moving data from Azure (or Replit) to this stack

```bash
# 1. Dump from the old database (any machine that can reach it):
pg_dump 'postgresql://USER:PASS@old-host:5432/fietsroute?sslmode=require' -Fc -f fietsroute.dump

# 2. Copy the dump to the self-host machine, then restore:
cd fietsroute/deploy/selfhost
docker compose up -d postgres          # ensure db is up
docker compose exec -T postgres pg_restore -U fietsroute -d fietsroute --clean --if-exists < fietsroute.dump
docker compose up -d                   # start/restart the rest
```

Tip: if the dump is large, you can skip the rebuildable cache tables and let
the API re-import the cycling network on first start:
`pg_dump ... --exclude-table-data 'network_*' --exclude-table-data 'overpass_cache' --exclude-table-data 'geocode_cache'`.

Caveat: Clerk users are tied to the Clerk instance, not the database. If you
also switch Clerk instances, users re-register and get new Clerk ids, while
`user_access` / `saved_routes` / `visited_segments` reference the old ids —
plan a manual remap if that history must carry over.

## Troubleshooting

| Symptom | Check |
|---|---|
| Site unreachable | `docker compose ps` — is `caddy` up? Ports 80/443 free on the host? (change `HTTP_PORT`/`HTTPS_PORT` in `.env` if taken — but in HTTPS mode the router must still map external 80/443 to them, see above) |
| `migrate` failed | `docker compose logs migrate` — usually a wrong `POSTGRES_PASSWORD` after the volume was already initialized with another one (see below) |
| Changed `POSTGRES_PASSWORD` but auth fails | the password is set on first init only; either restore the old value or reset the volume: `docker compose down -v` (**deletes all data**) |
| Sign-in doesn't work | Clerk keys in `.env`, and `CLERK_PROXY_URL` matches the instance type; remember `web`/`mobile` need a rebuild after changing them |
| Mobile app can't connect | expected on plain-HTTP LAN mode; needs `DOMAIN` + HTTPS, and `PUBLIC_DOMAIN` rebaked (`docker compose build mobile`) |
| No HTTPS certificate | DNS A record propagated? Ports 80+443 forwarded? `docker compose logs caddy` shows ACME errors |
| Route planning slow at first | network preload still running: `curl -s http://localhost/api/network/status` |
