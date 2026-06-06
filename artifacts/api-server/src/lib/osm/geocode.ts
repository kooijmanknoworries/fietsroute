export interface BoundingBox {
  south: number;
  north: number;
  west: number;
  east: number;
}

export interface MunicipalityResult {
  id: string;
  name: string;
  displayName: string;
  lat: number;
  lon: number;
  boundingBox: BoundingBox;
}

const NOMINATIM_URL = "https://nominatim.openstreetmap.org/search";
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

interface CacheEntry {
  expires: number;
  value: MunicipalityResult[];
}

const cache = new Map<string, CacheEntry>();

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
  boundingbox?: [string, string, string, string];
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
  return {
    id,
    name,
    displayName: item.display_name ?? name,
    lat,
    lon,
    boundingBox: { south, north, west, east },
  };
}

export async function searchMunicipalities(
  query: string,
): Promise<MunicipalityResult[]> {
  const normalized = query.trim().toLowerCase();
  const cached = cache.get(normalized);
  if (cached && cached.expires > Date.now()) {
    return cached.value;
  }

  const url = new URL(NOMINATIM_URL);
  url.searchParams.set("q", query.trim());
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("countrycodes", "nl,be");
  url.searchParams.set("limit", "8");
  url.searchParams.set("addressdetails", "0");
  url.searchParams.set("accept-language", "nl");

  const res = await fetch(url, {
    headers: {
      "User-Agent": "Fietsrouteplanner/1.0 (cycling node route planner)",
      Accept: "application/json",
    },
  });

  if (!res.ok) {
    throw new Error(`Nominatim request failed with status ${res.status}`);
  }

  const data = (await res.json()) as NominatimItem[];
  const results = data
    .filter((item) => item.category === "boundary" || item.category === "place")
    .map(mapItem)
    .filter((r): r is MunicipalityResult => r !== null);

  cache.set(normalized, { expires: Date.now() + CACHE_TTL_MS, value: results });
  return results;
}
