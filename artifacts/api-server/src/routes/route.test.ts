import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import express, { type Express } from "express";
import request from "supertest";
import { inArray } from "drizzle-orm";
import { db, overpassCacheTable } from "@workspace/db";
import routeRouter from "./route";

// planRoute fetches its cycling network from Overpass through fetchOverpass,
// which reads an in-memory L1 cache and a persistent Postgres cache (keyed by
// the rounded bbox) before honoring the mocked fetch. To keep each test
// deterministic we (a) give every test a disjoint bbox so the in-memory cache
// from a prior test can't shadow it, and (b) clear the persistent rows for the
// bbox keys these tests exercise.

// Mirror overpass.ts cacheKey + routing.ts boundingBox (pad 0.08) so we can
// delete the exact persistent cache rows these node sets produce.
const ROUTE_PAD = 0.08;

interface TestNode {
  id: string;
  ref: string;
  lat: number;
  lon: number;
}

function routeCacheKey(nodes: TestNode[]): string {
  let minLon = Infinity;
  let minLat = Infinity;
  let maxLon = -Infinity;
  let maxLat = -Infinity;
  for (const n of nodes) {
    if (n.lon < minLon) minLon = n.lon;
    if (n.lon > maxLon) maxLon = n.lon;
    if (n.lat < minLat) minLat = n.lat;
    if (n.lat > maxLat) maxLat = n.lat;
  }
  const r = (v: number) => v.toFixed(3);
  return `${r(minLon - ROUTE_PAD)},${r(minLat - ROUTE_PAD)},${r(
    maxLon + ROUTE_PAD,
  )},${r(maxLat + ROUTE_PAD)}`;
}

// A small connected network: nodes 1-2-3 are linked by a single way, so a
// route between node 1 and node 3 follows that way's geometry.
const CONNECTED_NODES: TestNode[] = [
  { id: "1", ref: "1", lat: 52.0, lon: 5.0 },
  { id: "3", ref: "3", lat: 52.002, lon: 5.002 },
];

const CONNECTED_ELEMENTS = [
  { type: "node", id: 1, lat: 52.0, lon: 5.0 },
  { type: "node", id: 2, lat: 52.001, lon: 5.001 },
  { type: "node", id: 3, lat: 52.002, lon: 5.002 },
  { type: "way", id: 100, nodes: [1, 2, 3] },
];

// Two disjoint ways within the same bbox: node 11 and node 13 each resolve onto
// the network, but no path connects them. Deliberately offset to lon ~6 so the
// bbox (and therefore the cache key) differs from the connected case.
const DISCONNECTED_NODES: TestNode[] = [
  { id: "11", ref: "11", lat: 52.0, lon: 6.0 },
  { id: "13", ref: "13", lat: 52.1, lon: 6.1 },
];

const DISCONNECTED_ELEMENTS = [
  { type: "node", id: 11, lat: 52.0, lon: 6.0 },
  { type: "node", id: 12, lat: 52.001, lon: 6.001 },
  { type: "way", id: 200, nodes: [11, 12] },
  { type: "node", id: 13, lat: 52.1, lon: 6.1 },
  { type: "node", id: 14, lat: 52.101, lon: 6.101 },
  { type: "way", id: 201, nodes: [13, 14] },
];

const TEST_CACHE_KEYS = [
  routeCacheKey(CONNECTED_NODES),
  routeCacheKey(DISCONNECTED_NODES),
];

async function clearOverpassCache(): Promise<void> {
  await db
    .delete(overpassCacheTable)
    .where(inArray(overpassCacheTable.key, TEST_CACHE_KEYS));
}

function buildApp(): Express {
  const app = express();
  app.use(express.json());
  // pino-http normally attaches `req.log`; provide a no-op stand-in so the
  // error path can log without a full logging stack.
  app.use((req, _res, next) => {
    (req as unknown as { log: { error: () => void } }).log = {
      error: () => {},
    };
    next();
  });
  app.use("/api", routeRouter);
  return app;
}

function mockOverpass(elements: unknown[]): void {
  // Return a fresh Response each call so multiple Overpass round-trips don't
  // trip over an already-consumed body.
  vi.spyOn(globalThis, "fetch").mockImplementation(
    async () =>
      new Response(JSON.stringify({ elements }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
  );
}

describe("POST /api/route", () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    await clearOverpassCache();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await clearOverpassCache();
  });

  it("returns 400 when the body is invalid", async () => {
    const res = await request(buildApp()).post("/api/route").send({});
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/invalid/i);
  });

  it("returns 400 when fewer than two nodes are provided", async () => {
    const res = await request(buildApp())
      .post("/api/route")
      .send({ nodes: [CONNECTED_NODES[0]] });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/at least two/i);
  });

  it("returns a route connecting the requested nodes with coordinates", async () => {
    mockOverpass(CONNECTED_ELEMENTS);

    const res = await request(buildApp())
      .post("/api/route")
      .send({ nodes: CONNECTED_NODES });

    expect(res.status).toBe(200);
    expect(res.body.nodeRefs).toEqual(["1", "3"]);
    // Geometry follows the way through the intermediate node 2.
    expect(res.body.coordinates).toEqual([
      [5.0, 52.0],
      [5.001, 52.001],
      [5.002, 52.002],
    ]);
    expect(res.body.distanceMeters).toBeGreaterThan(0);
    expect(res.body.legs).toHaveLength(1);
    expect(res.body.legs[0]).toMatchObject({ fromRef: "1", toRef: "3" });
  });

  it("returns 422 when no path connects the requested nodes", async () => {
    mockOverpass(DISCONNECTED_ELEMENTS);

    const res = await request(buildApp())
      .post("/api/route")
      .send({ nodes: DISCONNECTED_NODES });

    expect(res.status).toBe(422);
    expect(res.body.message).toMatch(/no connecting path/i);
  });
});
