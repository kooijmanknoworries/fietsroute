import { afterAll, describe, expect, it, vi } from "vitest";
import express, { type Express } from "express";
import request from "supertest";
import { randomUUID } from "node:crypto";

// Stub Clerk so tests can control the authenticated user via a request header.
// The real router only reads `getAuth(req).userId`, which maps to the owner key
// used to scope saved routes. An absent/empty header means an anonymous request.
vi.mock("@clerk/express", () => ({
  getAuth: (req: { headers: Record<string, unknown> }) => {
    const userId = req.headers["x-test-user"];
    return { userId: typeof userId === "string" && userId ? userId : null };
  },
  // The approval gate reads the user's email from Clerk. Returning the owner
  // email auto-approves every test user so write endpoints stay reachable; the
  // gate's pending/rejected behaviour is exercised in access.test.ts.
  clerkClient: {
    users: {
      getUser: async () => ({
        primaryEmailAddressId: "e1",
        emailAddresses: [
          { id: "e1", emailAddress: "nicokooijman@gmail.com" },
        ],
      }),
    },
  },
}));

const { default: savedRoutesRouter } = await import("./saved-routes");
const { db, savedRoutesTable, userAccessTable, pool } = await import(
  "@workspace/db"
);
const { inArray, eq } = await import("drizzle-orm");

function makeApp(): Express {
  const app = express();
  app.use(express.json());
  // Mirror production: pino-http adds req.log, which the handlers use when
  // logging errors, and routes are mounted under /api.
  app.use((req, _res, next) => {
    (req as unknown as { log: Console }).log = console;
    next();
  });
  app.use("/api", savedRoutesRouter);
  return app;
}

const app = makeApp();

// Track every owner key we touch so we can clean up only our own test rows.
const usedOwners = new Set<string>();

// Track ids created directly via the DB (e.g. anonymous routes seeded for the
// claim flow) so they can be removed even after their owner_key is reassigned.
const createdRowIds: string[] = [];

function newOwner(): string {
  const owner = `test_${randomUUID()}`;
  usedOwners.add(owner);
  return owner;
}

function samplePayload(name: string) {
  return {
    name,
    nodes: [
      { id: "n1", ref: "34", lat: 52.1, lon: 4.3 },
      { id: "n2", ref: "35", lat: 52.2, lon: 4.4 },
    ],
    plan: {
      nodeRefs: ["34", "35"],
      coordinates: [
        [4.3, 52.1],
        [4.4, 52.2],
      ],
      distanceMeters: 1234,
      legs: [
        {
          fromRef: "34",
          toRef: "35",
          distanceMeters: 1234,
          coordinates: [
            [4.3, 52.1],
            [4.4, 52.2],
          ],
        },
      ],
    },
  };
}

function save(owner: string, name: string) {
  return request(app)
    .post("/api/routes")
    .set("x-test-user", owner)
    .send(samplePayload(name));
}

// Seed a route straight into the DB under an arbitrary owner key, bypassing the
// API — used to set up the pre-sign-in (anonymous) state for the claim flow.
async function seedAnonymousRoute(anonymousKey: string): Promise<string> {
  const [row] = await db
    .insert(savedRoutesTable)
    .values({
      ownerKey: anonymousKey,
      name: "Pre-sign-in route",
      nodes: [{ id: "n1", ref: "1", lat: 52.1, lon: 5.1 }],
      plan: { distanceMeters: 1234, nodeRefs: ["1", "2"] },
    })
    .returning({ id: savedRoutesTable.id });
  createdRowIds.push(row.id);
  return row.id;
}

afterAll(async () => {
  // Remove anything seeded directly by id (its owner_key may have been
  // reassigned by the claim flow) and anything saved through the API by owner.
  for (const id of createdRowIds) {
    await db.delete(savedRoutesTable).where(eq(savedRoutesTable.id, id));
  }
  if (usedOwners.size > 0) {
    await db
      .delete(savedRoutesTable)
      .where(inArray(savedRoutesTable.ownerKey, [...usedOwners]));
    await db
      .delete(userAccessTable)
      .where(inArray(userAccessTable.userId, [...usedOwners]));
  }
  await pool.end();
});

describe("saved-routes happy path", () => {
  it("saves, lists, fetches, renames, and deletes a route", async () => {
    const owner = newOwner();

    const created = await save(owner, "Morning loop");
    expect(created.status).toBe(201);
    expect(created.body.id).toBeTruthy();
    expect(created.body.name).toBe("Morning loop");
    expect(created.body.nodes).toHaveLength(2);
    expect(created.body.plan.distanceMeters).toBe(1234);
    const id = created.body.id;

    const list = await request(app)
      .get("/api/routes")
      .set("x-test-user", owner);
    expect(list.status).toBe(200);
    const summary = list.body.find((r: { id: string }) => r.id === id);
    expect(summary).toBeTruthy();
    expect(summary.name).toBe("Morning loop");
    expect(summary.distanceMeters).toBe(1234);
    expect(summary.nodeRefs).toEqual(["34", "35"]);

    const fetched = await request(app)
      .get(`/api/routes/${id}`)
      .set("x-test-user", owner);
    expect(fetched.status).toBe(200);
    expect(fetched.body.id).toBe(id);
    expect(fetched.body.name).toBe("Morning loop");

    const renamed = await request(app)
      .patch(`/api/routes/${id}`)
      .set("x-test-user", owner)
      .send({ name: "Evening loop" });
    expect(renamed.status).toBe(200);
    expect(renamed.body.name).toBe("Evening loop");

    const deleted = await request(app)
      .delete(`/api/routes/${id}`)
      .set("x-test-user", owner);
    expect(deleted.status).toBe(204);

    const gone = await request(app)
      .get(`/api/routes/${id}`)
      .set("x-test-user", owner);
    expect(gone.status).toBe(404);
  });

  it("trims surrounding whitespace from the name on save", async () => {
    const owner = newOwner();
    const created = await save(owner, "  Trimmed name  ");
    expect(created.status).toBe(201);
    expect(created.body.name).toBe("Trimmed name");
  });
});

describe("saved-routes ownership scoping", () => {
  it("hides another user's route from get, rename, and delete", async () => {
    const owner = newOwner();
    const intruder = newOwner();

    const created = await save(owner, "Private route");
    expect(created.status).toBe(201);
    const id = created.body.id;

    const fetched = await request(app)
      .get(`/api/routes/${id}`)
      .set("x-test-user", intruder);
    expect(fetched.status).toBe(404);

    const renamed = await request(app)
      .patch(`/api/routes/${id}`)
      .set("x-test-user", intruder)
      .send({ name: "Hijacked" });
    expect(renamed.status).toBe(404);

    const deleted = await request(app)
      .delete(`/api/routes/${id}`)
      .set("x-test-user", intruder);
    expect(deleted.status).toBe(404);

    // The owner's route is untouched after the failed attempts.
    const stillThere = await request(app)
      .get(`/api/routes/${id}`)
      .set("x-test-user", owner);
    expect(stillThere.status).toBe(200);
    expect(stillThere.body.name).toBe("Private route");
  });

  it("excludes another user's routes from the list", async () => {
    const owner = newOwner();
    const other = newOwner();

    const created = await save(owner, "Only mine");
    expect(created.status).toBe(201);

    const otherList = await request(app)
      .get("/api/routes")
      .set("x-test-user", other);
    expect(otherList.status).toBe(200);
    expect(
      otherList.body.some((r: { id: string }) => r.id === created.body.id),
    ).toBe(false);
  });
});

describe("saved-routes validation", () => {
  it("requires authentication", async () => {
    const res = await request(app).get("/api/routes");
    expect(res.status).toBe(401);
  });

  it("rejects an empty name on save", async () => {
    const owner = newOwner();
    const res = await request(app)
      .post("/api/routes")
      .set("x-test-user", owner)
      .send(samplePayload(""));
    expect(res.status).toBe(400);
  });

  it("rejects a whitespace-only name on save", async () => {
    const owner = newOwner();
    const res = await request(app)
      .post("/api/routes")
      .set("x-test-user", owner)
      .send(samplePayload("   "));
    expect(res.status).toBe(400);
  });

  it("rejects an empty name on rename", async () => {
    const owner = newOwner();
    const created = await save(owner, "Renamable");
    expect(created.status).toBe(201);

    const res = await request(app)
      .patch(`/api/routes/${created.body.id}`)
      .set("x-test-user", owner)
      .send({ name: "" });
    expect(res.status).toBe(400);
  });

  it("rejects a whitespace-only name on rename", async () => {
    const owner = newOwner();
    const created = await save(owner, "Renamable too");
    expect(created.status).toBe(201);

    const res = await request(app)
      .patch(`/api/routes/${created.body.id}`)
      .set("x-test-user", owner)
      .send({ name: "   " });
    expect(res.status).toBe(400);
  });
});

describe("POST /api/routes/claim", () => {
  it("imports an anonymously-saved route and reassigns its owner_key to the signed-in user", async () => {
    const anonymousKey = randomUUID();
    const clerkUserId = `user_${randomUUID().replace(/-/g, "")}`;
    const rowId = await seedAnonymousRoute(anonymousKey);

    const res = await request(app)
      .post("/api/routes/claim")
      .set("x-test-user", clerkUserId)
      .send({ anonymousKey });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ claimed: 1 });

    const [row] = await db
      .select({ ownerKey: savedRoutesTable.ownerKey })
      .from(savedRoutesTable)
      .where(eq(savedRoutesTable.id, rowId));
    expect(row.ownerKey).toBe(clerkUserId);
  });

  it("rejects an anonymousKey that is another account's Clerk user id (user_ prefix)", async () => {
    const victimUserId = `user_${randomUUID().replace(/-/g, "")}`;
    const attackerUserId = `user_${randomUUID().replace(/-/g, "")}`;
    // The victim has a route saved under their Clerk id.
    const rowId = await seedAnonymousRoute(victimUserId);

    const res = await request(app)
      .post("/api/routes/claim")
      .set("x-test-user", attackerUserId)
      .send({ anonymousKey: victimUserId });

    expect(res.status).toBe(400);

    // The victim's route must still belong to the victim.
    const [row] = await db
      .select({ ownerKey: savedRoutesTable.ownerKey })
      .from(savedRoutesTable)
      .where(eq(savedRoutesTable.id, rowId));
    expect(row.ownerKey).toBe(victimUserId);
  });

  it("requires authentication", async () => {
    const res = await request(app)
      .post("/api/routes/claim")
      .send({ anonymousKey: randomUUID() });

    expect(res.status).toBe(401);
  });
});
