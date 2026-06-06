import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import express, { type Express } from "express";
import request from "supertest";
import { inArray } from "drizzle-orm";
import { db, geocodeCacheTable } from "@workspace/db";
import geocodeRouter from "./geocode";

// The geocode service reads its persistent Postgres cache before honoring the
// mocked Nominatim fetch, so a previously cached/warmed entry (e.g. from the
// startup municipality warmer) would otherwise shadow the mocked response.
// Clear the keys these tests exercise so each run is deterministic.
const TEST_CACHE_KEYS = ["utrecht", "geocoder-failure-town"];

async function clearGeocodeCache(): Promise<void> {
  await db
    .delete(geocodeCacheTable)
    .where(inArray(geocodeCacheTable.key, TEST_CACHE_KEYS));
}

function buildApp(): Express {
  const app = express();
  app.use(express.urlencoded({ extended: true }));
  // pino-http normally attaches `req.log`; provide a no-op stand-in so the
  // error path can log without a full logging stack.
  app.use((req, _res, next) => {
    (req as unknown as { log: { error: () => void } }).log = {
      error: () => {},
    };
    next();
  });
  app.use("/api", geocodeRouter);
  return app;
}

function mockNominatimOnce(items: unknown[]): void {
  vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(JSON.stringify(items), {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
  );
}

describe("GET /api/geocode", () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    await clearGeocodeCache();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await clearGeocodeCache();
  });

  it("returns 400 when q is missing", async () => {
    const res = await request(buildApp()).get("/api/geocode");
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/required/i);
  });

  it("returns 400 when q is shorter than 2 characters", async () => {
    const res = await request(buildApp()).get("/api/geocode").query({ q: "a" });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/at least 2 characters/i);
  });

  it("returns 400 when q is only whitespace", async () => {
    const res = await request(buildApp()).get("/api/geocode").query({ q: "  " });
    expect(res.status).toBe(400);
  });

  it("returns mapped municipality results with a boundingBox for a valid query", async () => {
    // Nominatim's boundingbox is [south, north, west, east] as strings.
    mockNominatimOnce([
      {
        osm_type: "relation",
        osm_id: 47811,
        lat: "52.0907",
        lon: "5.1214",
        name: "Utrecht",
        display_name: "Utrecht, Nederland",
        category: "boundary",
        type: "administrative",
        importance: 0.8,
        boundingbox: ["52.0", "52.15", "5.0", "5.25"],
      },
    ]);

    const res = await request(buildApp())
      .get("/api/geocode")
      .query({ q: "Utrecht" });

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThan(0);

    const first = res.body[0];
    expect(first).toMatchObject({
      id: "relation/47811",
      name: "Utrecht",
      displayName: "Utrecht, Nederland",
      lat: 52.0907,
      lon: 5.1214,
      boundingBox: {
        south: 52.0,
        north: 52.15,
        west: 5.0,
        east: 5.25,
      },
    });
  });

  it("returns 502 when the upstream geocoder fails", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("nope", { status: 500 }),
    );

    const res = await request(buildApp())
      .get("/api/geocode")
      // Unique query string to avoid the in-memory cache from other tests.
      .query({ q: "Geocoder-Failure-Town" });

    expect(res.status).toBe(502);
  });
});
