---
name: Workspace db typecheck
description: Keeping @workspace/db declarations in sync for dependent typechecks
---
After adding/changing exports in `@workspace/db` (e.g. a new schema table), the api-server `typecheck` (and any consumer using TS project references) resolves the package via its emitted `dist/*.d.ts`, not the source.

**Why:** `lib/db` is `composite` + `emitDeclarationOnly`; consumers reference it via `references` in tsconfig and read the stale `dist` declarations until they are regenerated.

**How to apply:** run `npx tsc -b lib/db/tsconfig.json` (or push/build the db package) after editing its schema/exports, otherwise consumers fail with `Module '"@workspace/db"' has no exported member 'X'`. Note esbuild bundling of the api-server still works (it reads source), so a green build can mask a red typecheck.
