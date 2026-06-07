import {
  pgTable,
  text,
  doublePrecision,
  jsonb,
  timestamp,
  index,
} from "drizzle-orm/pg-core";

// The full preloaded cycling node network for the Netherlands + Belgium. Unlike
// the per-tile `overpass_cache` (a short-lived cache of live queries), these
// tables hold a durable, queryable copy of the whole region so the map can be
// served instantly from our own database instead of hitting Overpass per pan.

export const networkNodesTable = pgTable(
  "network_nodes",
  {
    id: text("id").primaryKey(),
    ref: text("ref").notNull(),
    lat: doublePrecision("lat").notNull(),
    lon: doublePrecision("lon").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("network_nodes_lat_idx").on(t.lat),
    index("network_nodes_lon_idx").on(t.lon),
  ],
);

export type NetworkNodeRow = typeof networkNodesTable.$inferSelect;

export const networkSegmentsTable = pgTable(
  "network_segments",
  {
    id: text("id").primaryKey(),
    // GeoJSON-style [lon, lat][] polyline of the network way.
    coordinates: jsonb("coordinates").notNull(),
    // Node IDs in order along the way. Stored so the route planner can rebuild
    // the graph for Dijkstra without re-querying Overpass.
    nodeIds: jsonb("node_ids").notNull().default("[]"),
    // Bounding box of the polyline, stored so a viewport bbox query can find
    // every segment that intersects it via index range scans.
    minLat: doublePrecision("min_lat").notNull(),
    maxLat: doublePrecision("max_lat").notNull(),
    minLon: doublePrecision("min_lon").notNull(),
    maxLon: doublePrecision("max_lon").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("network_segments_min_lat_idx").on(t.minLat),
    index("network_segments_max_lat_idx").on(t.maxLat),
    index("network_segments_min_lon_idx").on(t.minLon),
    index("network_segments_max_lon_idx").on(t.maxLon),
  ],
);

export type NetworkSegmentRow = typeof networkSegmentsTable.$inferSelect;
