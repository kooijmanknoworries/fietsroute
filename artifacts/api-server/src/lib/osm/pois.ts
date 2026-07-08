import { eq } from "drizzle-orm";
import { db, overpassCacheTable } from "@workspace/db";
import { logger } from "../logger";
import { requestOverpass, type Bbox, type OverpassElement } from "./overpass";

export const POI_CATEGORIES = [
  "cafe",
  "bike_shop",
  "sights",
  "ferry",
  "toilets",
] as const;

export type PoiCategory = (typeof POI_CATEGORIES)[number];

export interface Poi {
  id: string;
  name: string | null;
  category: PoiCategory;
  lat: number;
  lon: number;
}

export interface PoiData {
  pois: Poi[];
  truncated: boolean;
}

export function isPoiCategory(value: string): value is PoiCategory {
  return (POI_CATEGORIES as readonly string[]).includes(value);
}

// Guard against huge viewports: beyond this the query would be slow and the
// markers useless clutter, so we return an empty, truncated result instead of
// hammering Overpass.
export const MAX_POI_BBOX_DEG = 1.0;

// Cap per category per bbox so one dense city can't produce megabyte payloads.
const MAX_POIS_PER_CATEGORY = 400;

// Overpass selectors per category. Each entry is the tag filter applied to
// both nodes and ways (ways are resolved with "out center").
const CATEGORY_SELECTORS: Record<PoiCategory, string[]> = {
  cafe: ['["amenity"~"^(cafe|restaurant)$"]'],
  bike_shop: ['["shop"="bicycle"]', '["amenity"="bicycle_repair_station"]'],
  sights: [
    '["tourism"~"^(attraction|viewpoint|museum)$"]',
    '["historic"~"^(castle|monument|windmill|fort)$"]',
  ],
  ferry: ['["amenity"="ferry_terminal"]'],
  toilets: ['["amenity"="toilets"]'],
};

const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
// Empty results may be genuine (rural tiles) but can also come from an
// Overpass hiccup; keep them only briefly and only in memory.
const EMPTY_CACHE_TTL_MS = 5 * 60 * 1000;

interface MemEntry {
  pois: Poi[];
  expires: number;
}

const memCache = new Map<string, MemEntry>();

// Cached in the shared overpass_cache table; the "poi:" prefix keeps these
// rows separate from the network tiles and the "lf:" overlay rows.
function poiCacheKey(category: PoiCategory, b: Bbox): string {
  const r = (n: number) => n.toFixed(3);
  return `poi:${category}:${r(b.minLon)},${r(b.minLat)},${r(b.maxLon)},${r(b.maxLat)}`;
}

function buildPoiQuery(category: PoiCategory, b: Bbox): string {
  const area = `${b.minLat},${b.minLon},${b.maxLat},${b.maxLon}`;
  const clauses = CATEGORY_SELECTORS[category]
    .flatMap((sel) => [`  node${sel}(${area});`, `  way${sel}(${area});`])
    .join("\n");
  return `[out:json][timeout:25];
(
${clauses}
);
out center ${MAX_POIS_PER_CATEGORY};`;
}

function parsePois(elements: OverpassElement[], category: PoiCategory): Poi[] {
  const pois: Poi[] = [];
  for (const el of elements) {
    const center =
      el.type === "node"
        ? { lat: el.lat, lon: el.lon }
        : (el as { center?: { lat: number; lon: number } }).center;
    if (!center || center.lat == null || center.lon == null) continue;
    pois.push({
      id: `${el.type}/${el.id}`,
      name: el.tags?.["name"] ?? null,
      category,
      lat: center.lat,
      lon: center.lon,
    });
  }
  return pois;
}

async function readPoiCache(key: string, now: number): Promise<Poi[] | null> {
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
          logger.warn({ err, key }, "Failed to delete expired poi cache row"),
        );
      return null;
    }
    const data = row.data as { pois?: Poi[] };
    return Array.isArray(data.pois) ? data.pois : null;
  } catch (err) {
    logger.warn({ err, key }, "POI cache read failed");
    return null;
  }
}

async function writePoiCache(
  key: string,
  pois: Poi[],
  expires: number,
): Promise<void> {
  try {
    const expiresAt = new Date(expires);
    await db
      .insert(overpassCacheTable)
      .values({ key, data: { pois }, expiresAt })
      .onConflictDoUpdate({
        target: overpassCacheTable.key,
        set: { data: { pois }, expiresAt, createdAt: new Date() },
      });
  } catch (err) {
    logger.warn({ err, key }, "POI cache write failed");
  }
}

async function fetchCategory(category: PoiCategory, bbox: Bbox): Promise<Poi[]> {
  const key = poiCacheKey(category, bbox);
  const now = Date.now();

  const cached = memCache.get(key);
  if (cached && cached.expires > now) return cached.pois;

  const persisted = await readPoiCache(key, now);
  if (persisted) {
    memCache.set(key, { pois: persisted, expires: now + CACHE_TTL_MS });
    return persisted;
  }

  const elements = await requestOverpass(buildPoiQuery(category, bbox));
  const pois = parsePois(elements, category);
  if (pois.length === 0) {
    memCache.set(key, { pois, expires: now + EMPTY_CACHE_TTL_MS });
    return pois;
  }
  const expires = now + CACHE_TTL_MS;
  memCache.set(key, { pois, expires });
  await writePoiCache(key, pois, expires);
  return pois;
}

export async function getPois(
  bbox: Bbox,
  categories: PoiCategory[],
): Promise<PoiData> {
  if (
    bbox.maxLon - bbox.minLon > MAX_POI_BBOX_DEG ||
    bbox.maxLat - bbox.minLat > MAX_POI_BBOX_DEG
  ) {
    return { pois: [], truncated: true };
  }

  const unique = [...new Set(categories)];
  const results = await Promise.all(
    unique.map((category) => fetchCategory(category, bbox)),
  );
  const pois = results.flat();
  const truncated = results.some((r) => r.length >= MAX_POIS_PER_CATEGORY);
  return { pois, truncated };
}

// Test hook: clear the in-memory layer so tests can control cache behaviour.
export function clearPoiMemCache(): void {
  memCache.clear();
}
