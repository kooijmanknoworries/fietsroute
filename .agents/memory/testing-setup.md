---
name: testing-setup
description: How automated tests are wired in this pnpm monorepo (Vitest per artifact) and non-obvious gotchas.
---

# Testing setup

Tests use **Vitest**, configured per artifact (each artifact owns its
`vitest.config.ts`, a `test: vitest run` script, and colocated `*.test.ts(x)`
files). Run everything with root `pnpm test` (`pnpm -r --if-present run test`).
A validation command named `test` runs `pnpm run test`.

**Why per-artifact:** workspace packages export from `src/*.ts` (not built dist),
and the frontend needs jsdom + `@vitejs/plugin-react` while the API runs in node —
a single root config can't serve both cleanly.

## Gotchas

- **api-server route tests:** mounting a route on a bare Express app misses the
  `req.log` that `pino-http` normally attaches, so any handler error path that
  calls `req.log.error(...)` throws → Express returns 500 instead of the intended
  status. Attach a no-op `req.log` middleware in the test app to exercise error
  paths (e.g. the geocode 502).
- **Map / maplibre-gl tests:** maplibre needs WebGL (absent in jsdom). Mock
  `maplibre-gl` with a fake `Map` class. The mock factory is hoisted, so shared
  capture arrays must be created via `vi.hoisted(...)`, not plain top-level
  `const`, or you hit "Cannot access X before initialization".
- **typecheck:** `routeplanner/tsconfig.json` excludes `**/*.test.ts` but NOT
  `.test.tsx`; api-server includes all of `src`. Test files are still typechecked
  by `pnpm typecheck`, so keep their imports/types valid.
