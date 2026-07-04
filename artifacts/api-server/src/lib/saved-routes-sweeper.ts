import { and, like, lt, not } from "drizzle-orm";
import { db, savedRoutesTable } from "@workspace/db";
import { logger } from "./logger";

// Legacy rows saved before sign-in existed are owned by a per-browser anonymous
// UUID key rather than a Clerk user id. Anonymous saving is no longer possible
// (every saved-routes endpoint now requires auth), so no new anonymous rows are
// created and the only such rows are old orphans. While the one-time claim
// migration is still around, a returning user can reassign these rows to their
// account on sign-in, so we keep them for a retention window rather than purging
// immediately, then delete whatever is left. Clerk user ids are prefixed
// `user_`, so requiring rows to NOT match that prefix guarantees we never delete
// routes that belong to a signed-in user.
const RETENTION_MS = 90 * 24 * 60 * 60 * 1000;

const SWEEP_INTERVAL_MS = 24 * 60 * 60 * 1000;

export async function sweepOrphanedAnonymousRoutes(): Promise<number> {
  const cutoff = new Date(Date.now() - RETENTION_MS);

  try {
    const result = await db
      .delete(savedRoutesTable)
      .where(
        and(
          not(like(savedRoutesTable.ownerKey, "user\\_%")),
          lt(savedRoutesTable.createdAt, cutoff),
        ),
      );
    const removed = result.rowCount ?? 0;
    if (removed > 0) {
      logger.info({ removed }, "Swept orphaned anonymous saved routes");
    } else {
      logger.debug("Saved routes sweep found no orphaned anonymous rows");
    }
    return removed;
  } catch (err) {
    logger.warn({ err }, "Saved routes sweep failed");
    return 0;
  }
}

export function startSavedRoutesSweeper(): NodeJS.Timeout {
  void sweepOrphanedAnonymousRoutes();
  const timer = setInterval(() => {
    void sweepOrphanedAnonymousRoutes();
  }, SWEEP_INTERVAL_MS);
  timer.unref();
  return timer;
}
