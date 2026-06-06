---
name: vitest setup (api-server + routeplanner)
description: How committed automated tests run for the Express api-server (vitest + supertest + Clerk auth) and the routeplanner frontend (vitest + jsdom + Testing Library)
---

# Frontend (routeplanner) tests

Tests live as `src/**/*.test.{ts,tsx}`, run with `vitest run` (`pnpm --filter
@workspace/routeplanner test`). `vitest.config.ts` uses `environment: "jsdom"`,
`globals: true`, the `workspace` resolve condition, and the `@` -> `src` alias
(mirroring vite.config.ts). The whole project test validation is `pnpm -r
--if-present run test`.

**Mock Clerk + the generated API client** rather than rendering heavy components.
The import-prompt logic lives entirely in the `useClaimAnonymousRoutes` hook
(Home.tsx binds `<Dialog open={canClaim}>` and its buttons straight to the hook),
so test the hook with `renderHook` + a `QueryClientProvider` wrapper, mocking
`@clerk/react` `useAuth` and `@workspace/api-client-react`
(`useClaimSavedRoutes`, `getListSavedRoutesQueryKey`). Don't try to render Home —
it pulls in maplibre-gl which needs WebGL/canvas and breaks in jsdom.

# Testing the Express api-server

Tests live as `src/**/*.test.ts` in `artifacts/api-server`, run with `vitest run`
(`pnpm --filter @workspace/api-server test`). Registered as the `test` validation.

**Vitest must resolve the `workspace` export condition** (`resolve.conditions:
["workspace"]` in `vitest.config.ts`) so `@workspace/db` / `@workspace/api-zod`
import their TypeScript source, matching `customConditions` in `tsconfig.base.json`.
Without it those imports fail.

**Auth in route tests:** the routes read the signed-in user via `getAuth(req)` from
`@clerk/express`. Mock the whole module — `vi.mock("@clerk/express", () => ({ getAuth:
() => ({ userId: currentUserId }) }))` — and flip a module-level `currentUserId` per
test. No real Clerk needed.

**Handlers expect `req.log`** (added by pino-http in prod). In tests attach a tiny
middleware setting `req.log = console` before mounting the router, or error paths throw.

**Shared dev DB:** tests hit the real `DATABASE_URL`. Generate unique owner keys
(`randomUUID()`), track inserted row ids, and delete them in `afterAll` — never assert
on absolute row counts.
