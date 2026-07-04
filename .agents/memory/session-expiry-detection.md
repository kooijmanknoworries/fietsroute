---
name: Session-expiry detection
description: A single HTTP 401 is not proof of a logout; verify with a forced Clerk token refresh before prompting re-auth.
---

# Session-expiry detection (transient 401s)

A single API 401 must NOT be treated as "your session expired." Web auth rides
on Clerk's short-lived `__session` cookie (~60s JWT that ClerkJS refreshes in
the background); a request can land with a momentarily-stale token (tab
backgrounded, device slept, between refresh ticks) and 401 even though the
session is valid. All API endpoints require auth and the map fires many reads
while panning, so transient 401s are common.

**Rule:** Before showing any re-auth prompt on a 401, ask Clerk for a *fresh*
token via `getToken({ skipCache: true })`. If it returns a token → session is
alive → swallow the 401 silently. Only prompt when the refresh returns null or
throws. Debounce prompts and gate on Clerk `isLoaded` so initial-load 401s never
prompt.

**Why:** Riders reported recurring red "je sessie is verlopen" popups during
normal use even though they were never logged out — the handler fired on every
401 unconditionally.

**How to apply:** Keep the raw 401 signal (customFetch) separate from the
decision to prompt — put session verification in the app-side handler, not in
customFetch. Reuse the shared verifier in api-client-react rather than
re-checking 401s per call site.

**Three-way outcome (not two):** `getToken` *returning* null = Clerk reached its
servers and confirmed no session → prompt. `getToken` *throwing* = Clerk was
unreachable (network blip) → NOT proof of logout. The verifier retries a thrown
call briefly (`maxRefreshRetries` default 2, `retryBackoffMs` default 500ms,
injectable `sleep` for tests) and, if every attempt throws, stays SILENT — the
next 401 re-verifies once the network recovers. Only a definitive null/empty
token return prompts. Both web and mobile share this via the default config, so
behavior stays consistent.
