---
name: Azure deployment topology
description: Containerization/deploy design for running the app outside Replit (Azure), and the constraints that shaped it
---

# Azure deployment topology

**Rule:** When hosting outside Replit, `/`, `/api`, and `/mobile` must stay behind ONE public domain. The nginx container in the web image is the public entrypoint and path-routes to the api and mobile containers (their origins injected via `API_ORIGIN`/`MOBILE_ORIGIN` env, envsubst template).

**Why:** The web app calls same-origin `/api/...` (no `setBaseUrl` on web), and the mobile bundles call `https://EXPO_PUBLIC_DOMAIN/api/...` where EXPO_PUBLIC_DOMAIN is also where manifests/bundles are fetched. Splitting these across domains breaks both clients.

**How to apply:** Dockerfiles live in each artifact dir but build from the repo root (pnpm workspace context, `.dockerignore` at root). Workspace libs export TS source directly (`"." : "./src/index.ts"`), so no lib dist build step is needed inside images — esbuild/vite compile from source.

Other verified facts:
- api-server esbuild output (`dist/*.mjs` incl. pino worker files) is fully self-contained; runtime image needs only `dist/` + node. Verified by running from a dist-only copy.
- Clerk middleware 500s ALL routes (even `/api/healthz`) if `CLERK_PUBLISHABLE_KEY` is malformed — a test key must be `pk_test_` + base64 of `host$` (trailing `$` required).
- Vite build requires `PORT` and `BASE_PATH` env even for static builds (vite.config throws).
- pg_dump/pg_restore migration tested: `-Fc --no-owner --no-privileges` dump, restore with `--clean --if-exists`; `CREATE DATABASE` works on the Replit-managed PG for scratch restore tests. Use exact counts (`query_to_xml` trick) for verification — `pg_stat_user_tables.n_live_tup` can be badly stale (showed 0 for a 394k-row table).
- Mobile image build runs the same `scripts/build.js` Metro export used for Replit publishing, with `EXPO_PUBLIC_DOMAIN`/`BASE_PATH`/`CLERK_*` as build args; domain is baked in, so domain changes require an image rebuild.

Verified in a full live deploy (real Azure infra, pipeline green, all 3 endpoints served):
- **Region:** a subscription may reject new Container Apps/Postgres capacity in `westeurope`; `northeurope` accepted. Pick a region with quota, keep everything in it.
- **DB restore cannot run from Replit:** outbound TCP 5432 is firewalled from the Replit shell AND from Docker containers. Restore from a host with 5432 egress. The committed `.github/workflows/azure-db-restore.yml` does it from a GH runner (uploads dump as a `db-migration-snapshot` release asset, opens PG firewall to runner IP, runs restore-azure-db.sh, closes rule). Delete that release afterward — the dump contains user_access Clerk ids.
- **az firewall-rule flags differ by version:** current az uses `--server-name <server>` + `--name <rule>`; older used `--name <server>` + `--rule-name <rule>`.
- **ACR pull:** the deploy SP (Contributor) can't self-assign AcrPull role, so container apps were wired with ACR admin registry creds instead of managed-identity role.
- **API needs restore before it serves data:** api-server does not create schema at boot; if it starts against an empty DB, restart the revision after the restore completes. Data endpoints (e.g. `/api/network/status`) require Clerk auth so return 401 unauthenticated — that 401 is proof the API + auth layer is live; `/api/healthz` (no auth) is the liveness check.
