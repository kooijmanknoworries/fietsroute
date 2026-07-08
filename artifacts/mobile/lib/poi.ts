import type { Poi } from "@workspace/api-client-react";
import type { Ionicons } from "@expo/vector-icons";

export const POI_CATEGORIES = [
  "cafe",
  "bike_shop",
  "sights",
  "ferry",
  "toilets",
] as const;

export type PoiCategory = (typeof POI_CATEGORIES)[number];

export const POI_LABELS: Record<PoiCategory, string> = {
  cafe: "Cafés & restaurants",
  bike_shop: "Fietsenmakers",
  sights: "Bezienswaardigheden",
  ferry: "Veerponten",
  toilets: "Toiletten",
};

export const POI_COLORS: Record<PoiCategory, string> = {
  cafe: "#b45309",
  bike_shop: "#0e7490",
  sights: "#7c3aed",
  ferry: "#1d4ed8",
  toilets: "#475569",
};

export const POI_ICONS: Record<
  PoiCategory,
  keyof typeof Ionicons.glyphMap
> = {
  cafe: "cafe",
  bike_shop: "construct",
  sights: "camera",
  ferry: "boat",
  toilets: "water",
};

// Width of the corridor around the planned route, in meters, for the
// "only along my route" filter.
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
// geometry doesn't make this O(pois × every-vertex).
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

  const threshold = corridorMeters + corridorMeters / 4;
  return pois.filter((poi) =>
    samples.some(
      ([lon, lat]) => haversineMeters(poi.lat, poi.lon, lat, lon) <= threshold,
    ),
  );
}
