---
name: Routeplanner typecheck gotchas
description: Pre-existing typecheck noise in artifacts/routeplanner and how to tell it apart from real errors
---

# Routeplanner typecheck gotchas

`pnpm --filter @workspace/routeplanner run typecheck` can fail for two reasons
unrelated to the code you just changed:

1. **Stale referenced-lib dist.** routeplanner references `@workspace/api-client-react`
   via TS project references, which resolve to that lib's `dist/*.d.ts`, not its
   `src`. After the client is regenerated (orval) but its dist isn't rebuilt, tsc
   reports `has no exported member 'useListVisitedSegments'` etc. even though the
   source clearly exports them. Fix: `pnpm exec tsc -b lib/api-client-react/tsconfig.json`.

2. **Duplicate @types/react (false positive).** node_modules has two @types/react
   copies (e.g. 19.1.17 and 19.2.14). This produces `Two different types with this
   name exist, but they are unrelated` / `VoidOrUndefinedOnly` errors on lucide-react
   icon `ref` props (surfaces in `src/components/ui/spinner.tsx`). This is a workspace
   dedup issue, not your code — adding/using more lucide icons does not cause it.

**How to apply:** if your typecheck failures are only the spinner.tsx ref/
VoidOrUndefinedOnly errors, treat them as pre-existing baseline noise.
