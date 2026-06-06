import { pgTable, text, jsonb, timestamp, index } from "drizzle-orm/pg-core";

export const overpassCacheTable = pgTable(
  "overpass_cache",
  {
    key: text("key").primaryKey(),
    data: jsonb("data").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("overpass_cache_expires_at_idx").on(t.expiresAt)],
);

export type OverpassCacheRow = typeof overpassCacheTable.$inferSelect;
