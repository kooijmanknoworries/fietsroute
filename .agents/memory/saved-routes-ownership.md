---
name: Saved routes ownership model
description: How saved routes are scoped to a user (Clerk auth, with a legacy anonymous-key path)
---
Saved routes are scoped to the authenticated Clerk user. The old anonymous `x-owner-key` model is superseded.

- The API server derives ownership from `getAuth(req).userId` (Clerk) and requires auth on every `/api/routes` handler; the per-row ownership column stores the Clerk user id.
- A `POST /api/routes/claim` (ClaimSavedRoutesRequest { anonymousKey }) exists to migrate legacy per-browser routes into an account after sign-in.
- Web: Clerk session cookie carries auth. Mobile (Expo, `@clerk/expo`): no cookie jar — the shared api-client sends a Bearer token via `setAuthTokenGetter(() => getToken())`, bridged once inside `ClerkProvider`. Call `setAuthTokenGetter` on mobile only, never web.
- Mobile also keeps an on-device backup of every saved route in AsyncStorage (`lib/localRoutes.ts`), independent of sign-in, so planning + saving stay usable signed-out/offline. Map planning is public; only server save/list requires sign-in.

**Why:** Routes now sync across a real website account, which needs real auth; the anonymous key alone can't identify a cross-device user.

**How to apply:** Any new route-owning endpoint must read the Clerk user id server-side, not a header. On mobile, ensure the token getter is registered before route API calls, and gate account features on `useAuth().isSignedIn` while leaving map planning open.
