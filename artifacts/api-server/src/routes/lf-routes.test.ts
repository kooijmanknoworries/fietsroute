import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import express, { type Express } from "express";
import request from "supertest";
import { inArray } from "drizzle-orm";
import { db, overpassCacheTable } from "@workspace/db";
import lfRoutesRouter from "./lf-routes";

// getLfRoutesData caches per requested bbox (rounded to 3 decimals) in both an
// in-memory L1 and the shared overpass_cache table, under an "lf:"-prefixed
// key. Clear the persistent rows for the bboxes used below so warmed/real data
// doesn't shadow the mocked Overpass responses. The in-memory L1 is avoided by
// giving each test that mocks a different response its own unique bbox.
const TEST_CACHE_KEYS = [
  "lf:5.000,52.000,5.100,52.100",
  "lf:5.200,52.200,5.300,52.300",
];

async function clearLfCache(): Promise<void> {
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
  app.use("/api", lfRoutesRouter);
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

describe("GET /api/lf-routes", () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    await clearLfCache();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await clearLfCache();
  });

  it("returns 400 when bbox is missing", async () => {
    const res = await request(buildApp()).get("/api/lf-routes");
    expect(res.status).toBe(400);
  });

  it("returns 400 for a malformed bbox", async () => {
    const res = await request(buildApp())
      .get("/api/lf-routes")
      .query({ bbox: "not-a-bbox" });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/bbox/i);
  });

  it("returns 400 when bbox min is not less than max", async () => {
    const res = await request(buildApp())
      .get("/api/lf-routes")
      .query({ bbox: "5.1,52.1,5.0,52.0" });
    expect(res.status).toBe(400);
  });

  it("returns LF routes assembled from ncn relation members", async () => {
    mockOverpass([
      {
        type: "relation",
        id: 900,
        tags: {
          name: "LF Maasroute",
          ref: "LF3",
          network: "ncn",
          route: "bicycle",
        },
        members: [
          {
            type: "way",
            ref: 1,
            role: "",
            geometry: [
              { lat: 52.01, lon: 5.01 },
              { lat: 52.02, lon: 5.02 },
            ],
          },
          {
            type: "way",
            ref: 2,
            role: "",
            geometry: [
              { lat: 52.03, lon: 5.03 },
              { lat: 52.04, lon: 5.04 },
            ],
          },
          // Node members (e.g. route markers) must be ignored.
          { type: "node", ref: 3, role: "marker" },
          // Ways clipped entirely outside the bbox come back without geometry.
          { type: "way", ref: 4, role: "" },
        ],
      },
      // A relation with no usable geometry in the bbox is dropped entirely.
      {
        type: "relation",
        id: 901,
        tags: { name: "LF Kustroute", network: "ncn", route: "bicycle" },
        members: [{ type: "way", ref: 5, role: "" }],
      },
    ]);

    const res = await request(buildApp())
      .get("/api/lf-routes")
      .query({ bbox: "5.0,52.0,5.1,52.1" });

    expect(res.status).toBe(200);
    expect(res.body.truncated).toBe(false);
    expect(res.body.routes).toEqual([
      {
        id: "900",
        name: "LF Maasroute",
        ref: "LF3",
        lines: [
          [
            [5.01, 52.01],
            [5.02, 52.02],
          ],
          [
            [5.03, 52.03],
            [5.04, 52.04],
          ],
        ],
      },
    ]);
  });

  it("serves a repeat request from cache without re-calling Overpass", async () => {
    mockOverpass([
      {
        type: "relation",
        id: 910,
        tags: { ref: "LF7" },
        members: [
          {
            type: "way",
            ref: 1,
            geometry: [
              { lat: 52.21, lon: 5.21 },
              { lat: 52.22, lon: 5.22 },
            ],
          },
        ],
      },
    ]);
    const fetchSpy = vi.mocked(globalThis.fetch);

    const first = await request(buildApp())
      .get("/api/lf-routes")
      .query({ bbox: "5.2,52.2,5.3,52.3" });
    expect(first.status).toBe(200);
    const callsAfterFirst = fetchSpy.mock.calls.length;
    expect(callsAfterFirst).toBeGreaterThan(0);

    const second = await request(buildApp())
      .get("/api/lf-routes")
      .query({ bbox: "5.2,52.2,5.3,52.3" });
    expect(second.status).toBe(200);
    expect(second.body).toEqual(first.body);
    expect(fetchSpy.mock.calls.length).toBe(callsAfterFirst);
  });

  it("rejects an oversized bbox without calling Overpass", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    const res = await request(buildApp())
      .get("/api/lf-routes")
      // ~9 deg² area, over the LF MAX_AREA_DEG2 cap.
      .query({ bbox: "3,50,6,53" });

    expect(res.status).toBe(200);
    expect(res.body.truncated).toBe(true);
    expect(res.body.routes).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("returns 502 when Overpass is unavailable", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(
      new Error("network down"),
    );

    const res = await request(buildApp())
      .get("/api/lf-routes")
      // Unique bbox so neither the memory L1 nor persistent cache is warm;
      // this key is outside TEST_CACHE_KEYS but nothing is written on failure.
      .query({ bbox: "4.4,51.4,4.5,51.5" });

    expect(res.status).toBe(502);
    expect(res.body.message).toMatch(/lf routes/i);
  });
});
