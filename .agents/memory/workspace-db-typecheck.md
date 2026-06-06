---
name: Workspace lib typecheck (db, api-zod)
description: Keeping referenced @workspace/* declarations in sync for dependent typechecks
---
After adding/changing exports in a referenced workspace lib (`@workspace/db`, `@workspace/api-zod`, etc.), the api-server `typecheck` (and any consumer using TS project references) resolves the package via its emitted `dist/*.d.ts`, not the source.

**Why:** these libs are `composite` + `emitDeclarationOnly`; consumers reference them via `references` in tsconfig and read the stale `dist` declarations until regenerated. Note `@workspace/api-zod`'s package.json `exports` points at `src/index.ts`, but TS project references still consume its `dist` d.ts — so source can look right while typecheck fails.

**How to apply:** run `npx tsc -b lib/db/tsconfig.json` and/or `npx tsc -b lib/api-zod/tsconfig.json` (or build the package) after editing its schema/exports, otherwise consumers fail with `Module '"@workspace/..."' has no exported member 'X'`. api-zod codegen output lives in `lib/api-zod/src/generated/`. Note esbuild bundling of the api-server still works (it reads source), so a green build can mask a red typecheck.
