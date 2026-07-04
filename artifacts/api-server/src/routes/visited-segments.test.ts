import { afterAll, describe, expect, it, vi } from "vitest";
import express, { type Express } from "express";
import request from "supertest";
import { randomUUID } from "node:crypto";

// Stub Clerk so tests can control the authenticated user via a request header.
// The router only reads `getAuth(req).userId`, which maps to the owner key used
// to scope visited segments. An absent/empty header means an anonymous request.
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

const { default: visitedSegmentsRouter } = await import("./visited-segments");
const { db, visitedSegmentsTable, userAccessTable, pool } = await import(
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
  app.use("/api", visitedSegmentsRouter);
  return app;
}

const app = makeApp();

const usedOwners = new Set<string>();

function newOwner(): string {
  const owner = `test_${randomUUID()}`;
  usedOwners.add(owner);
  return owner;
}

function segment(segmentKey: string, fromRef: string, toRef: string) {
  return { segmentKey, fromRef, toRef, lon: 5.12 + Math.random(), lat: 52.09 };
}

function save(owner: string, segments: ReturnType<typeof segment>[]) {
  return request(app)
    .post("/api/visited-segments")
    .set("x-test-user", owner)
    .send({ segments });
}

afterAll(async () => {
  if (usedOwners.size > 0) {
    await db
      .delete(visitedSegmentsTable)
      .where(inArray(visitedSegmentsTable.ownerKey, [...usedOwners]));
    await db
      .delete(userAccessTable)
      .where(inArray(userAccessTable.userId, [...usedOwners]));
  }
  await pool.end();
});

describe("visited-segments happy path", () => {
  it("saves new segments, ignores duplicates, and lists them back", async () => {
    const owner = newOwner();

    const first = await save(owner, [
      segment("100__200", "34", "35"),
      segment("200__300", "35", "36"),
    ]);
    expect(first.status).toBe(200);
    expect(first.body).toEqual({ saved: 2 });

    // Re-sending one existing plus one new only records the new one.
    const second = await save(owner, [
      segment("200__300", "35", "36"),
      segment("300__400", "36", "37"),
    ]);
    expect(second.status).toBe(200);
    expect(second.body).toEqual({ saved: 1 });

    const list = await request(app)
      .get("/api/visited-segments")
      .set("x-test-user", owner);
    expect(list.status).toBe(200);
    const keys = list.body.map((s: { segmentKey: string }) => s.segmentKey).sort();
    expect(keys).toEqual(["100__200", "200__300", "300__400"]);
    const sample = list.body.find(
      (s: { segmentKey: string }) => s.segmentKey === "100__200",
    );
    expect(sample.fromRef).toBe("34");
    expect(sample.toRef).toBe("35");
    expect(typeof sample.lon).toBe("number");
    expect(typeof sample.lat).toBe("number");
  });

  it("de-duplicates repeated keys within a single request", async () => {
    const owner = newOwner();
    const res = await save(owner, [
      segment("aa__bb", "1", "2"),
      segment("aa__bb", "1", "2"),
    ]);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ saved: 1 });
  });
});

describe("visited-segments ownership scoping", () => {
  it("does not expose one user's segments to another", async () => {
    const owner = newOwner();
    const other = newOwner();

    await save(owner, [segment("private__seg", "9", "10")]);

    const otherList = await request(app)
      .get("/api/visited-segments")
      .set("x-test-user", other);
    expect(otherList.status).toBe(200);
    expect(
      otherList.body.some(
        (s: { segmentKey: string }) => s.segmentKey === "private__seg",
      ),
    ).toBe(false);
  });
});

describe("visited-segments validation", () => {
  it("requires authentication to list", async () => {
    const res = await request(app).get("/api/visited-segments");
    expect(res.status).toBe(401);
  });

  it("requires authentication to save", async () => {
    const res = await request(app)
      .post("/api/visited-segments")
      .send({ segments: [segment("x__y", "1", "2")] });
    expect(res.status).toBe(401);
  });

  it("rejects a malformed body", async () => {
    const owner = newOwner();
    const res = await request(app)
      .post("/api/visited-segments")
      .set("x-test-user", owner)
      .send({ segments: [{ segmentKey: "z", fromRef: "1" }] });
    expect(res.status).toBe(400);
  });

  it("accepts an empty segment list as a no-op", async () => {
    const owner = newOwner();
    const res = await save(owner, []);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ saved: 0 });
  });
});
