import { eq, lt } from "drizzle-orm";
import { db, overpassCacheTable } from "@workspace/db";
import { logger } from "../logger";

export interface Bbox {
  minLon: number;
  minLat: number;
  maxLon: number;
  maxLat: number;
}

export interface OverpassNode {
  id: number;
  lat: number;
  lon: number;
  rcnRef?: string;
}

export interface OverpassWay {
  id: number;
  nodes: number[];
}

export interface OverpassResult {
  nodes: Map<number, OverpassNode>;
  ways: OverpassWay[];
}

interface OverpassElement {
  type: string;
  id: number;
  lat?: number;
  lon?: number;
  nodes?: number[];
  tags?: Record<string, string>;
}

const OVERPASS_ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.openstreetmap.fr/api/interpreter",
  "https://overpass.osm.ch/api/interpreter",
];

const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
// Empty results are suspect: they usually mean Overpass was rate-limited or
// degraded rather than "no cycling network here". Keep them only briefly in
// the in-memory cache and never persist them, so recovery is fast.
const EMPTY_RESULT_TTL_MS = 2 * 60 * 1000;

function isEmptyResult(data: OverpassResult): boolean {
  return data.nodes.size === 0 && data.ways.length === 0;
}

interface CacheEntry {
  data: OverpassResult;
  expires: number;
}

interface SerializedResult {
  nodes: OverpassNode[];
  ways: OverpassWay[];
}

const cache = new Map<string, CacheEntry>();

function cacheKey(b: Bbox): string {
  const r = (n: number) => n.toFixed(3);
  return `${r(b.minLon)},${r(b.minLat)},${r(b.maxLon)},${r(b.maxLat)}`;
}

function serialize(data: OverpassResult): SerializedResult {
  return { nodes: [...data.nodes.values()], ways: data.ways };
}

function deserialize(s: SerializedResult): OverpassResult {
  const nodes = new Map<number, OverpassNode>();
  for (const n of s.nodes) nodes.set(n.id, n);
  return { nodes, ways: s.ways };
}

export async function getPersistentCacheExpiry(
  bbox: Bbox,
): Promise<number | null> {
  const key = cacheKey(bbox);
  const rows = await db
    .select({ expiresAt: overpassCacheTable.expiresAt })
    .from(overpassCacheTable)
    .where(eq(overpassCacheTable.key, key))
    .limit(1);
  const row = rows[0];
  return row ? row.expiresAt.getTime() : null;
}

async function readPersistentCache(
  key: string,
  now: number,
): Promise<OverpassResult | null> {
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
          logger.warn({ err, key }, "Failed to delete expired cache row"),
        );
      return null;
    }
    return deserialize(row.data as SerializedResult);
  } catch (err) {
    logger.warn({ err, key }, "Persistent cache read failed");
    return null;
  }
}

async function writePersistentCache(
  key: string,
  data: OverpassResult,
  expires: number,
): Promise<void> {
  try {
    const serialized = serialize(data);
    const expiresAt = new Date(expires);
    await db
      .insert(overpassCacheTable)
      .values({ key, data: serialized, expiresAt })
      .onConflictDoUpdate({
        target: overpassCacheTable.key,
        set: { data: serialized, expiresAt, createdAt: new Date() },
      });
  } catch (err) {
    logger.warn({ err, key }, "Persistent cache write failed");
  }
}

function buildQuery(b: Bbox): string {
  const area = `${b.minLat},${b.minLon},${b.maxLat},${b.maxLon}`;
  return `[out:json][timeout:30];
(
  node["rcn_ref"](${area});
  relation["network"="rcn"]["route"="bicycle"](${area});
);
(._;>;);
out body;`;
}

const REQUEST_TIMEOUT_MS = 15_000;

async function requestOverpass(query: string): Promise<OverpassElement[]> {
  let lastError: unknown;
  for (const endpoint of OVERPASS_ENDPOINTS) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json",
          "User-Agent": "Fietsrouteplanner/1.0 (cycling node route planner)",
        },
        body: "data=" + encodeURIComponent(query),
        signal: ctrl.signal,
      });
      clearTimeout(timer);
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        lastError = new Error(
          `Overpass ${endpoint} returned ${res.status}: ${text.slice(0, 200)}`,
        );
        continue;
      }
      const json = (await res.json()) as { elements?: OverpassElement[] };
      return json.elements ?? [];
    } catch (err) {
      clearTimeout(timer);
      lastError = err;
      logger.warn({ err, endpoint }, "Overpass endpoint failed, trying next");
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error("All Overpass endpoints failed");
}

function parseElements(elements: OverpassElement[]): OverpassResult {
  const nodes = new Map<number, OverpassNode>();
  const ways: OverpassWay[] = [];
  for (const el of elements) {
    if (el.type === "node" && el.lat != null && el.lon != null) {
      const existing = nodes.get(el.id);
      const rcnRef = el.tags?.["rcn_ref"] ?? existing?.rcnRef;
      nodes.set(el.id, { id: el.id, lat: el.lat, lon: el.lon, rcnRef });
    } else if (el.type === "way" && Array.isArray(el.nodes)) {
      ways.push({ id: el.id, nodes: el.nodes });
    }
  }
  return { nodes, ways };
}

// Run the network Overpass query for a bbox and parse it, bypassing all caching.
// Used by the full-region dataset importer, which persists results in its own
// tables rather than in the short-lived per-tile cache.
export async function fetchOverpassUncached(bbox: Bbox): Promise<OverpassResult> {
  const elements = await requestOverpass(buildQuery(bbox));
  return parseElements(elements);
}

export interface FetchOverpassOptions {
  forceRefresh?: boolean;
}

export async function fetchOverpass(
  bbox: Bbox,
  options: FetchOverpassOptions = {},
): Promise<OverpassResult> {
  const key = cacheKey(bbox);
  const now = Date.now();

  if (!options.forceRefresh) {
    const cached = cache.get(key);
    if (cached && cached.expires > now) {
      return cached.data;
    }

    const persisted = await readPersistentCache(key, now);
    if (persisted) {
      cache.set(key, { data: persisted, expires: now + CACHE_TTL_MS });
      return persisted;
    }
  }

  const data = parseElements(await requestOverpass(buildQuery(bbox)));
  if (isEmptyResult(data)) {
    cache.set(key, { data, expires: now + EMPTY_RESULT_TTL_MS });
    return data;
  }
  const expires = now + CACHE_TTL_MS;
  cache.set(key, { data, expires });
  await writePersistentCache(key, data, expires);
  return data;
}

const SWEEP_INTERVAL_MS = 60 * 60 * 1000;

export async function sweepExpiredCache(): Promise<number> {
  try {
    const result = await db
      .delete(overpassCacheTable)
      .where(lt(overpassCacheTable.expiresAt, new Date()));
    const removed = result.rowCount ?? 0;
    if (removed > 0) {
      logger.info({ removed }, "Swept expired overpass cache rows");
    } else {
      logger.debug("Overpass cache sweep found no expired rows");
    }
    return removed;
  } catch (err) {
    logger.warn({ err }, "Overpass cache sweep failed");
    return 0;
  }
}

export function startCacheSweeper(): NodeJS.Timeout {
  void sweepExpiredCache();
  const timer = setInterval(() => {
    void sweepExpiredCache();
  }, SWEEP_INTERVAL_MS);
  timer.unref();
  return timer;
}

export const TILE_SIZE_DEG = 0.1;

function tileBbox(ix: number, iy: number): Bbox {
  const round = (n: number) => Number(n.toFixed(3));
  return {
    minLon: round(ix * TILE_SIZE_DEG),
    minLat: round(iy * TILE_SIZE_DEG),
    maxLon: round((ix + 1) * TILE_SIZE_DEG),
    maxLat: round((iy + 1) * TILE_SIZE_DEG),
  };
}

export function getTilesForBbox(bbox: Bbox): Bbox[] {
  const eps = 1e-9;
  const ixMin = Math.floor(bbox.minLon / TILE_SIZE_DEG);
  const ixMax = Math.floor((bbox.maxLon - eps) / TILE_SIZE_DEG);
  const iyMin = Math.floor(bbox.minLat / TILE_SIZE_DEG);
  const iyMax = Math.floor((bbox.maxLat - eps) / TILE_SIZE_DEG);
  const tiles: Bbox[] = [];
  for (let ix = ixMin; ix <= ixMax; ix++) {
    for (let iy = iyMin; iy <= iyMax; iy++) {
      tiles.push(tileBbox(ix, iy));
    }
  }
  return tiles;
}

const TILE_FETCH_CONCURRENCY = 5;

export async function fetchOverpassTiles(
  bbox: Bbox,
  options: FetchOverpassOptions = {},
): Promise<OverpassResult> {
  const tiles = getTilesForBbox(bbox);

  // Fetch tiles concurrently (bounded) so multi-tile viewports don't wait on
  // one Overpass round-trip at a time. Results are merged back in tile order
  // to keep node/way de-duplication deterministic.
  const results: OverpassResult[] = new Array(tiles.length);
  let next = 0;
  async function worker(): Promise<void> {
    while (true) {
      const index = next++;
      if (index >= tiles.length) return;
      results[index] = await fetchOverpass(tiles[index], options);
    }
  }
  const workerCount = Math.min(TILE_FETCH_CONCURRENCY, tiles.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));

  const nodes = new Map<number, OverpassNode>();
  const ways: OverpassWay[] = [];
  const seenWays = new Set<number>();

  for (const result of results) {
    for (const [id, node] of result.nodes) {
      if (!nodes.has(id)) nodes.set(id, node);
    }
    for (const way of result.ways) {
      if (!seenWays.has(way.id)) {
        seenWays.add(way.id);
        ways.push(way);
      }
    }
  }

  return { nodes, ways };
}

export function haversineMeters(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}
