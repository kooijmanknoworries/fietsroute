import {
  haversineMeters,
  fetchOverpass,
  type Bbox,
  type OverpassResult,
} from "./overpass";
import { getNetworkForRoute } from "./dataset";
import { logger } from "../logger";

export interface RouteRequestNode {
  id: string;
  ref: string;
  lat: number;
  lon: number;
}

export interface RouteLeg {
  fromRef: string;
  toRef: string;
  distanceMeters: number;
  coordinates: number[][];
}

export interface RoutePlan {
  nodeRefs: string[];
  coordinates: number[][];
  distanceMeters: number;
  legs: RouteLeg[];
}

export class NoPathError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NoPathError";
  }
}

export class RouteRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RouteRequestError";
  }
}

const MAX_ROUTE_AREA_DEG2 = 1.0;
const MAX_ROUTE_NODES = 50;
// How far a clicked knooppunt may be from the nearest routable graph vertex
// before we consider it "off the network". Clickable knooppunten come from the
// full rcn_ref node set, but the routing graph is built only from ways in
// route=bicycle relations, so a knooppunt can be a standalone marker placed
// tens (sometimes a few hundred) of metres from the way it belongs to. 500 m
// comfortably bridges those marker-to-junction offsets while staying well under
// the typical spacing between distinct knooppunten, so it won't snap to the
// wrong junction.
const MAX_SNAP_METERS = 500;

interface Edge {
  to: number;
  weight: number;
}

interface Graph {
  adj: Map<number, Edge[]>;
}

function buildGraph(data: OverpassResult): Graph {
  const adj = new Map<number, Edge[]>();
  const addEdge = (a: number, b: number, w: number) => {
    let list = adj.get(a);
    if (!list) {
      list = [];
      adj.set(a, list);
    }
    list.push({ to: b, weight: w });
  };

  for (const way of data.ways) {
    for (let i = 0; i < way.nodes.length - 1; i++) {
      const a = way.nodes[i];
      const b = way.nodes[i + 1];
      const na = data.nodes.get(a);
      const nb = data.nodes.get(b);
      if (!na || !nb) continue;
      const w = haversineMeters(na.lat, na.lon, nb.lat, nb.lon);
      addEdge(a, b, w);
      addEdge(b, a, w);
    }
  }

  return { adj };
}

class MinHeap {
  private heap: { id: number; dist: number }[] = [];

  get size(): number {
    return this.heap.length;
  }

  push(id: number, dist: number): void {
    const h = this.heap;
    h.push({ id, dist });
    let i = h.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (h[parent].dist <= h[i].dist) break;
      [h[parent], h[i]] = [h[i], h[parent]];
      i = parent;
    }
  }

  pop(): { id: number; dist: number } | undefined {
    const h = this.heap;
    if (h.length === 0) return undefined;
    const top = h[0];
    const last = h.pop()!;
    if (h.length > 0) {
      h[0] = last;
      let i = 0;
      const n = h.length;
      for (;;) {
        const l = 2 * i + 1;
        const r = 2 * i + 2;
        let smallest = i;
        if (l < n && h[l].dist < h[smallest].dist) smallest = l;
        if (r < n && h[r].dist < h[smallest].dist) smallest = r;
        if (smallest === i) break;
        [h[smallest], h[i]] = [h[i], h[smallest]];
        i = smallest;
      }
    }
    return top;
  }
}

function dijkstra(
  graph: Graph,
  start: number,
  goal: number,
): { path: number[]; distance: number } | null {
  if (start === goal) return { path: [start], distance: 0 };
  const dist = new Map<number, number>();
  const prev = new Map<number, number>();
  const visited = new Set<number>();
  const heap = new MinHeap();
  dist.set(start, 0);
  heap.push(start, 0);

  while (heap.size > 0) {
    const current = heap.pop()!;
    if (visited.has(current.id)) continue;
    visited.add(current.id);
    if (current.id === goal) break;

    const edges = graph.adj.get(current.id);
    if (!edges) continue;
    const baseDist = current.dist;
    for (const edge of edges) {
      if (visited.has(edge.to)) continue;
      const nd = baseDist + edge.weight;
      const existing = dist.get(edge.to);
      if (existing === undefined || nd < existing) {
        dist.set(edge.to, nd);
        prev.set(edge.to, current.id);
        heap.push(edge.to, nd);
      }
    }
  }

  if (!dist.has(goal)) return null;

  const path: number[] = [];
  let node: number | undefined = goal;
  while (node !== undefined) {
    path.push(node);
    if (node === start) break;
    node = prev.get(node);
  }
  if (path[path.length - 1] !== start) return null;
  path.reverse();
  return { path, distance: dist.get(goal)! };
}

function resolveVertex(
  data: OverpassResult,
  graph: Graph,
  node: RouteRequestNode,
): { id: number; dist: number } | null {
  const id = Number(node.id);
  if (Number.isFinite(id) && graph.adj.has(id)) {
    return { id, dist: 0 };
  }
  let best: number | null = null;
  let bestDist = Infinity;
  for (const vertexId of graph.adj.keys()) {
    const v = data.nodes.get(vertexId);
    if (!v) continue;
    const d = haversineMeters(node.lat, node.lon, v.lat, v.lon);
    if (d < bestDist) {
      bestDist = d;
      best = vertexId;
    }
  }
  return best === null ? null : { id: best, dist: bestDist };
}

type ResolvedVertex = { id: number; dist: number } | null;

function resolveAll(
  data: OverpassResult,
  graph: Graph,
  nodes: RouteRequestNode[],
): ResolvedVertex[] {
  return nodes.map((n) => resolveVertex(data, graph, n));
}

function allResolved(resolved: ResolvedVertex[]): boolean {
  return resolved.every((v) => v !== null && v.dist <= MAX_SNAP_METERS);
}

function boundingBox(nodes: RouteRequestNode[], pad: number): Bbox {
  let minLon = Infinity;
  let minLat = Infinity;
  let maxLon = -Infinity;
  let maxLat = -Infinity;
  for (const n of nodes) {
    if (n.lon < minLon) minLon = n.lon;
    if (n.lon > maxLon) maxLon = n.lon;
    if (n.lat < minLat) minLat = n.lat;
    if (n.lat > maxLat) maxLat = n.lat;
  }
  return {
    minLon: minLon - pad,
    minLat: minLat - pad,
    maxLon: maxLon + pad,
    maxLat: maxLat + pad,
  };
}

export async function planRoute(
  nodes: RouteRequestNode[],
): Promise<RoutePlan> {
  if (nodes.length < 2) {
    throw new RouteRequestError(
      "At least two nodes are required to plan a route.",
    );
  }
  if (nodes.length > MAX_ROUTE_NODES) {
    throw new RouteRequestError(
      `Too many nodes selected (maximum ${MAX_ROUTE_NODES}).`,
    );
  }

  const bbox = boundingBox(nodes, 0.08);
  const area =
    Math.abs(bbox.maxLon - bbox.minLon) * Math.abs(bbox.maxLat - bbox.minLat);
  if (area > MAX_ROUTE_AREA_DEG2) {
    throw new RouteRequestError(
      "Selected nodes are too far apart to plan a route. Choose nodes that are closer together.",
    );
  }

  let data = await getNetworkForRoute(bbox);
  let graph = buildGraph(data);
  let resolved = resolveAll(data, graph, nodes);

  // Every clickable knooppunt should be routable, but the preloaded dataset can
  // be incomplete or stale for a given area (e.g. an import gap, or a knooppunt
  // whose connecting ways aren't stored yet). If any endpoint fails to snap onto
  // the network, retry once with live Overpass data before giving up — this is
  // what turns the old "Could not locate node" 422 into a real route for nodes
  // that simply weren't covered by the local dataset.
  if (!allResolved(resolved)) {
    try {
      const liveData = await fetchOverpass(bbox);
      const liveGraph = buildGraph(liveData);
      const liveResolved = resolveAll(liveData, liveGraph, nodes);
      if (allResolved(liveResolved)) {
        data = liveData;
        graph = liveGraph;
        resolved = liveResolved;
      }
    } catch (err) {
      logger.warn(
        { err, bbox },
        "Live Overpass fallback failed while resolving route endpoints",
      );
    }
  }

  const legs: RouteLeg[] = [];
  const coordinates: number[][] = [];
  const nodeRefs: string[] = [];
  let totalDistance = 0;

  for (let i = 0; i < nodes.length - 1; i++) {
    const from = nodes[i];
    const to = nodes[i + 1];

    if (i === 0) nodeRefs.push(from.ref);
    nodeRefs.push(to.ref);

    const startVertex = resolved[i];
    const endVertex = resolved[i + 1];
    if (
      startVertex === null ||
      endVertex === null ||
      startVertex.dist > MAX_SNAP_METERS ||
      endVertex.dist > MAX_SNAP_METERS
    ) {
      throw new NoPathError(
        `Could not locate node ${from.ref} or ${to.ref} on the cycling network.`,
      );
    }

    const result = dijkstra(graph, startVertex.id, endVertex.id);
    if (!result) {
      throw new NoPathError(
        `No connecting path found between node ${from.ref} and ${to.ref}.`,
      );
    }

    const legCoords: number[][] = [];
    for (const vid of result.path) {
      const v = data.nodes.get(vid);
      if (v) legCoords.push([v.lon, v.lat]);
    }

    legs.push({
      fromRef: from.ref,
      toRef: to.ref,
      distanceMeters: Math.round(result.distance),
      coordinates: legCoords,
    });
    totalDistance += result.distance;

    for (const coord of legCoords) {
      const last = coordinates[coordinates.length - 1];
      if (last && last[0] === coord[0] && last[1] === coord[1]) continue;
      coordinates.push(coord);
    }
  }

  return {
    nodeRefs,
    coordinates,
    distanceMeters: Math.round(totalDistance),
    legs,
  };
}
