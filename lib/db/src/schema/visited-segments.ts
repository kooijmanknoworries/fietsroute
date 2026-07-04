import {
  pgTable,
  uuid,
  text,
  doublePrecision,
  timestamp,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";

// A network leg (between two consecutive knooppunten) the rider has completed
// on a ride. Scoped per rider via `owner_key` (the Clerk user id), mirroring
// saved routes. `segment_key` is a stable canonical id built from the leg's two
// endpoint OSM node ids (globally unique), so re-riding the same leg is a no-op.
// `lon`/`lat` hold a representative point (the leg midpoint) used to place the
// lock marker on the map, independent of the current viewport.
export const visitedSegmentsTable = pgTable(
  "visited_segments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerKey: text("owner_key").notNull(),
    segmentKey: text("segment_key").notNull(),
    fromRef: text("from_ref").notNull(),
    toRef: text("to_ref").notNull(),
    lon: doublePrecision("lon").notNull(),
    lat: doublePrecision("lat").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("visited_segments_owner_key_idx").on(table.ownerKey),
    uniqueIndex("visited_segments_owner_segment_uq").on(
      table.ownerKey,
      table.segmentKey,
    ),
  ],
);

export type VisitedSegmentRow = typeof visitedSegmentsTable.$inferSelect;
export type InsertVisitedSegment = typeof visitedSegmentsTable.$inferInsert;
