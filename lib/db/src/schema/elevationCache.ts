import { pgTable, text, jsonb, timestamp, index } from "drizzle-orm/pg-core";

export const elevationCacheTable = pgTable(
  "elevation_cache",
  {
    key: text("key").primaryKey(),
    data: jsonb("data").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("elevation_cache_expires_at_idx").on(t.expiresAt)],
);

export type ElevationCacheRow = typeof elevationCacheTable.$inferSelect;
