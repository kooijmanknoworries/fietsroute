import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { getAuth } from "@clerk/express";
import { db, visitedSegmentsTable } from "@workspace/db";
import {
  SaveVisitedSegmentsBody,
  ListVisitedSegmentsResponse,
  SaveVisitedSegmentsResponse,
} from "@workspace/api-zod";
import { requireAuth } from "../middlewares/requireAuth";

const router: IRouter = Router();

// Visited segments are the network legs a rider has completed. They are scoped
// to the authenticated Clerk user via the `owner_key` column, mirroring saved
// routes, so the history follows the rider across browsers and devices.
// `requireAuth` guarantees `getAuth(req).userId` is set on every handler below
// (also enforced globally in routes/index.ts).

router.get(
  "/visited-segments",
  requireAuth,
  async (req, res): Promise<void> => {
    const ownerKey = getAuth(req).userId!;

    try {
      const rows = await db
        .select()
        .from(visitedSegmentsTable)
        .where(eq(visitedSegmentsTable.ownerKey, ownerKey));

      const segments = rows.map((row) => ({
        segmentKey: row.segmentKey,
        fromRef: row.fromRef,
        toRef: row.toRef,
        lon: row.lon,
        lat: row.lat,
      }));

      res.json(ListVisitedSegmentsResponse.parse(segments));
    } catch (err) {
      req.log.error({ err }, "Failed to list visited segments");
      res.status(502).json({ message: "Failed to list visited segments" });
    }
  },
);

router.post(
  "/visited-segments",
  requireAuth,
  async (req, res): Promise<void> => {
    const ownerKey = getAuth(req).userId!;

    const parsed = SaveVisitedSegmentsBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ message: "Invalid request body" });
      return;
    }

    // De-duplicate within the request by segmentKey; drop blank keys.
    const bySegment = new Map<string, (typeof parsed.data.segments)[number]>();
    for (const segment of parsed.data.segments) {
      const key = segment.segmentKey.trim();
      if (key === "") continue;
      bySegment.set(key, { ...segment, segmentKey: key });
    }

    const values = [...bySegment.values()].map((segment) => ({
      ownerKey,
      segmentKey: segment.segmentKey,
      fromRef: segment.fromRef,
      toRef: segment.toRef,
      lon: segment.lon,
      lat: segment.lat,
    }));

    if (values.length === 0) {
      res.json(SaveVisitedSegmentsResponse.parse({ saved: 0 }));
      return;
    }

    try {
      const inserted = await db
        .insert(visitedSegmentsTable)
        .values(values)
        .onConflictDoNothing({
          target: [
            visitedSegmentsTable.ownerKey,
            visitedSegmentsTable.segmentKey,
          ],
        })
        .returning({ id: visitedSegmentsTable.id });

      res.json(SaveVisitedSegmentsResponse.parse({ saved: inserted.length }));
    } catch (err) {
      req.log.error({ err }, "Failed to save visited segments");
      res.status(502).json({ message: "Failed to save visited segments" });
    }
  },
);

export default router;
