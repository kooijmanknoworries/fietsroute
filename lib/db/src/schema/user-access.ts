import { pgTable, text, timestamp, index } from "drizzle-orm/pg-core";

// Tracks each Clerk user's access status for the approval gate. New sign-ins are
// created as `pending` (they may browse the map read-only); the fixed owner email
// is auto-created as `approved`. The owner approves/rejects others from the admin
// queue. `userId` is the Clerk user id; `email` is read from Clerk server-side on
// first authenticated request so it cannot be spoofed by the client.
export const userAccessTable = pgTable(
  "user_access",
  {
    userId: text("user_id").primaryKey(),
    email: text("email"),
    // "pending" | "approved" | "rejected"
    status: text("status").notNull().default("pending"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index("user_access_status_idx").on(table.status)],
);

export type UserAccessRow = typeof userAccessTable.$inferSelect;
export type InsertUserAccess = typeof userAccessTable.$inferInsert;
