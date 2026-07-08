import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import express, { type Express } from "express";
import request from "supertest";
import { inArray, like } from "drizzle-orm";
import {
  db,
  overpassCacheTable,
  networkNodesTable,
  networkSegmentsTable,
} from "@workspace/db";
import routeRouter from "./route";

// Offgrid legs are routed via an external OSRM instance (mocked here) and
// cached in overpass_cache under "osrm:"-prefixed keys. Tests must clear those
// rows (persistent cache is read before the mocked fetch — see the geocode
// cache isolation lesson) and use coordinates unique to this suite so the
// in-memory L1 cache from other suites can't shadow the mocks.

const PREV_MIN_NODE_COUNT = process.env.DATASET_MIN_NODE_COUNT;
process.env.DATASET_MIN_NODE_COUNT = "0";

// Coordinates unique to this suite (lat ~50.7 / lon ~4.3 — outside other
// route-test fixtures).
const FREE_A = { id: "free-1", ref: "", lat: 50.7, lon: 4.3, kind: "free" as const };
const FREE_B = { id: "free-2", ref: "", lat: 50.702, lon: 4.302, kind: "free" as const };
const FREE_C = { id: "free-3", ref: "", lat: 50.704, lon: 4.304, kind: "free" as const };

// Network fixture for the mixed test — ids distinct from route.test.ts.
const NET_NODES = [
  { id: "9101", ref: "71", lat: 50.71, lon: 4.31 },
  { id: "9102", ref: "72", lat: 50.711, lon: 4.311 },
  { id: "9103", ref: "73", lat: 50.712, lon: 4.312 },
  { id: "9104", ref: "74", lat: 50.713, lon: 4.313 },
  { id: "9105", ref: "75", lat: 50.714, lon: 4.314 },
];
const NET_SEG_IDS = ["9200", "9201", "9202", "9203"];

const OSRM_KEY_PREFIX = "osrm:4.30";

async function clearFixtures(): Promise<void> {
  await db
    .delete(overpassCacheTable)
    .where(like(overpassCacheTable.key, `${OSRM_KEY_PREFIX}%`));
  await db
    .delete(networkNodesTable)
    .where(inArray(networkNodesTable.id, NET_NODES.map((n) => n.id)));
  await db
    .delete(networkSegmentsTable)
    .where(inArray(networkSegmentsTable.id, NET_SEG_IDS));
}

async function insertNetwork(): Promise<void> {
  await db.insert(networkNodesTable).values(NET_NODES);
  await db.insert(networkSegmentsTable).values([
    {
      id: "9200",
      coordinates: [[4.31, 50.71], [4.311, 50.711]],
      nodeIds: [9101, 9102],
      minLat: 50.71,
      maxLat: 50.711,
      minLon: 4.31,
      maxLon: 4.311,
    },
    {
      id: "9201",
      coordinates: [[4.311, 50.711], [4.312, 50.712]],
      nodeIds: [9102, 9103],
      minLat: 50.711,
      maxLat: 50.712,
      minLon: 4.311,
      maxLon: 4.312,
    },
    {
      id: "9202",
      coordinates: [[4.312, 50.712], [4.313, 50.713]],
      nodeIds: [9103, 9104],
      minLat: 50.712,
      maxLat: 50.713,
      minLon: 4.312,
      maxLon: 4.313,
    },
    {
      id: "9203",
      coordinates: [[4.313, 50.713], [4.314, 50.714]],
      nodeIds: [9104, 9105],
      minLat: 50.713,
      maxLat: 50.714,
      minLon: 4.313,
      maxLon: 4.314,
    },
  ]);
}

function buildApp(): Express {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as unknown as { log: { error: () => void } }).log = { error: () => {} };
    next();
  });
  app.use("/api", routeRouter);
  return app;
}

function osrmOk(coordinates: number[][], distance: number): Response {
  return new Response(
    JSON.stringify({
      code: "Ok",
      routes: [{ distance, geometry: { coordinates } }],
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

function osrmNoRoute(): Response {
  return new Response(JSON.stringify({ code: "NoRoute", routes: [] }), {
    status: 400,
    headers: { "content-type": "application/json" },
  });
}

/**
 * Mock fetch: OSRM URLs get the provided handler; anything else (Overpass
 * fallback) gets an empty-elements payload unless overridden.
 */
function mockFetch(osrm: (url: string) => Response): void {
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = String(input);
    if (url.includes("/route/v1/")) return osrm(url);
    return new Response(JSON.stringify({ elements: [] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });
}

describe("POST /api/route (offgrid)", () => {
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

  it("routes a pure offgrid request via OSRM and tags legs with mode", async () => {
    mockFetch(() =>
      osrmOk(
        [
          [FREE_A.lon, FREE_A.lat],
          [4.301, 50.701],
          [FREE_B.lon, FREE_B.lat],
        ],
        350,
      ),
    );

    const res = await request(buildApp())
      .post("/api/route")
      .send({ nodes: [FREE_A, FREE_B] });

    expect(res.status).toBe(200);
    expect(res.body.legs).toHaveLength(1);
    expect(res.body.legs[0].mode).toBe("offgrid");
    expect(res.body.legs[0].distanceMeters).toBe(350);
    expect(res.body.coordinates).toEqual([
      [FREE_A.lon, FREE_A.lat],
      [4.301, 50.701],
      [FREE_B.lon, FREE_B.lat],
    ]);
    expect(res.body.distanceMeters).toBe(350);
  });

  it("does not fetch the node network when all legs are offgrid", async () => {
    mockFetch(() =>
      osrmOk(
        [
          [FREE_B.lon, FREE_B.lat],
          [FREE_C.lon, FREE_C.lat],
        ],
        280,
      ),
    );

    const res = await request(buildApp())
      .post("/api/route")
      .send({ nodes: [FREE_B, FREE_C] });

    expect(res.status).toBe(200);
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    const calledUrls = fetchMock.mock.calls.map((c: unknown[]) => String(c[0]));
    expect(calledUrls.every((u: string) => u.includes("/route/v1/"))).toBe(true);
  });

  it("mixes a network leg and an offgrid leg in one route", async () => {
    await insertNetwork();
    mockFetch(() =>
      osrmOk(
        [
          [4.312, 50.712],
          [4.308, 50.708],
          [FREE_A.lon, FREE_A.lat],
        ],
        900,
      ),
    );

    // Network leg 71 -> 73, then offgrid leg 73 -> free point.
    const res = await request(buildApp())
      .post("/api/route")
      .send({
        nodes: [
          { id: "9101", ref: "71", lat: 50.71, lon: 4.31 },
          { id: "9103", ref: "73", lat: 50.712, lon: 4.312 },
          FREE_A,
        ],
      });

    expect(res.status).toBe(200);
    expect(res.body.legs).toHaveLength(2);
    expect(res.body.legs[0].mode).toBe("network");
    expect(res.body.legs[0]).toMatchObject({ fromRef: "71", toRef: "73" });
    expect(res.body.legs[1].mode).toBe("offgrid");
    expect(res.body.legs[1].distanceMeters).toBe(900);
    // Total = network leg + offgrid leg
    expect(res.body.distanceMeters).toBeGreaterThan(900);
  });

  it("returns 422 when OSRM finds no bikeable path", async () => {
    mockFetch(() => osrmNoRoute());

    const res = await request(buildApp())
      .post("/api/route")
      .send({ nodes: [FREE_A, FREE_C] });

    expect(res.status).toBe(422);
    expect(res.body.message).toMatch(/no bikeable path/i);
  });
});
