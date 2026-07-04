import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import express, { type Express } from "express";
import request from "supertest";
import { inArray } from "drizzle-orm";
import {
  db,
  overpassCacheTable,
  networkNodesTable,
  networkSegmentsTable,
} from "@workspace/db";
import routeRouter from "./route";

// planRoute now reads from the preloaded network_nodes / network_segments tables
// instead of hitting Overpass. Tests populate the DB with fixture data, and
// clean up rows afterwards so they don't interfere with other suites.

// The routing dataset path normally requires a minimum global node count (a
// partially imported shared DB would otherwise fall back to live Overpass and
// ignore the fixtures). Override the threshold so the tests are deterministic
// regardless of import progress. Restored in afterAll to avoid env leakage.
const PREV_MIN_NODE_COUNT = process.env.DATASET_MIN_NODE_COUNT;
process.env.DATASET_MIN_NODE_COUNT = "0";

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

// Two requested nodes that sit close together (valid area) but far from every
// vertex of the mocked network, so each fails to snap within MAX_SNAP_METERS.
// Placed at lat 40 / lon 0 — deliberately OUTSIDE the NL+BE preload bbox — so
// the shared network_nodes table holds no real vertices near them. (Inside NL,
// raising the snap tolerance to 500m would let a real preloaded knooppunt snap
// and this "can't be snapped" case would no longer hold.)
const UNSNAPPABLE_NODES: TestNode[] = [
  { id: "21", ref: "21", lat: 40.0, lon: 0.0 },
  { id: "22", ref: "22", lat: 40.002, lon: 0.002 },
];

// The network lies ~4.2km east of the requested nodes (0.05 deg lon at lat 40),
// well beyond MAX_SNAP_METERS (500m), so resolveVertex can't snap either node.
const UNSNAPPABLE_ELEMENTS = [
  { type: "node", id: 31, lat: 40.0, lon: 0.05 },
  { type: "node", id: 32, lat: 40.001, lon: 0.051 },
  { type: "way", id: 300, nodes: [31, 32] },
];

// Live-Overpass fallback scenario. Kept at lat 41 / lon 0 — a DIFFERENT bbox
// (hence a different Overpass cache key) than the UNSNAPPABLE case above, so the
// in-memory L1 Overpass cache populated by that test can't shadow this one.
const FALLBACK_NODES: TestNode[] = [
  { id: "81", ref: "81", lat: 41.0, lon: 0.0 },
  { id: "82", ref: "82", lat: 41.002, lon: 0.002 },
];

// Live Overpass network covering the FALLBACK request coords: a connected way
// whose vertices (ids 701-703) sit exactly on the two requested nodes. When the
// preloaded dataset only holds the far-away network (insertFallbackFarNetwork)
// the first resolve fails, and this live payload lets the single Overpass retry
// snap both endpoints and produce a route.
const FALLBACK_ELEMENTS = [
  { type: "node", id: 701, lat: 41.0, lon: 0.0 },
  { type: "node", id: 702, lat: 41.001, lon: 0.001 },
  { type: "node", id: 703, lat: 41.002, lon: 0.002 },
  { type: "way", id: 700, nodes: [701, 702, 703] },
];

// A clicked knooppunt that is a standalone marker: its id (9001) is not part of
// any stored way, so it never appears in the routing graph, but it sits ~13m
// from junction node 1 of the connected network. This is exactly the class of
// node that used to fail with "Could not locate node"; it must snap onto the
// network and route normally.
const MARKER_NODE: TestNode = { id: "9001", ref: "63", lat: 52.0001, lon: 5.0001 };

// Two nodes whose padded bbox spans more than MAX_ROUTE_AREA_DEG2 (1.0). With a
// 0.08 pad on each side a 1.5x1.5 deg span yields (1.66)^2 ~= 2.75 deg^2. These
// are rejected before any Overpass call, so no mock/cache handling is needed.
const TOO_FAR_NODES: TestNode[] = [
  { id: "1", ref: "1", lat: 52.0, lon: 5.0 },
  { id: "3", ref: "3", lat: 53.5, lon: 6.5 },
];

// 51 nodes (> MAX_ROUTE_NODES, which is 50). Kept close together so only the
// node-count guard trips; this is also rejected before any Overpass call.
const TOO_MANY_NODES: TestNode[] = Array.from({ length: 51 }, (_, i) => ({
  id: String(i + 1),
  ref: String(i + 1),
  lat: 52.0,
  lon: 5.0 + i * 0.0001,
}));

const TEST_CACHE_KEYS = [
  routeCacheKey(CONNECTED_NODES),
  routeCacheKey(DISCONNECTED_NODES),
  routeCacheKey(UNSNAPPABLE_NODES),
  routeCacheKey(FALLBACK_NODES),
];

const ALL_TEST_NODE_IDS = [
  "1", "2", "3", "41", "42", "43", "11", "12", "13", "14", "51", "52",
  "21", "22", "31", "32", "61", "62", "63", "83", "84",
];
const ALL_TEST_SEG_IDS = [
  "100", "401", "402", "200", "201", "501", "300", "601", "602", "800",
];

async function clearFixtures(): Promise<void> {
  await db
    .delete(overpassCacheTable)
    .where(inArray(overpassCacheTable.key, TEST_CACHE_KEYS));
  await db
    .delete(networkNodesTable)
    .where(inArray(networkNodesTable.id, ALL_TEST_NODE_IDS));
  await db
    .delete(networkSegmentsTable)
    .where(inArray(networkSegmentsTable.id, ALL_TEST_SEG_IDS));
}

async function insertConnectedNetwork(): Promise<void> {
  // Insert enough nodes + segments so the sparse-coverage fallback
  // (>=5 nodes/segments) is not triggered.
  await db.insert(networkNodesTable).values([
    { id: "1", ref: "1", lat: 52.0, lon: 5.0 },
    { id: "2", ref: "2", lat: 52.001, lon: 5.001 },
    { id: "3", ref: "3", lat: 52.002, lon: 5.002 },
    { id: "41", ref: "41", lat: 52.003, lon: 5.003 },
    { id: "42", ref: "42", lat: 52.004, lon: 5.004 },
    { id: "43", ref: "43", lat: 52.005, lon: 5.005 },
  ]);
  await db.insert(networkSegmentsTable).values([
    {
      id: "100",
      coordinates: [[5.0, 52.0], [5.001, 52.001], [5.002, 52.002]],
      nodeIds: [1, 2, 3],
      minLat: 52.0,
      maxLat: 52.002,
      minLon: 5.0,
      maxLon: 5.002,
    },
    {
      id: "401",
      coordinates: [[5.003, 52.003], [5.004, 52.004]],
      nodeIds: [41, 42],
      minLat: 52.003,
      maxLat: 52.004,
      minLon: 5.003,
      maxLon: 5.004,
    },
    {
      id: "402",
      coordinates: [[5.004, 52.004], [5.005, 52.005]],
      nodeIds: [42, 43],
      minLat: 52.004,
      maxLat: 52.005,
      minLon: 5.004,
      maxLon: 5.005,
    },
  ]);
}

async function insertDisconnectedNetwork(): Promise<void> {
  await db.insert(networkNodesTable).values([
    { id: "11", ref: "11", lat: 52.0, lon: 6.0 },
    { id: "12", ref: "12", lat: 52.001, lon: 6.001 },
    { id: "13", ref: "13", lat: 52.1, lon: 6.1 },
    { id: "14", ref: "14", lat: 52.101, lon: 6.101 },
    { id: "51", ref: "51", lat: 52.002, lon: 6.002 },
    { id: "52", ref: "52", lat: 52.003, lon: 6.003 },
  ]);
  await db.insert(networkSegmentsTable).values([
    {
      id: "200",
      coordinates: [[6.0, 52.0], [6.001, 52.001]],
      nodeIds: [11, 12],
      minLat: 52.0,
      maxLat: 52.001,
      minLon: 6.0,
      maxLon: 6.001,
    },
    {
      id: "201",
      coordinates: [[6.1, 52.1], [6.101, 52.101]],
      nodeIds: [13, 14],
      minLat: 52.1,
      maxLat: 52.101,
      minLon: 6.1,
      maxLon: 6.101,
    },
    {
      id: "501",
      coordinates: [[6.002, 52.002], [6.003, 52.003]],
      nodeIds: [51, 52],
      minLat: 52.002,
      maxLat: 52.003,
      minLon: 6.002,
      maxLon: 6.003,
    },
  ]);
}

async function insertUnsnappableNetwork(): Promise<void> {
  // Network lies ~4.2km east of requested nodes (0.05 deg lon at lat 40),
  // outside the NL+BE preload region so no real vertices interfere.
  await db.insert(networkNodesTable).values([
    { id: "31", ref: "31", lat: 40.0, lon: 0.05 },
    { id: "32", ref: "32", lat: 40.001, lon: 0.051 },
    { id: "61", ref: "61", lat: 40.002, lon: 0.052 },
    { id: "62", ref: "62", lat: 40.003, lon: 0.053 },
    { id: "63", ref: "63", lat: 40.004, lon: 0.054 },
  ]);
  await db.insert(networkSegmentsTable).values([
    {
      id: "300",
      coordinates: [[0.05, 40.0], [0.051, 40.001]],
      nodeIds: [31, 32],
      minLat: 40.0,
      maxLat: 40.001,
      minLon: 0.05,
      maxLon: 0.051,
    },
    {
      id: "601",
      coordinates: [[0.052, 40.002], [0.053, 40.003]],
      nodeIds: [61, 62],
      minLat: 40.002,
      maxLat: 40.003,
      minLon: 0.052,
      maxLon: 0.053,
    },
    {
      id: "602",
      coordinates: [[0.053, 40.003], [0.054, 40.004]],
      nodeIds: [62, 63],
      minLat: 40.003,
      maxLat: 40.004,
      minLon: 0.053,
      maxLon: 0.054,
    },
  ]);
}

async function insertFallbackFarNetwork(): Promise<void> {
  // A far-away (~4.2km) dataset network near the FALLBACK request coords: enough
  // rows for getNetworkForRoute to use the dataset path, but too distant to snap
  // (> MAX_SNAP_METERS), so the first resolve fails and the live retry kicks in.
  await db.insert(networkNodesTable).values([
    { id: "83", ref: "83", lat: 41.0, lon: 0.05 },
    { id: "84", ref: "84", lat: 41.001, lon: 0.051 },
  ]);
  await db.insert(networkSegmentsTable).values([
    {
      id: "800",
      coordinates: [[0.05, 41.0], [0.051, 41.001]],
      nodeIds: [83, 84],
      minLat: 41.0,
      maxLat: 41.001,
      minLon: 0.05,
      maxLon: 0.051,
    },
  ]);
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
    await clearFixtures();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await clearFixtures();
  });

  afterAll(() => {
    if (PREV_MIN_NODE_COUNT === undefined) {
      delete process.env.DATASET_MIN_NODE_COUNT;
    } else {
      process.env.DATASET_MIN_NODE_COUNT = PREV_MIN_NODE_COUNT;
    }
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
    await insertConnectedNetwork();
    // The router uses the dataset tables when they hold enough rows, and falls
    // back to live Overpass otherwise (DATASET_MIN_NODE_COUNT). Mock the
    // fallback with the same network so the test passes on either path.
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

  it("routes from a marker knooppunt that isn't a graph vertex by snapping to the nearest junction", async () => {
    await insertConnectedNetwork();
    // Snapping succeeds off the dataset, so the live fallback shouldn't fire;
    // mock it anyway with the same network to stay robust either way.
    mockOverpass(CONNECTED_ELEMENTS);

    const res = await request(buildApp())
      .post("/api/route")
      .send({ nodes: [MARKER_NODE, CONNECTED_NODES[1]] });

    expect(res.status).toBe(200);
    // The marker (ref 63) snaps onto junction node 1 and routes through node 2
    // to node 3.
    expect(res.body.nodeRefs).toEqual(["63", "3"]);
    expect(res.body.legs).toHaveLength(1);
    expect(res.body.distanceMeters).toBeGreaterThan(0);
    expect(res.body.coordinates.length).toBeGreaterThanOrEqual(2);
  });

  it("returns 422 when no path connects the requested nodes", async () => {
    await insertDisconnectedNetwork();
    // Same-network mock so the live-Overpass fallback path behaves like the
    // dataset path (see the connected-route test above).
    mockOverpass(DISCONNECTED_ELEMENTS);

    const res = await request(buildApp())
      .post("/api/route")
      .send({ nodes: DISCONNECTED_NODES });

    expect(res.status).toBe(422);
    expect(res.body.message).toMatch(/no connecting path/i);
  });

  it("returns 400 when the selected nodes span too large an area", async () => {
    const res = await request(buildApp())
      .post("/api/route")
      .send({ nodes: TOO_FAR_NODES });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/too far apart/i);
  });

  it("returns 400 when more than the maximum number of nodes are selected", async () => {
    const res = await request(buildApp())
      .post("/api/route")
      .send({ nodes: TOO_MANY_NODES });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/too many nodes/i);
  });

  it("returns 422 when a node cannot be snapped onto the network", async () => {
    await insertUnsnappableNetwork();
    // Same-network mock so the live-Overpass fallback path behaves like the
    // dataset path (see the connected-route test above).
    mockOverpass(UNSNAPPABLE_ELEMENTS);

    const res = await request(buildApp())
      .post("/api/route")
      .send({ nodes: UNSNAPPABLE_NODES });

    expect(res.status).toBe(422);
    expect(res.body.message).toMatch(/could not locate node/i);
  });

  it("falls back to live Overpass and routes when the dataset can't resolve an endpoint", async () => {
    // The preloaded dataset only covers the far-away network, so resolving the
    // requested endpoints against it fails (they're > MAX_SNAP_METERS away).
    await insertFallbackFarNetwork();
    // Live Overpass, however, returns a connected way sitting on the requested
    // coords — the single retry in planRoute should snap onto it and succeed.
    mockOverpass(FALLBACK_ELEMENTS);

    const res = await request(buildApp())
      .post("/api/route")
      .send({ nodes: FALLBACK_NODES });

    expect(res.status).toBe(200);
    expect(res.body.nodeRefs).toEqual(["81", "82"]);
    expect(res.body.legs).toHaveLength(1);
    expect(res.body.distanceMeters).toBeGreaterThan(0);
    expect(res.body.coordinates.length).toBeGreaterThanOrEqual(2);
  });
});
