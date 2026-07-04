---
name: Central 401 re-auth handling
description: How mid-session Clerk expiry (401) is detected once and surfaced as a re-auth prompt in both clients
---
Rule: 401 detection lives in ONE place — `setUnauthorizedHandler(cb)` in `lib/api-client-react/src/custom-fetch.ts`. The wrapper invokes the handler (in a try/catch, never blocking) when any response is 401, then still throws the usual `ApiError` so callers' local error handling is unaffected. Exported from the package index alongside `setBaseUrl`/`setAuthTokenGetter`.

**Why:** After the API started returning 401 for unauthenticated requests, an expired/revoked Clerk session mid-use made every call fail as a generic error. A single choke point avoids sprinkling 401 checks across every query/mutation.

**How to apply:**
- Web (`routeplanner/src/App.tsx`): a `SessionExpiredHandler` registers a handler that shows a persistent destructive toast with a "Sign in again" action (navigates to `/sign-in`). It does NOT force-navigate, so Home's in-progress route (local state) is preserved until the rider chooses to re-auth. Debounced ~3s to collapse a burst of 401s.
- Mobile (`mobile/app/_layout.tsx`): `SessionExpiredHandler` shows an Alert and `router.push`es to `/(auth)/sign-in`. Route survives because `RoutePlannerProvider` sits above the router. Guarded by a `promptOpenRef` so only one Alert at a time.
- Any new client consuming `@workspace/api-client-react` should register its own handler once near the root.
