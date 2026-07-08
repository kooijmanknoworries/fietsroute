import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import express, { type Express } from "express";
import request from "supertest";
import { like } from "drizzle-orm";
import { db, elevationCacheTable } from "@workspace/db";
import routeRouter from "./route";
import { sampleRoute, computeClimbStats } from "../lib/elevation";

// The elevation route fetches from external providers via global fetch; mock
// it per-test. The persistent cache is cleared before and after each test so
// warmed rows can't shadow the mock (see geocode-cache-test-isolation).

function makeApp(): Express {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as unknown as { log: { error: () => void } }).log = {
      error: vi.fn(),
    } as never;
    next();
  });
  app.use(routeRouter);
  return app;
}

// Rough 3-point route near Utrecht, ~a few hundred meters apart.
const COORDS = [
  [5.1, 52.09],
  [5.102, 52.091],
  [5.104, 52.092],
];

function openTopoDataResponse(elevations: number[]) {
  return {
    ok: true,
    json: async () => ({
      results: elevations.map((elevation) => ({ elevation })),
    }),
  } as Response;
}

async function clearElevationCache() {
  await db
    .delete(elevationCacheTable)
    .where(like(elevationCacheTable.key, "elev:%"));
}

describe("POST /route/elevation", () => {
  beforeEach(async () => {
    await clearElevationCache();
    vi.restoreAllMocks();
  });

  afterEach(async () => {
    await clearElevationCache();
    vi.restoreAllMocks();
  });

  it("returns a profile with stats", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      openTopoDataResponse([10, 15, 12]),
    );

    const res = await request(makeApp())
      .post("/route/elevation")
      .send({ coordinates: COORDS });

    expect(res.status).toBe(200);
    expect(res.body.points).toHaveLength(3);
    expect(res.body.points[0].distanceMeters).toBe(0);
    expect(res.body.points[2].distanceMeters).toBeGreaterThan(0);
    expect(res.body.minElevationMeters).toBe(10);
    expect(res.body.maxElevationMeters).toBe(15);
    expect(res.body.ascentMeters).toBe(5);
    expect(res.body.descentMeters).toBe(3);
    expect(res.body.totalDistanceMeters).toBeGreaterThan(0);
  });

  it("serves repeat requests from the persistent cache", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(openTopoDataResponse([10, 15, 12]));

    const app = makeApp();
    const first = await request(app)
      .post("/route/elevation")
      .send({ coordinates: COORDS });
    expect(first.status).toBe(200);
    const callsAfterFirst = fetchSpy.mock.calls.length;
    expect(callsAfterFirst).toBeGreaterThan(0);

    const second = await request(app)
      .post("/route/elevation")
      .send({ coordinates: COORDS });
    expect(second.status).toBe(200);
    expect(second.body).toEqual(first.body);
    expect(fetchSpy.mock.calls.length).toBe(callsAfterFirst);
  });

  it("falls back to the secondary provider when the first fails", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      if (String(url).includes("opentopodata")) {
        return { ok: false, status: 500, text: async () => "boom" } as Response;
      }
      return {
        ok: true,
        json: async () => ({ elevation: [20, 25, 22] }),
      } as Response;
    });

    const res = await request(makeApp())
      .post("/route/elevation")
      .send({ coordinates: COORDS });

    expect(res.status).toBe(200);
    expect(res.body.maxElevationMeters).toBe(25);
  });

  it("returns 502 when all providers fail", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: false,
      status: 503,
      text: async () => "down",
    } as Response);

    const res = await request(makeApp())
      .post("/route/elevation")
      .send({ coordinates: COORDS });

    expect(res.status).toBe(502);
  });

  it("rejects invalid bodies", async () => {
    const app = makeApp();
    const missing = await request(app).post("/route/elevation").send({});
    expect(missing.status).toBe(400);

    const tooFew = await request(app)
      .post("/route/elevation")
      .send({ coordinates: [[5.1, 52.09]] });
    expect(tooFew.status).toBe(400);

    const outOfRange = await request(app)
      .post("/route/elevation")
      .send({ coordinates: [[5.1, 52.09], [500, 52.1]] });
    expect(outOfRange.status).toBe(400);
  });
});

describe("sampleRoute", () => {
  it("keeps small routes intact with cumulative distances", () => {
    const samples = sampleRoute(COORDS);
    expect(samples).toHaveLength(3);
    expect(samples[0].distanceMeters).toBe(0);
    expect(samples[2].distanceMeters).toBeGreaterThan(
      samples[1].distanceMeters,
    );
  });

  it("caps long routes at the sample limit, keeping endpoints", () => {
    const coords: number[][] = [];
    for (let i = 0; i < 2000; i++) {
      coords.push([5.0 + i * 0.0005, 52.0]);
    }
    const samples = sampleRoute(coords);
    expect(samples.length).toBeLessThanOrEqual(201);
    expect(samples[0].lon).toBe(5.0);
    expect(samples[samples.length - 1].lon).toBeCloseTo(
      coords[coords.length - 1][0],
    );
  });
});

describe("computeClimbStats", () => {
  it("ignores sub-threshold noise", () => {
    const { ascentMeters, descentMeters } = computeClimbStats([
      10, 10.5, 10, 10.8, 10.2, 10.6,
    ]);
    expect(ascentMeters).toBe(0);
    expect(descentMeters).toBe(0);
  });

  it("accumulates real climbs and descents", () => {
    const { ascentMeters, descentMeters } = computeClimbStats([
      10, 20, 15, 30, 25,
    ]);
    expect(ascentMeters).toBe(25);
    expect(descentMeters).toBe(10);
  });
});
