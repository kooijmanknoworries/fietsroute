import { afterAll, describe, expect, it, vi } from "vitest";
import express, { type Express } from "express";
import request from "supertest";
import { randomUUID } from "node:crypto";

// Shared, test-controlled map of Clerk user id -> email. The mocked
// clerkClient.users.getUser reads from it so each test can decide which email
// (and therefore which access level) a given user id resolves to.
const { emailByUser } = vi.hoisted(() => ({
  emailByUser: new Map<string, string>(),
}));

vi.mock("@clerk/express", () => ({
  getAuth: (req: { headers: Record<string, unknown> }) => {
    const userId = req.headers["x-test-user"];
    return { userId: typeof userId === "string" && userId ? userId : null };
  },
  clerkClient: {
    users: {
      getUser: async (userId: string) => {
        const email = emailByUser.get(userId) ?? null;
        return {
          primaryEmailAddressId: email ? "e1" : null,
          emailAddresses: email ? [{ id: "e1", emailAddress: email }] : [],
        };
      },
    },
  },
}));

const { default: accessRouter } = await import("./access");
const { default: savedRoutesRouter } = await import("./saved-routes");
const { OWNER_EMAIL } = await import("../lib/access");
const { db, savedRoutesTable, userAccessTable, pool } = await import(
  "@workspace/db"
);
const { inArray } = await import("drizzle-orm");

function makeApp(): Express {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as unknown as { log: Console }).log = console;
    next();
  });
  // Mount both so the approval gate can be exercised end-to-end against a real
  // gated write endpoint (POST /api/routes).
  app.use("/api", accessRouter);
  app.use("/api", savedRoutesRouter);
  return app;
}

const app = makeApp();

const usedUsers = new Set<string>();

function newUser(email: string): string {
  const id = `user_${randomUUID().replace(/-/g, "")}`;
  emailByUser.set(id, email);
  usedUsers.add(id);
  return id;
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

afterAll(async () => {
  if (usedUsers.size > 0) {
    await db
      .delete(savedRoutesTable)
      .where(inArray(savedRoutesTable.ownerKey, [...usedUsers]));
    await db
      .delete(userAccessTable)
      .where(inArray(userAccessTable.userId, [...usedUsers]));
  }
  await pool.end();
});

describe("GET /api/me/access", () => {
  it("requires authentication", async () => {
    const res = await request(app).get("/api/me/access");
    expect(res.status).toBe(401);
  });

  it("auto-approves the owner email and marks them as owner", async () => {
    const owner = newUser(OWNER_EMAIL);
    const res = await request(app)
      .get("/api/me/access")
      .set("x-test-user", owner);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "approved", isOwner: true });
  });

  it("creates a new non-owner user as pending", async () => {
    const user = newUser(`rider_${randomUUID()}@example.com`);
    const res = await request(app)
      .get("/api/me/access")
      .set("x-test-user", user);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "pending", isOwner: false });
  });
});

describe("approval gate on write endpoints", () => {
  it("refuses a pending user (403) and lets them through once approved", async () => {
    const owner = newUser(OWNER_EMAIL);
    const rider = newUser(`rider_${randomUUID()}@example.com`);

    // Register the rider (creates the pending record).
    await request(app).get("/api/me/access").set("x-test-user", rider);

    const blocked = await request(app)
      .post("/api/routes")
      .set("x-test-user", rider)
      .send(samplePayload("Blocked route"));
    expect(blocked.status).toBe(403);

    // Owner approves the rider.
    const approve = await request(app)
      .patch(`/api/admin/users/${rider}`)
      .set("x-test-user", owner)
      .send({ status: "approved" });
    expect(approve.status).toBe(200);
    expect(approve.body.status).toBe("approved");

    const allowed = await request(app)
      .post("/api/routes")
      .set("x-test-user", rider)
      .send(samplePayload("Allowed route"));
    expect(allowed.status).toBe(201);

    // Rejecting blocks writes again (reversible).
    const reject = await request(app)
      .patch(`/api/admin/users/${rider}`)
      .set("x-test-user", owner)
      .send({ status: "rejected" });
    expect(reject.status).toBe(200);
    expect(reject.body.status).toBe("rejected");

    const blockedAgain = await request(app)
      .post("/api/routes")
      .set("x-test-user", rider)
      .send(samplePayload("Blocked again"));
    expect(blockedAgain.status).toBe(403);
  });
});

describe("owner-only admin endpoints", () => {
  it("lists users for the owner and rejects non-owners", async () => {
    const owner = newUser(OWNER_EMAIL);
    const rider = newUser(`rider_${randomUUID()}@example.com`);
    await request(app).get("/api/me/access").set("x-test-user", rider);

    const list = await request(app)
      .get("/api/admin/users")
      .set("x-test-user", owner);
    expect(list.status).toBe(200);
    expect(
      list.body.some((u: { userId: string }) => u.userId === rider),
    ).toBe(true);

    const forbidden = await request(app)
      .get("/api/admin/users")
      .set("x-test-user", rider);
    expect(forbidden.status).toBe(403);
  });

  it("rejects an unauthenticated admin list", async () => {
    const res = await request(app).get("/api/admin/users");
    expect(res.status).toBe(401);
  });

  it("returns 404 when setting status for an unknown user", async () => {
    const owner = newUser(OWNER_EMAIL);
    const res = await request(app)
      .patch(`/api/admin/users/user_${randomUUID().replace(/-/g, "")}`)
      .set("x-test-user", owner)
      .send({ status: "approved" });
    expect(res.status).toBe(404);
  });

  it("rejects an invalid status value", async () => {
    const owner = newUser(OWNER_EMAIL);
    const rider = newUser(`rider_${randomUUID()}@example.com`);
    await request(app).get("/api/me/access").set("x-test-user", rider);

    const res = await request(app)
      .patch(`/api/admin/users/${rider}`)
      .set("x-test-user", owner)
      .send({ status: "banished" });
    expect(res.status).toBe(400);
  });

  it("forbids a non-owner from changing status", async () => {
    const rider = newUser(`rider_${randomUUID()}@example.com`);
    const other = newUser(`other_${randomUUID()}@example.com`);
    await request(app).get("/api/me/access").set("x-test-user", rider);

    const res = await request(app)
      .patch(`/api/admin/users/${rider}`)
      .set("x-test-user", other)
      .send({ status: "approved" });
    expect(res.status).toBe(403);
  });
});
