---
name: expo-router test files break native production bundle
description: Why test files must never live under the mobile app/ directory, or the Expo production build fails
---

Expo Router auto-bundles **every** file under `artifacts/mobile/app/` as a route. A test file placed there (e.g. `app/*.test.tsx`) gets pulled into the native production bundle, dragging in `vitest → vite/dist/node/module-runner.js`, whose dynamic `import(filepath)` Metro cannot transform in production (`dev=false, minify=true`). Result: iOS/Android bundling fails partway with an opaque `Download failed: HTTP 500` during `expo export` / the mobile publish build.

**Rule:** keep tests OUT of `app/`. Co-locate them next to non-route source (e.g. `components/`, `context/`, `lib/`) or under `test/`. Vitest still finds them via `include: ["**/*.test.{ts,tsx}"]`. Use the `@/` alias (maps to mobile root) for imports back into `app/`, e.g. `import Screen from "@/app/saved"`.

**Why:** only `app/` is scanned by expo-router; other dirs aren't bundled unless reached from the entry graph, so test files elsewhere are harmless.

**How to apply:** when adding a test for a route screen, put it in `test/` (not `app/`). To debug an opaque mobile publish `HTTP 500`, run `pnpm exec expo export --platform ios` locally — it prints the real transform error that `scripts/build.js` swallows.
