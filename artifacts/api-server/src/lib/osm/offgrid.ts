import { eq } from "drizzle-orm";
import { db, overpassCacheTable } from "@workspace/db";
import { logger } from "../logger";

// Offgrid routing between arbitrary coordinates over cycle-friendly OSM ways.
// Instead of building a full OSM routing graph in-house, legs are routed via
// the public FOSSGIS OSRM bike instances (the OSM community's demo routers).
// Results are cached persistently (shared overpass_cache table, own "osrm:"
// key prefix) so repeated planning of the same leg never re-hits the router.

export interface OffgridLegResult {
  coordinates: number[][]; // [lon, lat]
  distanceMeters: number;
}

export class OffgridRoutingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OffgridRoutingError";
  }
}

export class OffgridNoPathError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OffgridNoPathError";
  }
}

const OSRM_ENDPOINTS = [
  "https://routing.openstreetmap.de/routed-bike/route/v1/bike",
];

const REQUEST_TIMEOUT_MS = 20_000;
const REQUEST_ATTEMPTS = 2;
const RETRY_BACKOFF_MS = 2_000;
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const CACHE_PREFIX = "osrm:";

// In-memory L1 in front of the persistent cache, mirroring fetchOverpass.
const memCache = new Map<string, { data: OffgridLegResult; expires: number }>();

// Public OSRM instances allow very little concurrency per IP; funnel all
// requests through a single in-flight slot like the Overpass client does.
let slot: Promise<void> = Promise.resolve();
function withSlot<T>(fn: () => Promise<T>): Promise<T> {
  const run = slot.then(fn);
  slot = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

function sleepMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function cacheKey(
  fromLat: number,
  fromLon: number,
  toLat: number,
  toLon: number,
): string {
  const r = (n: number) => n.toFixed(5);
  return `${CACHE_PREFIX}${r(fromLon)},${r(fromLat)};${r(toLon)},${r(toLat)}`;
}

async function readPersistent(
  key: string,
  now: number,
): Promise<OffgridLegResult | null> {
  try {
    const rows = await db
      .select()
      .from(overpassCacheTable)
      .where(eq(overpassCacheTable.key, key))
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    if (row.expiresAt.getTime() <= now) {
      void db
        .delete(overpassCacheTable)
        .where(eq(overpassCacheTable.key, key))
        .catch((err) =>
          logger.warn({ err, key }, "Failed to delete expired osrm cache row"),
        );
      return null;
    }
    const data = row.data as OffgridLegResult;
    if (!Array.isArray(data.coordinates) || data.coordinates.length < 2) {
      return null;
    }
    return data;
  } catch (err) {
    logger.warn({ err, key }, "Offgrid cache read failed");
    return null;
  }
}

async function writePersistent(
  key: string,
  data: OffgridLegResult,
  expires: number,
): Promise<void> {
  try {
    const expiresAt = new Date(expires);
    await db
      .insert(overpassCacheTable)
      .values({ key, data, expiresAt })
      .onConflictDoUpdate({
        target: overpassCacheTable.key,
        set: { data, expiresAt, createdAt: new Date() },
      });
  } catch (err) {
    logger.warn({ err, key }, "Offgrid cache write failed");
  }
}

interface OsrmResponse {
  code?: string;
  routes?: Array<{
    distance?: number;
    geometry?: { coordinates?: number[][] };
  }>;
}

async function requestOsrmOnce(
  fromLat: number,
  fromLon: number,
  toLat: number,
  toLon: number,
): Promise<OffgridLegResult> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= REQUEST_ATTEMPTS; attempt++) {
    for (const endpoint of OSRM_ENDPOINTS) {
      const url = `${endpoint}/${fromLon},${fromLat};${toLon},${toLat}?overview=full&geometries=geojson&steps=false`;
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
      try {
        const res = await fetch(url, {
          headers: {
            Accept: "application/json",
            "User-Agent":
              "Fietsrouteplanner/1.0 (cycling node route planner; offgrid legs)",
          },
          signal: ctrl.signal,
        });
        clearTimeout(timer);
        if (res.status === 400) {
          // OSRM uses 400 with code "NoRoute"/"NoSegment" for unroutable
          // coordinates — that's a user-facing "no path", not a server error.
          const json = (await res.json().catch(() => null)) as OsrmResponse | null;
          if (json?.code === "NoRoute" || json?.code === "NoSegment") {
            throw new OffgridNoPathError(
              "No bikeable path found between these points.",
            );
          }
          lastError = new Error(`OSRM returned 400: ${json?.code ?? "unknown"}`);
          continue;
        }
        if (!res.ok) {
          const text = await res.text().catch(() => "");
          lastError = new Error(
            `OSRM ${endpoint} returned ${res.status}: ${text.slice(0, 200)}`,
          );
          logger.warn(
            { endpoint, status: res.status, attempt },
            "OSRM endpoint returned error status",
          );
          continue;
        }
        const json = (await res.json()) as OsrmResponse;
        const route = json.routes?.[0];
        const coords = route?.geometry?.coordinates;
        if (json.code !== "Ok" || !route || !coords || coords.length < 2) {
          if (json.code === "NoRoute" || json.code === "NoSegment") {
            throw new OffgridNoPathError(
              "No bikeable path found between these points.",
            );
          }
          lastError = new Error(`OSRM returned unusable response (${json.code})`);
          continue;
        }
        return {
          coordinates: coords,
          distanceMeters: Math.round(route.distance ?? 0),
        };
      } catch (err) {
        clearTimeout(timer);
        if (err instanceof OffgridNoPathError) throw err;
        lastError = err;
        logger.warn({ err, endpoint, attempt }, "OSRM request failed");
      }
    }
    if (attempt < REQUEST_ATTEMPTS) {
      await sleepMs(RETRY_BACKOFF_MS * attempt);
    }
  }
  throw new OffgridRoutingError(
    lastError instanceof Error
      ? `Offgrid routing failed: ${lastError.message}`
      : "Offgrid routing failed",
  );
}

export async function routeOffgridLeg(
  fromLat: number,
  fromLon: number,
  toLat: number,
  toLon: number,
): Promise<OffgridLegResult> {
  const key = cacheKey(fromLat, fromLon, toLat, toLon);
  const now = Date.now();

  const cached = memCache.get(key);
  if (cached && cached.expires > now) return cached.data;

  const persisted = await readPersistent(key, now);
  if (persisted) {
    memCache.set(key, { data: persisted, expires: now + CACHE_TTL_MS });
    return persisted;
  }

  const data = await withSlot(() =>
    requestOsrmOnce(fromLat, fromLon, toLat, toLon),
  );
  const expires = now + CACHE_TTL_MS;
  memCache.set(key, { data, expires });
  await writePersistent(key, data, expires);
  return data;
}
