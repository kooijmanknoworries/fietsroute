---
name: API server has no hot reload
description: Why server-side edits don't take effect until the api-server workflow is restarted
---

The `@workspace/api-server` dev workflow runs `build && start` (esbuild bundle, then `node dist/index.mjs`). There is no watch/hot-reload.

**Why:** Editing server source (routes, lib/osm/*, etc.) does NOT update the running process. curl/e2e tests will keep hitting the old compiled `dist` and show stale behavior, which looks like "my change had no effect."

**How to apply:** After any api-server code change, restart the `artifacts/api-server: API Server` workflow before testing the endpoints. The routeplanner web app (Vite) and mockup-sandbox DO hot-reload; only the api-server needs a manual restart.
