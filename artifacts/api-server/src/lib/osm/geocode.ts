import { eq, lt } from "drizzle-orm";
import { db, geocodeCacheTable } from "@workspace/db";
import { logger } from "../logger";

export interface BoundingBox {
  south: number;
  north: number;
  west: number;
  east: number;
}

export interface GeoJsonGeometry {
  type: string;
  coordinates: unknown[];
}

export interface MunicipalityResult {
  id: string;
  name: string;
  displayName: string;
  lat: number;
  lon: number;
  boundingBox: BoundingBox;
  geometry?: GeoJsonGeometry;
}

const NOMINATIM_URL = "https://nominatim.openstreetmap.org/search";
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

interface CacheEntry {
  expires: number;
  value: MunicipalityResult[];
}

const cache = new Map<string, CacheEntry>();

async function readPersistentCache(
  key: string,
  now: number,
): Promise<MunicipalityResult[] | null> {
  try {
    const rows = await db
      .select()
      .from(geocodeCacheTable)
      .where(eq(geocodeCacheTable.key, key))
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    if (row.expiresAt.getTime() <= now) {
      void db
        .delete(geocodeCacheTable)
        .where(eq(geocodeCacheTable.key, key))
        .catch((err) =>
          logger.warn({ err, key }, "Failed to delete expired geocode cache row"),
        );
      return null;
    }
    return row.data as MunicipalityResult[];
  } catch (err) {
    logger.warn({ err, key }, "Persistent geocode cache read failed");
    return null;
  }
}

async function writePersistentCache(
  key: string,
  data: MunicipalityResult[],
  expires: number,
): Promise<void> {
  try {
    const expiresAt = new Date(expires);
    await db
      .insert(geocodeCacheTable)
      .values({ key, data, expiresAt })
      .onConflictDoUpdate({
        target: geocodeCacheTable.key,
        set: { data, expiresAt, createdAt: new Date() },
      });
  } catch (err) {
    logger.warn({ err, key }, "Persistent geocode cache write failed");
  }
}

const SWEEP_INTERVAL_MS = 60 * 60 * 1000;

export async function sweepExpiredGeocodeCache(): Promise<number> {
  try {
    const result = await db
      .delete(geocodeCacheTable)
      .where(lt(geocodeCacheTable.expiresAt, new Date()));
    const removed = result.rowCount ?? 0;
    if (removed > 0) {
      logger.info({ removed }, "Swept expired geocode cache rows");
    } else {
      logger.debug("Geocode cache sweep found no expired rows");
    }
    return removed;
  } catch (err) {
    logger.warn({ err }, "Geocode cache sweep failed");
    return 0;
  }
}

export function startGeocodeCacheSweeper(): NodeJS.Timeout {
  void sweepExpiredGeocodeCache();
  const timer = setInterval(() => {
    void sweepExpiredGeocodeCache();
  }, SWEEP_INTERVAL_MS);
  timer.unref();
  return timer;
}

interface NominatimItem {
  osm_type?: string;
  osm_id?: number;
  place_id?: number;
  lat?: string;
  lon?: string;
  name?: string;
  display_name?: string;
  category?: string;
  type?: string;
  addresstype?: string;
  importance?: number;
  boundingbox?: [string, string, string, string];
  geojson?: { type?: string; coordinates?: unknown };
}

// Matches a leading "Gemeente" / "gem." prefix that users often type but that
// is not part of the OpenStreetMap name (e.g. "Gemeente de Ronde Venen").
const GEMEENTE_PREFIX = /^(gemeente|gem\.?)\s+/i;

function normalizeMunicipalityQuery(query: string): string {
  const cleaned = query.trim().replace(/\s+/g, " ");
  const stripped = cleaned.replace(GEMEENTE_PREFIX, "").trim();
  // Fall back to the original text if stripping leaves too little to search on.
  return stripped.length >= 2 ? stripped : cleaned;
}

// Rank administrative areas (the actual gemeentes) above generic places, and
// both above anything else, then use Nominatim's importance as a tie-breaker.
// This keeps unrelated POIs (churches, graveyards, pharmacies) from crowding
// out or hiding the municipality the user is looking for.
function rankScore(item: NominatimItem): number {
  let base = 0;
  if (item.category === "boundary" && item.type === "administrative") {
    base = 2;
  } else if (item.category === "place") {
    base = 1;
  }
  return base * 1000 + (item.importance ?? 0);
}

function mapItem(item: NominatimItem): MunicipalityResult | null {
  const lat = Number(item.lat);
  const lon = Number(item.lon);
  const bb = item.boundingbox;
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || !bb || bb.length !== 4) {
    return null;
  }
  const south = Number(bb[0]);
  const north = Number(bb[1]);
  const west = Number(bb[2]);
  const east = Number(bb[3]);
  if (![south, north, west, east].every((n) => Number.isFinite(n))) {
    return null;
  }
  const id =
    item.osm_type && item.osm_id != null
      ? `${item.osm_type}/${item.osm_id}`
      : String(item.place_id ?? `${lat},${lon}`);
  const name = item.name && item.name.trim() !== "" ? item.name : item.display_name ?? "";
  const geometry =
    item.geojson &&
    typeof item.geojson.type === "string" &&
    Array.isArray(item.geojson.coordinates)
      ? { type: item.geojson.type, coordinates: item.geojson.coordinates }
      : undefined;
  return {
    id,
    name,
    displayName: item.display_name ?? name,
    lat,
    lon,
    boundingBox: { south, north, west, east },
    ...(geometry ? { geometry } : {}),
  };
}

const MAX_RESULTS = 8;

async function fetchNominatim(
  params: Record<string, string>,
): Promise<NominatimItem[]> {
  const url = new URL(NOMINATIM_URL);
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("countrycodes", "nl,be");
  url.searchParams.set("addressdetails", "0");
  url.searchParams.set("accept-language", "nl");
  // Fetch the administrative boundary polygon so the map can outline the area.
  url.searchParams.set("polygon_geojson", "1");
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }

  const res = await fetch(url, {
    headers: {
      "User-Agent": "Fietsrouteplanner/1.0 (cycling node route planner)",
      Accept: "application/json",
    },
  });

  if (!res.ok) {
    throw new Error(`Nominatim request failed with status ${res.status}`);
  }

  return (await res.json()) as NominatimItem[];
}

function toRankedResults(items: NominatimItem[]): MunicipalityResult[] {
  const ranked = items
    .filter((item) => item.category === "boundary" || item.category === "place")
    .slice()
    .sort((a, b) => rankScore(b) - rankScore(a));

  // Drop duplicates that share a display name (e.g. a "city" and its
  // "city_district" both named "Utrecht"), keeping the highest-ranked one.
  const seen = new Set<string>();
  const results: MunicipalityResult[] = [];
  for (const item of ranked) {
    const mapped = mapItem(item);
    if (!mapped) continue;
    const key = mapped.displayName.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    results.push(mapped);
    if (results.length >= MAX_RESULTS) break;
  }
  return results;
}

// Returns true when a municipality search is already served from cache (memory
// or Postgres) so the warmer can skip it without hitting Nominatim. Mirrors the
// skip behavior of the Overpass region warmer.
export async function isMunicipalityCached(query: string): Promise<boolean> {
  const normalized = normalizeMunicipalityQuery(query);
  const cacheKey = normalized.toLowerCase();
  const now = Date.now();
  const cached = cache.get(cacheKey);
  if (cached && cached.expires > now) {
    return true;
  }

  const persisted = await readPersistentCache(cacheKey, now);
  if (persisted) {
    cache.set(cacheKey, { expires: now + CACHE_TTL_MS, value: persisted });
    return true;
  }

  return false;
}

export async function searchMunicipalities(
  query: string,
): Promise<MunicipalityResult[]> {
  const normalized = normalizeMunicipalityQuery(query);
  const cacheKey = normalized.toLowerCase();
  const now = Date.now();
  const cached = cache.get(cacheKey);
  if (cached && cached.expires > now) {
    return cached.value;
  }

  const persisted = await readPersistentCache(cacheKey, now);
  if (persisted) {
    cache.set(cacheKey, { expires: now + CACHE_TTL_MS, value: persisted });
    return persisted;
  }

  // Structured `city` search reliably returns administrative gemeentes even for
  // partial names (e.g. "Ronde Venen" -> "De Ronde Venen") where free-text
  // search only surfaces unrelated POIs.
  let results = toRankedResults(
    await fetchNominatim({ city: normalized, limit: "15" }),
  );

  // Fall back to a broad free-text search for anything the structured query
  // can't resolve (raise the limit so a boundary isn't pushed off the list).
  if (results.length === 0) {
    results = toRankedResults(
      await fetchNominatim({ q: normalized, limit: "20" }),
    );
  }

  const expires = Date.now() + CACHE_TTL_MS;
  cache.set(cacheKey, { expires, value: results });
  await writePersistentCache(cacheKey, results, expires);
  return results;
}

// Curated list of common Dutch/Belgian municipality names pre-warmed at startup
// so that even the very first search for one of these feels instant, instead of
// waiting on the rate-limited Nominatim service.
export const COMMON_MUNICIPALITIES: string[] = [
  // Netherlands
  "Amsterdam",
  "Rotterdam",
  "Den Haag",
  "Utrecht",
  "Eindhoven",
  "Groningen",
  "Tilburg",
  "Almere",
  "Breda",
  "Nijmegen",
  "Apeldoorn",
  "Haarlem",
  "Arnhem",
  "Enschede",
  "Amersfoort",
  "Den Bosch",
  "Zwolle",
  "Leiden",
  "Maastricht",
  "Dordrecht",
  "Ede",
  "Leeuwarden",
  "Alkmaar",
  "Emmen",
  "Delft",
  "Venlo",
  "Deventer",
  // Belgium (Flanders)
  "Antwerpen",
  "Gent",
  "Brugge",
  "Leuven",
  "Hasselt",
  "Mechelen",
  "Aalst",
  "Kortrijk",
  "Oostende",
  "Genk",
  "Sint-Niklaas",
  "Roeselare",
  "Turnhout",
];

const WARM_STARTUP_DELAY_MS = 8 * 1000;
const WARM_INTERVAL_MS = 12 * 60 * 60 * 1000;
// A single search can fire two Nominatim requests (structured + free-text
// fallback), so we throttle generously between municipalities to stay within
// Nominatim's ~1 request/second usage policy.
const WARM_THROTTLE_MS = 1500;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

let geocodeWarming = false;

export async function warmMunicipalities(): Promise<void> {
  if (geocodeWarming) {
    logger.info("Geocode warming already in progress, skipping this run");
    return;
  }
  geocodeWarming = true;

  let warmed = 0;
  let skipped = 0;
  let failed = 0;

  logger.info(
    { count: COMMON_MUNICIPALITIES.length },
    "Starting geocode warming run",
  );

  try {
    for (const name of COMMON_MUNICIPALITIES) {
      let alreadyCached: boolean;
      try {
        alreadyCached = await isMunicipalityCached(name);
      } catch (err) {
        failed++;
        logger.warn(
          { err, name },
          "Geocode cache lookup failed, skipping municipality",
        );
        continue;
      }

      if (alreadyCached) {
        skipped++;
        continue;
      }

      try {
        await searchMunicipalities(name);
        warmed++;
        logger.info({ name }, "Warmed municipality geocode cache");
      } catch (err) {
        failed++;
        logger.warn(
          { err, name },
          "Failed to warm municipality geocode cache",
        );
      }

      await sleep(WARM_THROTTLE_MS);
    }
  } finally {
    geocodeWarming = false;
  }

  logger.info({ warmed, skipped, failed }, "Geocode warming run complete");
}

export function startGeocodeWarming(): void {
  if (process.env["DISABLE_CACHE_WARMING"] === "true") {
    logger.info("Geocode warming disabled via DISABLE_CACHE_WARMING");
    return;
  }

  setTimeout(() => {
    void warmMunicipalities();
  }, WARM_STARTUP_DELAY_MS);

  setInterval(() => {
    void warmMunicipalities();
  }, WARM_INTERVAL_MS).unref();
}
