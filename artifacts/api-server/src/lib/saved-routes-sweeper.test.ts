import { afterAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";

const { sweepOrphanedAnonymousRoutes } = await import("./saved-routes-sweeper");
const { db, savedRoutesTable, pool } = await import("@workspace/db");
const { inArray } = await import("drizzle-orm");

const RETENTION_MS = 90 * 24 * 60 * 60 * 1000;

// Track every id we create so cleanup only removes our own rows even if the
// sweep under test deletes some of them first.
const createdRowIds: string[] = [];

async function seedRoute(ownerKey: string, createdAt: Date): Promise<string> {
  const [row] = await db
    .insert(savedRoutesTable)
    .values({
      ownerKey,
      name: "Seed route",
      nodes: [{ id: "n1", ref: "1", lat: 52.1, lon: 5.1 }],
      plan: { distanceMeters: 1234, nodeRefs: ["1", "2"] },
      createdAt,
    })
    .returning({ id: savedRoutesTable.id });
  createdRowIds.push(row.id);
  return row.id;
}

function daysAgo(days: number): Date {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

afterAll(async () => {
  if (createdRowIds.length > 0) {
    await db
      .delete(savedRoutesTable)
      .where(inArray(savedRoutesTable.id, createdRowIds));
  }
  await pool.end();
});

describe("sweepOrphanedAnonymousRoutes", () => {
  it("removes only old anonymous routes, leaving recent and user-owned rows", async () => {
    // Clear any pre-existing orphans first so the removed count below reflects
    // exactly the old anonymous rows this test seeds. These would be deleted by
    // the production sweep anyway. No other test file seeds old anonymous rows
    // (they save with the default current timestamp), so the baseline is stable.
    await sweepOrphanedAnonymousRoutes();

    // Old anonymous routes: owner_key is a bare UUID, older than the retention
    // window. These are the only rows the sweep should delete.
    const oldAnon1 = await seedRoute(randomUUID(), daysAgo(91));
    const oldAnon2 = await seedRoute(
      randomUUID(),
      new Date(Date.now() - RETENTION_MS - 60 * 60 * 1000),
    );

    // Recent anonymous route: UUID owner but inside the retention window. Kept
    // so the one-time claim migration can still reassign it on sign-in.
    const recentAnon = await seedRoute(randomUUID(), daysAgo(1));

    // Signed-in users: owner_key starts with `user_`. Include an id that
    // contains additional underscores to prove the prefix match (NOT LIKE
    // 'user\_%') escapes the underscore and never deletes a real account's
    // routes, regardless of age.
    const oldUser = await seedRoute(
      `user_${randomUUID().replace(/-/g, "")}`,
      daysAgo(120),
    );
    const oldUserWithUnderscores = await seedRoute(
      "user_2abc_def_ghi",
      daysAgo(200),
    );
    const recentUser = await seedRoute(
      `user_${randomUUID().replace(/-/g, "")}`,
      daysAgo(2),
    );

    const removed = await sweepOrphanedAnonymousRoutes();

    const survivors = await db
      .select({ id: savedRoutesTable.id })
      .from(savedRoutesTable)
      .where(inArray(savedRoutesTable.id, createdRowIds));
    const survivingIds = new Set(survivors.map((r) => r.id));

    // Old anonymous rows are gone.
    expect(survivingIds.has(oldAnon1)).toBe(false);
    expect(survivingIds.has(oldAnon2)).toBe(false);

    // Recent anonymous and every user-owned row remain.
    expect(survivingIds.has(recentAnon)).toBe(true);
    expect(survivingIds.has(oldUser)).toBe(true);
    expect(survivingIds.has(oldUserWithUnderscores)).toBe(true);
    expect(survivingIds.has(recentUser)).toBe(true);

    // The returned count matches exactly the number of old anonymous rows
    // seeded after the baseline sweep above.
    expect(removed).toBe(2);
  });
});
