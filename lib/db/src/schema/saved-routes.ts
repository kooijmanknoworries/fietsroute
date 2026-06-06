import { pgTable, uuid, text, jsonb, timestamp, index } from "drizzle-orm/pg-core";

export const savedRoutesTable = pgTable(
  "saved_routes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerKey: text("owner_key").notNull(),
    name: text("name").notNull(),
    nodes: jsonb("nodes").notNull(),
    plan: jsonb("plan").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index("saved_routes_owner_key_idx").on(table.ownerKey)],
);

export type SavedRouteRow = typeof savedRoutesTable.$inferSelect;
export type InsertSavedRoute = typeof savedRoutesTable.$inferInsert;
