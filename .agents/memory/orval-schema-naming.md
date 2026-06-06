---
name: Orval schema name collisions
description: Why response component schema names must not match the auto-generated zod <OperationId>Response/Body names
---
When adding an endpoint to `lib/api-spec/openapi.yaml`, orval's zod codegen auto-creates schemas named `<OperationId>Body` (request) and `<OperationId>Response` (response). The component `schemas:` you define also get emitted as TypeScript types with the same names.

**Why:** If you name a `components.schemas` entry exactly `<OperationId>Response` (e.g. operationId `claimSavedRoutes` + a schema `ClaimSavedRoutesResponse`), both `generated/api` and `generated/types` export that identifier and `tsc` fails with TS2308 "already exported a member". This is why the existing spec names the saveRoute response schema `SavedRoute`, not `SaveRouteResponse`.

**How to apply:** Name response component schemas something that does NOT collide with `<OperationId>Response` — e.g. `...Result` or a domain noun. Request body component schemas named `...Request` are fine (zod body schema is `...Body`). Run `pnpm --filter @workspace/api-spec run codegen` (it also runs `typecheck:libs`) to catch collisions.
