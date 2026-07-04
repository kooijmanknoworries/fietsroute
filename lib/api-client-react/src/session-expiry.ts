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
// (`getToken({ skipCache: true })`). There are three possible outcomes:
//   1. A token comes back  → the session is alive, the 401 was a transient
//      blip → stay silent.
//   2. `null` comes back   → Clerk *reached its servers* and confirmed there is
//      no session → prompt (session genuinely expired/revoked).
//   3. The call *throws*   → we couldn't reach Clerk at all (network hiccup,
//      Clerk briefly unreachable). This is NOT proof of a logout, so we retry a
//      couple of times with a short backoff; if it keeps failing we stay silent
//      rather than firing a false "je sessie is verlopen" prompt on a flaky
//      connection. The next 401 will re-verify once the network recovers.
// Prompts are debounced so one expiry never produces a burst of prompts.

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
  /**
   * How many extra attempts to make when `getToken` *throws* (i.e. Clerk is
   * unreachable). The first call plus this many retries. Defaults to 2. When
   * every attempt throws, the failure is treated as a transient network blip
   * and no prompt is shown.
   */
  maxRefreshRetries?: number;
  /**
   * Base backoff between retries; attempt N waits `retryBackoffMs * N`.
   * Defaults to 500ms.
   */
  retryBackoffMs?: number;
  /** Injectable sleep, for tests. */
  sleep?: (ms: number) => Promise<void>;
}

/**
 * Build a 401 handler (suitable for `setUnauthorizedHandler`) that verifies the
 * session is really gone — via a forced Clerk token refresh — before calling
 * `onExpired`. Transient 401s on a still-valid session are swallowed, and so
 * are refresh failures caused by an unreachable network/Clerk (retried briefly,
 * then ignored) so a flaky connection never produces a false prompt.
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
    maxRefreshRetries = 2,
    retryBackoffMs = 500,
    sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
  } = deps;

  let lastPromptedAt = 0;
  let verifying = false;

  return () => {
    if (verifying) return;
    if (isReady && !isReady()) return;

    verifying = true;
    void (async () => {
      try {
        // `undefined` = we never got a definitive answer from Clerk (every
        // attempt threw). `true`/`false` = Clerk responded.
        let sessionGone: boolean | undefined;

        for (let attempt = 0; attempt <= maxRefreshRetries; attempt++) {
          try {
            sessionGone = !(await getToken({ skipCache: true }));
            break; // Clerk answered — the decision is definitive.
          } catch {
            // Couldn't reach Clerk. Retry after a short backoff; on the last
            // attempt leave `sessionGone` undefined so we stay silent below.
            if (attempt < maxRefreshRetries) {
              await sleep(retryBackoffMs * (attempt + 1));
            }
          }
        }

        // Either the session is still alive (token minted) or we could not
        // confirm it was gone (network/Clerk unreachable) — stay silent.
        if (sessionGone !== true) return;

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
