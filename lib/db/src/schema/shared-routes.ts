import { pgTable, uuid, text, jsonb, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

// Publicly shareable snapshots of a planned route. Each row is immutable and
// addressed by an unguessable random token, so anyone with the link can view
// the route without signing in. The owner key records who created the share
// (for accountability/cleanup) but is never exposed publicly.
export const sharedRoutesTable = pgTable(
  "shared_routes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    token: text("token").notNull(),
    ownerKey: text("owner_key").notNull(),
    name: text("name"),
    nodes: jsonb("nodes").notNull(),
    plan: jsonb("plan").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [uniqueIndex("shared_routes_token_idx").on(table.token)],
);

export type SharedRouteRow = typeof sharedRoutesTable.$inferSelect;
export type InsertSharedRoute = typeof sharedRoutesTable.$inferInsert;
