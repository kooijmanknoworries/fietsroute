---
name: Route draft persistence (web)
description: How the web planner keeps an in-progress route across a forced sign-in redirect, and the remount clobber gotcha.
---

On web, a Clerk session expiring mid-planning makes `HomeGate`'s `<Show when="signed-out">` redirect to `/sign-in`, which **unmounts `Home`** and drops the in-progress route (selectedNodes + routePlan live as local state in `useRoutePlanner`). Mobile is unaffected — its `RoutePlannerProvider` sits above the router.

Fix: `useRoutePlanner` autosaves `{ selectedNodes, routePlan }` to `sessionStorage`, keyed per Clerk `userId` (`fietsrouteplanner.routeDraft.<userId>`), and restores it on mount. See `lib/route-draft.ts`.

**Why sessionStorage keyed by userId:** per-tab scope survives the redirect (and an OAuth round-trip) without becoming an eternal autosave; the userId key prevents one account's draft leaking into another's session.

**Clobber gotcha (the non-obvious part):** the persist effect must be gated behind a `persistReady` flag that only flips true *after* the restore pass runs. On remount both the restore and persist effects fire in the same commit with the initial *empty* state still in the persist effect's closure — without the gate it writes an empty draft over the stored one before the restored state is applied. An empty draft (`selectedNodes:[]` && no plan) removes the storage slot so a cleared route doesn't resurrect.
