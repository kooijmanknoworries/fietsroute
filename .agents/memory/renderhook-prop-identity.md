---
name: renderHook prop identity
description: Per-render object props in renderHook silently trip identity-based effects in hooks under test
---

Rule: when testing a hook whose effects key on object prop identity (e.g. useRide ends the ride when `routePlan` changes), the test must pass a referentially stable object — build it once outside the renderHook callback.

**Why:** `renderHook(() => useHook({ plan: makePlan() }))` re-invokes the callback on every internal state update, so each render passes a NEW object; the plan-changed effect fires and silently resets refs (voice guide nulled, ride ended) while other assertions still pass, making the failure look unrelated.

**How to apply:** hoist fixtures (`const plan = makePlan()`) before renderHook in mobile/web hook tests; suspect this whenever a ref set in a start callback is mysteriously null later.
