import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import express, { type Express } from "express";
import request from "supertest";
import { like } from "drizzle-orm";
import { db, overpassCacheTable } from "@workspace/db";
import poisRouter from "./pois";
import { clearPoiMemCache } from "../lib/osm/pois";

// POI results are cached in overpass_cache under the "poi:" prefix (in-memory
// L1 + persistent Postgres). Clear both around each test so warmed rows never
// shadow the mocked fetch responses.
async function clearPoiCache(): Promise<void> {
  await db
    .delete(overpassCacheTable)
    .where(like(overpassCacheTable.key, "poi:%"));
  clearPoiMemCache();
}

function buildApp(): Express {
  const app = express();
  app.use((req, _res, next) => {
    (req as unknown as { log: { error: () => void } }).log = {
      error: () => {},
    };
    next();
  });
  app.use("/api", poisRouter);
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

describe("GET /api/pois", () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    await clearPoiCache();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await clearPoiCache();
  });

  it("returns 400 when bbox is missing", async () => {
    const res = await request(buildApp())
      .get("/api/pois")
      .query({ categories: "cafe" });
    expect(res.status).toBe(400);
  });

  it("returns 400 for a malformed bbox", async () => {
    const res = await request(buildApp())
      .get("/api/pois")
      .query({ bbox: "junk", categories: "cafe" });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/bbox/i);
  });

  it("returns 400 for unknown categories", async () => {
    const res = await request(buildApp())
      .get("/api/pois")
      .query({ bbox: "5.0,52.0,5.05,52.05", categories: "cafe,nightclub" });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/categories/i);
  });

  it("returns 400 for an empty categories list", async () => {
    const res = await request(buildApp())
      .get("/api/pois")
      .query({ bbox: "5.0,52.0,5.05,52.05", categories: "" });
    expect(res.status).toBe(400);
  });

  it("returns parsed node and way POIs for a valid request", async () => {
    mockOverpass([
      {
        type: "node",
        id: 1,
        lat: 52.01,
        lon: 5.01,
        tags: { amenity: "cafe", name: "Café Zeezicht" },
      },
      {
        type: "way",
        id: 2,
        center: { lat: 52.02, lon: 5.02 },
        tags: { amenity: "restaurant" },
      },
    ]);

    const res = await request(buildApp())
      .get("/api/pois")
      .query({ bbox: "5.0,52.0,5.05,52.05", categories: "cafe" });

    expect(res.status).toBe(200);
    expect(res.body.truncated).toBe(false);
    expect(res.body.pois).toEqual([
      {
        id: "node/1",
        name: "Café Zeezicht",
        category: "cafe",
        lat: 52.01,
        lon: 5.01,
      },
      { id: "way/2", name: null, category: "cafe", lat: 52.02, lon: 5.02 },
    ]);
  });

  it("fetches each requested category once and merges results", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async (_url, init) => {
        const body = String((init as RequestInit | undefined)?.body ?? "");
        const isBikeShop = body.includes("bicycle");
        const elements = isBikeShop
          ? [
              {
                type: "node",
                id: 10,
                lat: 52.03,
                lon: 5.03,
                tags: { shop: "bicycle", name: "Fietsenmaker" },
              },
            ]
          : [
              {
                type: "node",
                id: 11,
                lat: 52.04,
                lon: 5.04,
                tags: { amenity: "cafe", name: "Koffiehuis" },
              },
            ];
        return new Response(JSON.stringify({ elements }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      });

    const res = await request(buildApp())
      .get("/api/pois")
      // Duplicate category must be de-duplicated, not fetched twice.
      .query({ bbox: "5.0,52.0,5.05,52.05", categories: "cafe,bike_shop,cafe" });

    expect(res.status).toBe(200);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    const categories = (res.body.pois as { category: string }[]).map(
      (p) => p.category,
    );
    expect(categories.sort()).toEqual(["bike_shop", "cafe"]);
  });

  it("serves the second request from cache without refetching", async () => {
    mockOverpass([
      {
        type: "node",
        id: 1,
        lat: 52.01,
        lon: 5.01,
        tags: { amenity: "cafe", name: "Cache Café" },
      },
    ]);

    const app = buildApp();
    const first = await request(app)
      .get("/api/pois")
      .query({ bbox: "5.0,52.0,5.05,52.05", categories: "cafe" });
    expect(first.status).toBe(200);

    const fetchSpy = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    const callsAfterFirst = fetchSpy.mock.calls.length;

    const second = await request(app)
      .get("/api/pois")
      .query({ bbox: "5.0,52.0,5.05,52.05", categories: "cafe" });
    expect(second.status).toBe(200);
    expect(second.body.pois).toEqual(first.body.pois);
    expect(fetchSpy.mock.calls.length).toBe(callsAfterFirst);
  });

  it("rejects an oversized bbox without calling Overpass", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    const res = await request(buildApp())
      .get("/api/pois")
      .query({ bbox: "3.0,50.0,6.0,53.0", categories: "cafe" });

    expect(res.status).toBe(200);
    expect(res.body.truncated).toBe(true);
    expect(res.body.pois).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
