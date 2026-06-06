import { eq } from "drizzle-orm";
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
];

const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

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
  return `[out:json][timeout:90];
(
  node["rcn_ref"](${area});
  relation["network"="rcn"]["route"="bicycle"](${area});
);
(._;>;);
out body;`;
}

async function requestOverpass(query: string): Promise<OverpassElement[]> {
  let lastError: unknown;
  for (const endpoint of OVERPASS_ENDPOINTS) {
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json",
          "User-Agent": "Fietsrouteplanner/1.0 (cycling node route planner)",
        },
        body: "data=" + encodeURIComponent(query),
      });
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
      lastError = err;
      logger.warn({ err, endpoint }, "Overpass endpoint failed, trying next");
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error("All Overpass endpoints failed");
}

export async function fetchOverpass(bbox: Bbox): Promise<OverpassResult> {
  const key = cacheKey(bbox);
  const now = Date.now();

  const cached = cache.get(key);
  if (cached && cached.expires > now) {
    return cached.data;
  }

  const persisted = await readPersistentCache(key, now);
  if (persisted) {
    cache.set(key, { data: persisted, expires: now + CACHE_TTL_MS });
    return persisted;
  }

  const elements = await requestOverpass(buildQuery(bbox));

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

  const data: OverpassResult = { nodes, ways };
  const expires = now + CACHE_TTL_MS;
  cache.set(key, { data, expires });
  await writePersistentCache(key, data, expires);
  return data;
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
