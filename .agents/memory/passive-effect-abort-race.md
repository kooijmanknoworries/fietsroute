---
name: passive-effect abort race in RTL tests
description: Why a "start ride" style action can be silently reverted right after a click in vitest/RTL, and how to make it deterministic.
---

When an effect keyed on some state (e.g. `useEffect(..., [routePlan])` in `hooks/useRide.ts`) *aborts* an action when that state changes, a React-Testing-Library test can be flaky: the state update (async plan resolution) is committed during `waitFor`, but its passive effect has not flushed yet. If the test then fires the start click inside `act`, the guard ref (`ridingRef.current = true`) is set *before* the still-pending passive effect runs — so that effect fires with the ref already true and immediately undoes the just-started action. Symptom: click handler runs with correct preconditions, but the next render shows the started flag back to false.

**Why:** React 18 flushes passive (`useEffect`) effects asynchronously after commit; RTL `waitFor` can observe the DOM before those effects flush, and the next `act` flushes them at the wrong moment.

**How to apply:** In production this is not hit (a real user acts hundreds of ms after the state settles, so the effect flushes first). Fix the *test*, not the ride logic: after `waitFor(...startButton...)` and before firing the start click, flush pending passive effects with `await act(async () => { await Promise.resolve(); });`. Adding console/logging inside the effect masks the race (Heisenbug) — do not "fix" it that way.
