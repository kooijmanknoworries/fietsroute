// Pure geometry helpers for live ride tracking. Coordinates are [lon, lat]
// (GeoJSON order), matching the planned-route geometry from the API.

export type LngLat = [number, number];

const EARTH_RADIUS_M = 6_371_000;
const toRad = (deg: number): number => (deg * Math.PI) / 180;

/** Great-circle distance between two [lon, lat] points, in metres. */
export function haversine(a: LngLat, b: LngLat): number {
  const dLat = toRad(b[1] - a[1]);
  const dLon = toRad(b[0] - a[0]);
  const lat1 = toRad(a[1]);
  const lat2 = toRad(b[1]);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Total length of a polyline in metres. */
export function polylineLength(line: LngLat[]): number {
  let total = 0;
  for (let i = 1; i < line.length; i++) total += haversine(line[i - 1], line[i]);
  return total;
}

export interface RouteSnap {
  /** Distance along the route (metres) to the closest point. */
  distanceAlong: number;
  /** The closest point on the route to the input point. */
  snapped: LngLat;
  /** Distance (metres) from the input point to the route. */
  distanceToRoute: number;
}

/**
 * Snap a point onto a polyline. Returns the closest point on the route, how far
 * along the route that point is, and how far the input was from the route.
 * Uses a local equirectangular projection per segment, which is accurate at the
 * scale of individual GPS fixes.
 */
export function snapToRoute(route: LngLat[], point: LngLat): RouteSnap | null {
  if (route.length === 0) return null;
  if (route.length === 1) {
    return {
      distanceAlong: 0,
      snapped: route[0],
      distanceToRoute: haversine(route[0], point),
    };
  }

  let best: RouteSnap | null = null;
  let cumulative = 0;

  for (let i = 0; i < route.length - 1; i++) {
    const a = route[i];
    const b = route[i + 1];
    const segLen = haversine(a, b);

    // Local metres frame anchored at segment start.
    const lat0 = toRad(a[1]);
    const cosLat = Math.cos(lat0);
    const mx = (lon: number) => toRad(lon) * cosLat * EARTH_RADIUS_M;
    const my = (lat: number) => toRad(lat) * EARTH_RADIUS_M;

    const ax = mx(a[0]);
    const ay = my(a[1]);
    const bx = mx(b[0]);
    const by = my(b[1]);
    const px = mx(point[0]);
    const py = my(point[1]);

    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    let t = len2 === 0 ? 0 : ((px - ax) * dx + (py - ay) * dy) / len2;
    t = Math.max(0, Math.min(1, t));

    const footX = ax + t * dx;
    const footY = ay + t * dy;
    const distanceToRoute = Math.hypot(px - footX, py - footY);

    if (best === null || distanceToRoute < best.distanceToRoute) {
      best = {
        distanceAlong: cumulative + t * segLen,
        snapped: [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])],
        distanceToRoute,
      };
    }

    cumulative += segLen;
  }

  return best;
}

export interface RouteSlice {
  /** Portion of the route up to `distanceMeters` (already travelled). */
  traveled: LngLat[];
  /** Remaining portion of the route. */
  remaining: LngLat[];
}

/**
 * Split a polyline at a given distance from the start. The split point is
 * interpolated so the two halves join exactly.
 */
export function sliceRoute(route: LngLat[], distanceMeters: number): RouteSlice {
  if (route.length === 0) return { traveled: [], remaining: [] };
  if (distanceMeters <= 0) {
    return { traveled: [route[0]], remaining: [...route] };
  }

  const traveled: LngLat[] = [route[0]];
  let cumulative = 0;

  for (let i = 1; i < route.length; i++) {
    const prev = route[i - 1];
    const curr = route[i];
    const segLen = haversine(prev, curr);

    if (cumulative + segLen <= distanceMeters) {
      traveled.push(curr);
      cumulative += segLen;
      continue;
    }

    const t = segLen === 0 ? 0 : (distanceMeters - cumulative) / segLen;
    const split: LngLat = [
      prev[0] + t * (curr[0] - prev[0]),
      prev[1] + t * (curr[1] - prev[1]),
    ];
    traveled.push(split);
    return { traveled, remaining: [split, ...route.slice(i)] };
  }

  // Distance covers (or exceeds) the whole route.
  return { traveled: [...route], remaining: [route[route.length - 1]] };
}

/** Point at the midpoint (by distance) of a polyline. */
export function midpointOf(line: LngLat[]): LngLat {
  if (line.length === 0) return [0, 0];
  if (line.length === 1) return line[0];
  const half = polylineLength(line) / 2;
  const { traveled } = sliceRoute(line, half);
  return traveled[traveled.length - 1] ?? line[0];
}

export interface RouteLegInput {
  fromRef: string;
  toRef: string;
  coordinates: number[][];
}

export interface RouteNodeInput {
  id: string;
  ref: string;
}

export interface LegSegment {
  /** Stable canonical id: the two endpoint node ids sorted and joined. */
  segmentKey: string;
  fromRef: string;
  toRef: string;
  /** Cumulative distance (metres) along the full route at the leg's end. */
  endDistance: number;
  /** Representative point for the lock marker (leg midpoint). */
  midpoint: LngLat;
}

/**
 * Build a stable, order-independent key for a leg from its two endpoint node
 * ids. OSM node ids are globally unique, so this key is safe to persist and
 * match across rides.
 */
export function segmentKeyFor(nodeIdA: string, nodeIdB: string): string {
  return [String(nodeIdA), String(nodeIdB)].sort().join("__");
}

/**
 * Map planned-route legs to visitable segments. Legs correspond 1:1 to
 * consecutive selected nodes (leg i joins nodes[i] → nodes[i+1]), so the node
 * ids give each leg a stable key. Falls back to the knooppunt refs if a node id
 * is missing.
 */
export function legSegments(
  legs: RouteLegInput[],
  nodes: RouteNodeInput[],
): LegSegment[] {
  const segments: LegSegment[] = [];
  let cumulative = 0;

  for (let i = 0; i < legs.length; i++) {
    const leg = legs[i];
    const coords = leg.coordinates as LngLat[];
    cumulative += polylineLength(coords);

    const fromId = nodes[i]?.id ?? leg.fromRef;
    const toId = nodes[i + 1]?.id ?? leg.toRef;

    segments.push({
      segmentKey: segmentKeyFor(fromId, toId),
      fromRef: leg.fromRef,
      toRef: leg.toRef,
      endDistance: cumulative,
      midpoint: midpointOf(coords),
    });
  }

  return segments;
}
