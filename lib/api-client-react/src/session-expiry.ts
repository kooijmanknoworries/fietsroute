// Turns a raw HTTP 401 into a *trustworthy* "your session really expired"
// signal. A single 401 is not proof of a logout: web auth rides on Clerk's
// short-lived `__session` cookie (a ~60s JWT that ClerkJS refreshes in the
// background), so a request can land with a momentarily-stale token — after the
// tab was backgrounded, the device slept, or just between refresh ticks — and
// come back 401 even though the session is perfectly valid. Because every API
// endpoint now requires auth and the map fires many reads while panning, these
// transient 401s are common and must NOT surface a scary re-auth prompt.
//
// So before prompting, this handler asks Clerk for a *fresh* token
// (`getToken({ skipCache: true })`). If Clerk can still mint one, the session
// is alive and the 401 was a transient blip — stay silent. Only when Clerk
// cannot produce a token (session genuinely expired or revoked) do we fire the
// prompt, debounced so one expiry never produces a burst of prompts.

export type SkipCacheTokenGetter = (options?: {
  skipCache?: boolean;
}) => Promise<string | null>;

export interface UnauthorizedHandlerDeps {
  /**
   * Clerk's `getToken`. Called with `{ skipCache: true }` so the check reflects
   * the live session rather than a cached token.
   */
  getToken: SkipCacheTokenGetter;
  /**
   * Invoked only when the session is confirmed gone — this is where the app
   * shows its re-auth prompt (toast on web, alert on mobile).
   */
  onExpired: () => void;
  /**
   * Optional readiness gate. While this returns false (e.g. Clerk still
   * loading), 401s are treated as transient and never prompt. This avoids a
   * spurious prompt during initial load before the session is established.
   */
  isReady?: () => boolean;
  /** Overridable clock, for tests. */
  now?: () => number;
  /** Minimum gap between prompts. Defaults to 3s. */
  debounceMs?: number;
}

/**
 * Build a 401 handler (suitable for `setUnauthorizedHandler`) that verifies the
 * session is really gone — via a forced Clerk token refresh — before calling
 * `onExpired`. Transient 401s on a still-valid session are swallowed.
 *
 * The returned handler is synchronous (fire-and-forget): it kicks off the async
 * verification and returns immediately, so it never blocks the failing request.
 * A concurrent-verification guard collapses a burst of 401s into a single check.
 */
export function createUnauthorizedHandler(deps: UnauthorizedHandlerDeps): () => void {
  const {
    getToken,
    onExpired,
    isReady,
    now = () => Date.now(),
    debounceMs = 3000,
  } = deps;

  let lastPromptedAt = 0;
  let verifying = false;

  return () => {
    if (verifying) return;
    if (isReady && !isReady()) return;

    verifying = true;
    void (async () => {
      try {
        let sessionStillValid = false;
        try {
          sessionStillValid = Boolean(await getToken({ skipCache: true }));
        } catch {
          // A failed refresh means we can't confirm a live session — treat it
          // as expired so a genuine loss still prompts.
          sessionStillValid = false;
        }

        // Transient blip: Clerk refreshed the token fine, session is alive.
        if (sessionStillValid) return;

        const t = now();
        if (t - lastPromptedAt < debounceMs) return;
        lastPromptedAt = t;

        onExpired();
      } finally {
        verifying = false;
      }
    })();
  };
}
