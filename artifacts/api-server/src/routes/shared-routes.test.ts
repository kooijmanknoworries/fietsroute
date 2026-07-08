import { afterAll, describe, expect, it, vi } from "vitest";
import express, { type Express } from "express";
import request from "supertest";
import { randomUUID } from "node:crypto";

// Stub Clerk so tests can control the authenticated user via a request header.
vi.mock("@clerk/express", () => ({
  getAuth: (req: { headers: Record<string, unknown> }) => {
    const userId = req.headers["x-test-user"];
    return { userId: typeof userId === "string" && userId ? userId : null };
  },
  // Auto-approve every test user (owner email) so the write endpoint stays
  // reachable; the approval gate itself is exercised in access.test.ts.
  clerkClient: {
    users: {
      getUser: async () => ({
        primaryEmailAddressId: "e1",
        emailAddresses: [{ id: "e1", emailAddress: "nicokooijman@gmail.com" }],
      }),
    },
  },
}));

const { default: sharedRoutesRouter, publicSharedRoutesRouter } = await import(
  "./shared-routes"
);
const { db, sharedRoutesTable, userAccessTable, pool } = await import(
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
  // Mirror production mounting: the public GET is mounted without auth, the
  // POST router enforces requireAuth itself.
  app.use("/api", publicSharedRoutesRouter);
  app.use("/api", sharedRoutesRouter);
  return app;
}

const app = makeApp();

const usedOwners = new Set<string>();

function newOwner(): string {
  const owner = `test_${randomUUID()}`;
  usedOwners.add(owner);
  return owner;
}

function samplePayload(name?: string) {
  return {
    ...(name !== undefined ? { name } : {}),
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
  if (usedOwners.size > 0) {
    await db
      .delete(sharedRoutesTable)
      .where(inArray(sharedRoutesTable.ownerKey, [...usedOwners]));
    await db
      .delete(userAccessTable)
      .where(inArray(userAccessTable.userId, [...usedOwners]));
  }
  await pool.end();
});

describe("shared routes", () => {
  it("creates a share and serves it publicly without auth", async () => {
    const owner = newOwner();

    const created = await request(app)
      .post("/api/shared-routes")
      .set("x-test-user", owner)
      .send(samplePayload("Zondagsrit"));
    expect(created.status).toBe(201);
    expect(typeof created.body.token).toBe("string");
    expect(created.body.token.length).toBeGreaterThanOrEqual(16);

    // Public read: no auth header at all.
    const fetched = await request(app).get(
      `/api/shared/${created.body.token}`,
    );
    expect(fetched.status).toBe(200);
    expect(fetched.body.name).toBe("Zondagsrit");
    expect(fetched.body.nodes).toHaveLength(2);
    expect(fetched.body.plan.distanceMeters).toBe(1234);
    expect(fetched.body.plan.nodeRefs).toEqual(["34", "35"]);
    expect(fetched.body.createdAt).toBeTruthy();
  });

  it("allows sharing without a name", async () => {
    const owner = newOwner();
    const created = await request(app)
      .post("/api/shared-routes")
      .set("x-test-user", owner)
      .send(samplePayload());
    expect(created.status).toBe(201);

    const fetched = await request(app).get(
      `/api/shared/${created.body.token}`,
    );
    expect(fetched.status).toBe(200);
    expect(fetched.body.name).toBeUndefined();
  });

  it("returns 404 for an unknown token", async () => {
    const res = await request(app).get("/api/shared/does-not-exist");
    expect(res.status).toBe(404);
  });

  it("requires authentication to create a share", async () => {
    const res = await request(app)
      .post("/api/shared-routes")
      .send(samplePayload("Nope"));
    expect(res.status).toBe(401);
  });

  it("rejects a route with fewer than 2 nodes", async () => {
    const owner = newOwner();
    const payload = samplePayload("Too short");
    payload.nodes = payload.nodes.slice(0, 1);
    const res = await request(app)
      .post("/api/shared-routes")
      .set("x-test-user", owner)
      .send(payload);
    expect(res.status).toBe(400);
  });

  it("issues unique tokens per share", async () => {
    const owner = newOwner();
    const a = await request(app)
      .post("/api/shared-routes")
      .set("x-test-user", owner)
      .send(samplePayload("A"));
    const b = await request(app)
      .post("/api/shared-routes")
      .set("x-test-user", owner)
      .send(samplePayload("B"));
    expect(a.body.token).not.toBe(b.body.token);
  });
});
