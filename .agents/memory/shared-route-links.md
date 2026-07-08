---
name: Public shared route links
description: How share links stay public and what the auth-gate test requires.
---

# Shared route links

- `GET /api/shared/:token` and the web page `/shared/:token` are public by design (recipients have no account). The public Express router is mounted ABOVE the global requireAuth gate; the POST that creates links sits below it (requireAuth + requireApproved).
- **Auth-gate test:** `routes/index.test.ts` enforces that everything above the gate is allowlisted by router identity (`PUBLIC_ROUTER_HANDLES`) and probes every endpoint for 401 (`PUBLIC_ALLOWLIST`, keys like `GET /api/shared/1`). Any new public router must be added to BOTH sets or the suite fails.
- **Why:** the invariant protects against accidentally exposing authed routers; deliberate public surfaces must be opted in explicitly.
- Print support: `.no-print` hides the app UI, `.print-only` shows the RouteSheet (plain CSS in routeplanner `index.css`); the shared page and Home both reuse `RouteSheet` (pure-SVG schematic map so print needs no tiles/WebGL).
- Seeding `shared_routes` by hand: node `id`s are strings and `plan` must include `nodeRefs`, or the GET 502s on zod parse.
- Share links hydrate the planner: `/?shared=<token>` (query param) with a sessionStorage stash fallback so the token survives a forced sign-in redirect that drops query params; the `/shared/:token` page remains the no-login view.
- E2E of signed-in planner flows works via the SwiftShader chromium + Clerk ticket sign-in recipe in `maplibre-webgl.md` (verified again 2026-07-08).
