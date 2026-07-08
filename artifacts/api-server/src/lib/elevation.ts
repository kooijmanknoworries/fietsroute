import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { db, elevationCacheTable } from "@workspace/db";
import { logger } from "./logger";
import { haversineMeters } from "./osm/overpass";

export interface ElevationPoint {
  distanceMeters: number;
  elevationMeters: number;
}

export interface ElevationProfile {
  points: ElevationPoint[];
  ascentMeters: number;
  descentMeters: number;
  minElevationMeters: number;
  maxElevationMeters: number;
  totalDistanceMeters: number;
}

export class ElevationRequestError extends Error {}
export class ElevationUpstreamError extends Error {}

// Maximum number of sampled points along a route. Keeps upstream requests
// small (providers cap batches at ~100 locations) while still giving a smooth
// chart for long routes.
const MAX_SAMPLE_POINTS = 200;

// Providers cap the number of locations per request.
const BATCH_SIZE = 100;

// Elevation data is effectively static; cache resolved profiles for a long
// time, mirroring the overpass_cache pattern.
const CACHE_TTL_MS = 180 * 24 * 60 * 60 * 1000;

const USER_AGENT = "Fietsrouteplanner/1.0 (cycling node route planner)";
const REQUEST_TIMEOUT_MS = 15_000;

// Free elevation services allow roughly 1 request per second. All upstream
// requests are funneled through a single slot with spacing between calls.
const MIN_REQUEST_SPACING_MS = 1_100;
let elevationSlot: Promise<void> = Promise.resolve();
let lastRequestAt = 0;

function withElevationSlot<T>(fn: () => Promise<T>): Promise<T> {
  const run = elevationSlot.then(async () => {
    const wait = lastRequestAt + MIN_REQUEST_SPACING_MS - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    try {
      return await fn();
    } finally {
      lastRequestAt = Date.now();
    }
  });
  elevationSlot = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

interface SamplePoint {
  lat: number;
  lon: number;
  distanceMeters: number;
}

// Walk the geometry and pick evenly spaced points (by distance), always
// keeping the first and last coordinate.
export function sampleRoute(coordinates: number[][]): SamplePoint[] {
  const pts: SamplePoint[] = [];
  let cumulative = 0;
  for (let i = 0; i < coordinates.length; i++) {
    const [lon, lat] = coordinates[i];
    if (i > 0) {
      const [plon, plat] = coordinates[i - 1];
      cumulative += haversineMeters(plat, plon, lat, lon);
    }
    pts.push({ lat, lon, distanceMeters: cumulative });
  }
  if (pts.length <= MAX_SAMPLE_POINTS) return pts;

  const total = cumulative;
  const step = total / (MAX_SAMPLE_POINTS - 1);
  const sampled: SamplePoint[] = [pts[0]];
  let target = step;
  for (let i = 1; i < pts.length - 1; i++) {
    if (pts[i].distanceMeters >= target) {
      sampled.push(pts[i]);
      target = pts[i].distanceMeters + step;
    }
  }
  sampled.push(pts[pts.length - 1]);
  return sampled;
}

// Total ascent/descent with a small hysteresis threshold so meter-level noise
// in the elevation data doesn't inflate the climb totals.
const CLIMB_THRESHOLD_M = 2;

export function computeClimbStats(elevations: number[]): {
  ascentMeters: number;
  descentMeters: number;
} {
  let ascent = 0;
  let descent = 0;
  let ref = elevations.length ? elevations[0] : 0;
  for (let i = 1; i < elevations.length; i++) {
    const delta = elevations[i] - ref;
    if (delta >= CLIMB_THRESHOLD_M) {
      ascent += delta;
      ref = elevations[i];
    } else if (delta <= -CLIMB_THRESHOLD_M) {
      descent += -delta;
      ref = elevations[i];
    }
  }
  return {
    ascentMeters: Math.round(ascent),
    descentMeters: Math.round(descent),
  };
}

function cacheKey(samples: SamplePoint[]): string {
  const raw = samples
    .map((s) => `${s.lat.toFixed(5)},${s.lon.toFixed(5)}`)
    .join("|");
  return "elev:" + createHash("sha256").update(raw).digest("hex");
}

async function readCache(key: string): Promise<ElevationProfile | null> {
  try {
    const rows = await db
      .select()
      .from(elevationCacheTable)
      .where(eq(elevationCacheTable.key, key))
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    if (row.expiresAt.getTime() <= Date.now()) {
      void db
        .delete(elevationCacheTable)
        .where(eq(elevationCacheTable.key, key))
        .catch((err) =>
          logger.warn({ err, key }, "Failed to delete expired elevation row"),
        );
      return null;
    }
    return row.data as ElevationProfile;
  } catch (err) {
    logger.warn({ err, key }, "Elevation cache read failed");
    return null;
  }
}

async function writeCache(key: string, data: ElevationProfile): Promise<void> {
  try {
    const expiresAt = new Date(Date.now() + CACHE_TTL_MS);
    await db
      .insert(elevationCacheTable)
      .values({ key, data, expiresAt })
      .onConflictDoUpdate({
        target: elevationCacheTable.key,
        set: { data, expiresAt, createdAt: new Date() },
      });
  } catch (err) {
    logger.warn({ err, key }, "Elevation cache write failed");
  }
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

// Primary provider: Open Topo Data (EU-DEM covers NL/BE at 25m resolution).
async function fetchOpenTopoData(batch: SamplePoint[]): Promise<number[]> {
  const locations = batch.map((p) => `${p.lat},${p.lon}`).join("|");
  const res = await fetchWithTimeout(
    "https://api.opentopodata.org/v1/eudem25m",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
        "User-Agent": USER_AGENT,
      },
      body: "locations=" + encodeURIComponent(locations),
    },
  );
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Open Topo Data returned ${res.status}: ${text.slice(0, 200)}`);
  }
  const json = (await res.json()) as {
    results?: Array<{ elevation: number | null }>;
  };
  const results = json.results ?? [];
  if (results.length !== batch.length) {
    throw new Error("Open Topo Data returned unexpected result count");
  }
  return results.map((r) => r.elevation ?? 0);
}

// Fallback provider: Open-Meteo elevation API (90m resolution, no key).
async function fetchOpenMeteo(batch: SamplePoint[]): Promise<number[]> {
  const lat = batch.map((p) => p.lat.toFixed(5)).join(",");
  const lon = batch.map((p) => p.lon.toFixed(5)).join(",");
  const res = await fetchWithTimeout(
    `https://api.open-meteo.com/v1/elevation?latitude=${lat}&longitude=${lon}`,
    {
      headers: { Accept: "application/json", "User-Agent": USER_AGENT },
    },
  );
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Open-Meteo returned ${res.status}: ${text.slice(0, 200)}`);
  }
  const json = (await res.json()) as { elevation?: number[] };
  const elev = json.elevation ?? [];
  if (elev.length !== batch.length) {
    throw new Error("Open-Meteo returned unexpected result count");
  }
  return elev;
}

async function fetchElevationsBatch(batch: SamplePoint[]): Promise<number[]> {
  return withElevationSlot(async () => {
    try {
      return await fetchOpenTopoData(batch);
    } catch (err) {
      logger.warn({ err }, "Open Topo Data failed, falling back to Open-Meteo");
      return fetchOpenMeteo(batch);
    }
  });
}

export async function getElevationProfile(
  coordinates: number[][],
): Promise<ElevationProfile> {
  if (
    !Array.isArray(coordinates) ||
    coordinates.length < 2 ||
    coordinates.some(
      (c) =>
        !Array.isArray(c) ||
        c.length < 2 ||
        !Number.isFinite(c[0]) ||
        !Number.isFinite(c[1]) ||
        c[0] < -180 ||
        c[0] > 180 ||
        c[1] < -90 ||
        c[1] > 90,
    )
  ) {
    throw new ElevationRequestError(
      "Route geometry must be at least two [lon, lat] pairs",
    );
  }

  const samples = sampleRoute(coordinates);
  const key = cacheKey(samples);

  const cached = await readCache(key);
  if (cached) return cached;

  const elevations: number[] = [];
  for (let i = 0; i < samples.length; i += BATCH_SIZE) {
    const batch = samples.slice(i, i + BATCH_SIZE);
    try {
      elevations.push(...(await fetchElevationsBatch(batch)));
    } catch (err) {
      logger.warn({ err }, "All elevation providers failed");
      throw new ElevationUpstreamError("Could not load elevation data");
    }
  }

  const points: ElevationPoint[] = samples.map((s, i) => ({
    distanceMeters: Math.round(s.distanceMeters),
    elevationMeters: Math.round(elevations[i] * 10) / 10,
  }));
  const { ascentMeters, descentMeters } = computeClimbStats(elevations);
  const profile: ElevationProfile = {
    points,
    ascentMeters,
    descentMeters,
    minElevationMeters: Math.round(Math.min(...elevations) * 10) / 10,
    maxElevationMeters: Math.round(Math.max(...elevations) * 10) / 10,
    totalDistanceMeters: Math.round(
      samples[samples.length - 1].distanceMeters,
    ),
  };

  await writeCache(key, profile);
  return profile;
}
