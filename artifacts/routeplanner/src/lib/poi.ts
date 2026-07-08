import type { Poi } from "@workspace/api-client-react";

export const POI_CATEGORIES = [
  "cafe",
  "bike_shop",
  "sights",
  "ferry",
  "toilets",
] as const;

export type PoiCategory = (typeof POI_CATEGORIES)[number];

// Marker colour per category, used by the map's circle layer and the menu.
export const POI_COLORS: Record<PoiCategory, string> = {
  cafe: "#b45309",
  bike_shop: "#0e7490",
  sights: "#7c3aed",
  ferry: "#1d4ed8",
  toilets: "#475569",
};

// Width of the corridor around the planned route, in meters, for the
// "only along my route" filter. Roughly a short detour by bike.
export const ROUTE_CORRIDOR_METERS = 500;

function haversineMeters(
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

// Keep only POIs within `corridorMeters` of the route line. The route
// geometry is decimated to roughly corridor-sized steps first so dense
// GPX-grade geometry doesn't make this O(pois × every-vertex).
export function filterPoisAlongRoute(
  pois: Poi[],
  routeCoordinates: number[][],
  corridorMeters: number = ROUTE_CORRIDOR_METERS,
): Poi[] {
  if (routeCoordinates.length === 0) return [];

  const samples: number[][] = [];
  let last: number[] | null = null;
  for (const coord of routeCoordinates) {
    if (
      !last ||
      haversineMeters(last[1], last[0], coord[1], coord[0]) >=
        corridorMeters / 2
    ) {
      samples.push(coord);
      last = coord;
    }
  }
  const tail = routeCoordinates[routeCoordinates.length - 1];
  if (samples[samples.length - 1] !== tail) samples.push(tail);

  // Sampling the line every corridor/2 meters means a POI within the corridor
  // of the true line is within corridor + corridor/4 of some sample; use that
  // slack so corner cutting doesn't drop valid POIs.
  const threshold = corridorMeters + corridorMeters / 4;
  return pois.filter((poi) =>
    samples.some(
      ([lon, lat]) => haversineMeters(poi.lat, poi.lon, lat, lon) <= threshold,
    ),
  );
}
