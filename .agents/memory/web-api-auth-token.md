---
name: Web API bearer auth
description: The routeplanner web app must attach a Clerk bearer token to API calls; cookie auth doesn't work across the web/API origins.
---

The API server gates every endpoint behind Clerk auth (`requireAuth` via
`getAuth(req).userId`); only the health check is public. The shared `__session`
cookie is NOT accepted across the web app / api-server origins, so the browser's
automatic cookie is useless for authenticating API calls.

**Rule:** the web app must register `setAuthTokenGetter(() => getToken())`
(Clerk `useAuth().getToken`) exactly like mobile does, or every request 401s and
the map renders empty (no knooppunten). Registration lives in `App.tsx`
(`ApiAuthTokenBridge`, mounted under `ClerkProvider` + `QueryClientProvider`),
using a ref so the getter tracks Clerk's latest `getToken` without
re-registering; cleared with `setAuthTokenGetter(null)` on unmount.

**Why:** a prior change gated all endpoints (previously `/api/network` was
public), which silently blanked the web map because the web client never sent a
credential. The fix is client-side; the auth gate policy is intentional and
should stay.

**How to apply:** never remove `ApiAuthTokenBridge`; if you re-tighten or add
auth-gated endpoints, the web app already carries the bearer. A regression test
in `App.test.tsx` asserts the registered getter resolves the signed-in token.
The old `custom-fetch.ts` comment claiming `setAuthTokenGetter` should never be
used on web was wrong and has been corrected.
