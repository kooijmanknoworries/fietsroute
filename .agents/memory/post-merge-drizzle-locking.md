---
name: Post-merge script & drizzle-kit push locking
description: Why the post-merge setup script hung/failed and how drizzle-kit push deadlocks against the running app
---
The post-merge setup script is `scripts/post-merge.sh` (configured in `.replit` `[postMerge]`, path + timeoutMs). It runs from the repo root with stdin closed after every task merge, then workflow reconciliation restarts running workflows.

**Correct script shape:** `pnpm install` then `pnpm --filter @workspace/db run push-force`.
- Use the FULL package name `@workspace/db` — a bare `--filter db` matches nothing (pnpm filters by package name/dir, not the unscoped suffix) and silently no-ops.
- Use `push-force` (`drizzle-kit push --force`), never `push`: plain push is interactive and, with stdin closed (`/dev/null`), hangs on any schema-change confirmation prompt.
- `pnpm install --frozen-lockfile` is risky post-merge (a merge can change deps/lockfile) — prefer plain `pnpm install`.
- Timeout: 20s is far too tight (cold `pnpm install` alone blows it, surfacing as `Error in river, code: CANCEL`). Use ~180000ms.

**drizzle-kit push takes an AccessExclusiveLock on the user tables** to diff/apply — even when the schema already matches and there is nothing to change. The api-server only ever takes AccessShareLock (it does no DDL). So:
- If any connection holds a lingering AccessShareLock on `network_nodes`/`network_segments` and never releases (e.g. a **leaked connection from a killed/timed-out drizzle-kit run**, kept alive by the pooler), push's AccessExclusive request queues forever → the spinner sits on `Pulling schema from database...` indefinitely, and new app reads pile up behind it (visible as many `granted=false` AccessShare waiters in `pg_locks`).
- Symptom vs. cause: a fast raw introspection (`select count(*) from information_schema.tables` returns in ms) but drizzle-kit hangs = it's lock contention, not connectivity.

**Debug/recover:** join `pg_locks`→`pg_class`→`pg_stat_activity` filtered to the schema tables. The lone `AccessExclusiveLock` requester is the drizzle-kit process; the persistent `AccessShareLock` holders with null `xact_start` are the stale/leaked sessions. `pg_terminate_backend(pid)` the exclusive-lock waiter and the stale share holders, then re-run push-force (completes in seconds), then restart the api-server workflow for a fresh pool. **Why:** Replit's pooled endpoint reports `state='disabled'` and hides query text, so lock mode + granted flag are the only reliable signal.

Note: `runPostMergeSetup()` in the code-execution sandbox blocks the notebook for its full duration (ignored the 20s config in practice, ran ~10min) — verify the script directly with `bash scripts/post-merge.sh </dev/null` under a `timeout` instead of relying on that callback.
