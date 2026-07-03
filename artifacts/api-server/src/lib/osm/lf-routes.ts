import { eq } from "drizzle-orm";
import { db, overpassCacheTable } from "@workspace/db";
import { requestOverpass, type Bbox, type OverpassElement } from "./overpass";
import { logger } from "../logger";

export interface LfRoute {
  id: string;
  name?: string;
  ref?: string;
  lines: number[][][];
}

export interface LfRoutesData {
  routes: LfRoute[];
  truncated: boolean;
}

// LF routes are long-distance and sparse compared to the knooppunten network,
// so a considerably larger viewport is still cheap to query and cache. Beyond
// this the response is flagged truncated and left empty, mirroring /network.
const MAX_AREA_DEG2 = 4;

const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

// LF-route results share the overpass_cache table with the knooppunten tiles
// but use a distinct key prefix, since the same bbox holds different data for
// the two query kinds.
function cacheKey(b: Bbox): string {
  const r = (n: number) => n.toFixed(3);
  return `lf:${r(b.minLon)},${r(b.minLat)},${r(b.maxLon)},${r(b.maxLat)}`;
}

interface CacheEntry {
  data: LfRoutesData;
  expires: number;
}

const memoryCache = new Map<string, CacheEntry>();

function buildQuery(b: Bbox): string {
  const area = `${b.minLat},${b.minLon},${b.maxLat},${b.maxLon}`;
  // `out geom(...)` returns each relation's way members with their node
  // coordinates inlined, clipped to the bbox, so no second lookup is needed.
  return `[out:json][timeout:30];
relation["network"="ncn"]["route"="bicycle"](${area});
out geom(${area});`;
}

function parseElements(elements: OverpassElement[]): LfRoute[] {
  const routes: LfRoute[] = [];
  for (const el of elements) {
    if (el.type !== "relation" || !Array.isArray(el.members)) continue;
    const lines: number[][][] = [];
    for (const member of el.members) {
      if (member.type !== "way" || !Array.isArray(member.geometry)) continue;
      const coords = member.geometry
        .filter((p) => p && Number.isFinite(p.lon) && Number.isFinite(p.lat))
        .map((p) => [p.lon, p.lat]);
      if (coords.length >= 2) lines.push(coords);
    }
    if (lines.length === 0) continue;
    routes.push({
      id: String(el.id),
      name: el.tags?.["name"],
      ref: el.tags?.["ref"],
      lines,
    });
  }
  return routes;
}

async function readPersistentCache(
  key: string,
  now: number,
): Promise<LfRoutesData | null> {
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
          logger.warn({ err, key }, "Failed to delete expired LF cache row"),
        );
      return null;
    }
    return row.data as LfRoutesData;
  } catch (err) {
    logger.warn({ err, key }, "LF routes persistent cache read failed");
    return null;
  }
}

async function writePersistentCache(
  key: string,
  data: LfRoutesData,
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
    logger.warn({ err, key }, "LF routes persistent cache write failed");
  }
}

export async function getLfRoutesData(bbox: Bbox): Promise<LfRoutesData> {
  const area =
    Math.abs(bbox.maxLon - bbox.minLon) * Math.abs(bbox.maxLat - bbox.minLat);
  if (area > MAX_AREA_DEG2) {
    return { routes: [], truncated: true };
  }

  const key = cacheKey(bbox);
  const now = Date.now();

  const cached = memoryCache.get(key);
  if (cached && cached.expires > now) {
    return cached.data;
  }

  const persisted = await readPersistentCache(key, now);
  if (persisted) {
    memoryCache.set(key, { data: persisted, expires: now + CACHE_TTL_MS });
    return persisted;
  }

  const elements = await requestOverpass(buildQuery(bbox));
  const data: LfRoutesData = { routes: parseElements(elements), truncated: false };
  const expires = now + CACHE_TTL_MS;
  memoryCache.set(key, { data, expires });
  await writePersistentCache(key, data, expires);
  return data;
}
