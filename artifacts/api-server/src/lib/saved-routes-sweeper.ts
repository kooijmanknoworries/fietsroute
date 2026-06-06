import { and, like, lt, not } from "drizzle-orm";
import { db, savedRoutesTable } from "@workspace/db";
import { logger } from "./logger";

// Routes saved before sign-in existed are owned by a per-browser anonymous UUID
// key. Returning users can claim them on first sign-in, but rows that are never
// claimed stay orphaned forever. This periodic sweep removes anonymous rows that
// have aged past the retention window. Clerk user ids are prefixed `user_`, so
// requiring rows to NOT match that prefix guarantees we never delete routes that
// belong to a signed-in user.
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
