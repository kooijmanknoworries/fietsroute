import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import express, { type Express } from "express";
import request from "supertest";
import { inArray } from "drizzle-orm";
import { db, overpassCacheTable } from "@workspace/db";
import networkRouter from "./network";

// getNetworkData snaps the requested bbox out to the 0.1° tile grid and fetches
// each tile through fetchOverpass, which reads an in-memory L1 cache and a
// persistent Postgres cache (keyed by the rounded tile bbox) before honoring
// the mocked fetch. The valid-bbox test below fits inside a single tile whose
// key we clear so the mocked Overpass response isn't shadowed by warmed data.
const SINGLE_TILE_KEY = "5.000,52.000,5.100,52.100";
const TEST_CACHE_KEYS = [SINGLE_TILE_KEY];

async function clearOverpassCache(): Promise<void> {
  await db
    .delete(overpassCacheTable)
    .where(inArray(overpassCacheTable.key, TEST_CACHE_KEYS));
}

function buildApp(): Express {
  const app = express();
  // pino-http normally attaches `req.log`; provide a no-op stand-in so the
  // error path can log without a full logging stack.
  app.use((req, _res, next) => {
    (req as unknown as { log: { error: () => void } }).log = {
      error: () => {},
    };
    next();
  });
  app.use("/api", networkRouter);
  return app;
}

function mockOverpass(elements: unknown[]): void {
  vi.spyOn(globalThis, "fetch").mockImplementation(
    async () =>
      new Response(JSON.stringify({ elements }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
  );
}

describe("GET /api/network", () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    await clearOverpassCache();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await clearOverpassCache();
  });

  it("returns 400 when bbox is missing", async () => {
    const res = await request(buildApp()).get("/api/network");
    expect(res.status).toBe(400);
  });

  it("returns 400 for a malformed bbox", async () => {
    const res = await request(buildApp())
      .get("/api/network")
      .query({ bbox: "not-a-bbox" });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/bbox/i);
  });

  it("returns 400 when bbox min is not less than max", async () => {
    const res = await request(buildApp())
      .get("/api/network")
      .query({ bbox: "5.1,52.1,5.0,52.0" });
    expect(res.status).toBe(400);
  });

  it("returns nodes and segments for a valid bbox", async () => {
    mockOverpass([
      { type: "node", id: 1, lat: 52.01, lon: 5.01, tags: { rcn_ref: "34" } },
      { type: "node", id: 2, lat: 52.02, lon: 5.02, tags: { rcn_ref: "35" } },
      { type: "way", id: 100, nodes: [1, 2] },
    ]);

    const res = await request(buildApp())
      .get("/api/network")
      .query({ bbox: "5.0,52.0,5.05,52.05" });

    expect(res.status).toBe(200);
    expect(res.body.truncated).toBe(false);
    expect(res.body.nodes).toEqual([
      { id: "1", ref: "34", lat: 52.01, lon: 5.01 },
      { id: "2", ref: "35", lat: 52.02, lon: 5.02 },
    ]);
    expect(res.body.segments).toEqual([
      {
        id: "100",
        coordinates: [
          [5.01, 52.01],
          [5.02, 52.02],
        ],
      },
    ]);
  });

  it("rejects an oversized bbox without calling Overpass", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    const res = await request(buildApp())
      .get("/api/network")
      // ~1 deg² area, well over the MAX_AREA_DEG2 cap.
      .query({ bbox: "0,0,1,1" });

    expect(res.status).toBe(200);
    expect(res.body.truncated).toBe(true);
    expect(res.body.nodes).toEqual([]);
    expect(res.body.segments).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
