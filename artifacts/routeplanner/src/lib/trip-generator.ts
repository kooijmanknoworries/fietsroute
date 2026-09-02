// Generate a knooppunt route that matches a target distance (in meters).
// Uses the loaded network data (nodes + segments) to build an adjacency graph,
// then performs a greedy walk from the nearest knooppunt to the user's
// position until the cumulative distance approaches the target.

import type { NetworkNode, NetworkSegment } from "@workspace/api-client-react";

// Haversine distance in meters between two [lon, lat] points.
function haversine(lon1: number, lat1: number, lon2: number, lat2: number): number {
  const R = 6_371_000;
  const toRad = (v: number) => (v * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Total length of a coordinate polyline in meters.
function polylineLength(coords: number[][]): number {
  let total = 0;
  for (let i = 1; i < coords.length; i++) {
    total += haversine(coords[i - 1][0], coords[i - 1][1], coords[i][0], coords[i][1]);
  }
  return total;
}

// Build an adjacency map: nodeId → [{ nodeId, segmentId, distanceMeters }].
function buildAdjacency(
  nodes: NetworkNode[],
  segments: NetworkSegment[],
): Map<string, { nodeId: string; segmentId: string; distanceMeters: number }[]> {
  const nodeById = new Map(nodes.map(n => [n.id, n]));
  const adj = new Map<string, { nodeId: string; segmentId: string; distanceMeters: number }[]>();

  for (const seg of segments) {
    if (seg.coordinates.length < 2) continue;
    const from = seg.coordinates[0];
    const to = seg.coordinates[seg.coordinates.length - 1];

    // Find which knooppunt is at each end
    const fromNode = findNearestNode(from[0], from[1], nodes);
    const toNode = findNearestNode(to[0], to[1], nodes);

    if (!fromNode || !toNode || fromNode.id === toNode.id) continue;

    const dist = polylineLength(seg.coordinates);

    if (!adj.has(fromNode.id)) adj.set(fromNode.id, []);
    if (!adj.has(toNode.id)) adj.set(toNode.id, []);

    adj.get(fromNode.id)!.push({ nodeId: toNode.id, segmentId: seg.id, distanceMeters: dist });
    adj.get(toNode.id)!.push({ nodeId: fromNode.id, segmentId: seg.id, distanceMeters: dist });
  }

  return adj;
}

// Find the knooppunt closest to a given [lon, lat], within 500m.
function findNearestNode(lon: number, lat: number, nodes: NetworkNode[]): NetworkNode | null {
  let best: NetworkNode | null = null;
  let bestDist = 500; // max 500m tolerance
  for (const n of nodes) {
    const d = haversine(n.lon, n.lat, lon, lat);
    if (d < bestDist) {
      bestDist = d;
      best = n;
    }
  }
  return best;
}

export interface TripResult {
  /** Distance from user position to starting knooppunt (meters). */
  accessDistanceMeters: number;
  /** The starting knooppunt (nearest to user). */
  startNode: NetworkNode;
  /** Ordered knooppunten forming the trip (start + intermediate nodes). */
  nodes: NetworkNode[];
  /** Estimated route distance along the knooppunt network (meters). */
  estimatedDistanceMeters: number;
}

/**
 * Generate a knooppunt route targeting `targetMeters` of cycling distance.
 * The user position determines the starting knooppunt. The route distance
 * is measured along the knooppunt network from the starting point.
 *
 * @param userLon - User's longitude
 * @param userLat - User's latitude
 * @param targetMeters - Target cycling distance in meters (e.g. 25_000 for 25km)
 * @param nodes - All network knooppunten
 * @param segments - All network segments
 * @returns TripResult with start node, planned nodes, and distances
 */
export function generateTripByDistance(
  userLon: number,
  userLat: number,
  targetMeters: number,
  nodes: NetworkNode[],
  segments: NetworkSegment[],
): TripResult | null {
  // Find nearest knooppunt to user
  const startNode = findNearestNode(userLon, userLat, nodes);
  if (!startNode) return null;

  const accessDist = haversine(userLon, userLat, startNode.lon, startNode.lat);

  // Build adjacency graph
  const adj = buildAdjacency(nodes, segments);
  const nodeById = new Map(nodes.map(n => [n.id, n]));

  // Greedy walk: from start, always pick the next node that gets us
  // closer to the target distance, avoiding immediate backtracking.
  const visited = new Set<string>();
  const path: NetworkNode[] = [startNode];
  visited.add(startNode.id);
  let cumulativeDist = 0;

  let prevNodeId = startNode.id;

  while (cumulativeDist < targetMeters) {
    const neighbors = adj.get(prevNodeId);
    if (!neighbors || neighbors.length === 0) break;

    // Filter out visited nodes
    const unvisited = neighbors.filter(n => !visited.has(n.nodeId));
    if (unvisited.length === 0) break;

    // Pick the neighbor that gets us closest to the target distance
    // without overshooting too much (allow up to 50% overshoot on last step)
    const remaining = targetMeters - cumulativeDist;
    let best = unvisited[0];

    // Prefer the one whose distance gets us closest to target
    // Sort by how close cumulative + this edge gets to target
    unvisited.sort((a, b) => {
      const aDist = Math.abs(cumulativeDist + a.distanceMeters - targetMeters);
      const bDist = Math.abs(cumulativeDist + b.distanceMeters - targetMeters);
      return aDist - bDist;
    });

    // If all edges overshoot by more than 2x remaining, still pick the smallest
    if (unvisited.every(n => n.distanceMeters > remaining * 2)) {
      unvisited.sort((a, b) => a.distanceMeters - b.distanceMeters);
    }

    best = unvisited[0];

    const nextNode = nodeById.get(best.nodeId);
    if (!nextNode) break;

    path.push(nextNode);
    visited.add(nextNode.id);
    cumulativeDist += best.distanceMeters;
    prevNodeId = nextNode.id;

    // Safety: max 100 nodes
    if (path.length > 100) break;
  }

  return {
    accessDistanceMeters: accessDist,
    startNode,
    nodes: path,
    estimatedDistanceMeters: cumulativeDist,
  };
}
