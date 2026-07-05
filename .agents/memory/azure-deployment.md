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
