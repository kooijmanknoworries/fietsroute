import { fetchOverpassTiles, type Bbox } from "./overpass";

export interface NetworkNode {
  id: string;
  ref: string;
  lat: number;
  lon: number;
}

export interface NetworkSegment {
  id: string;
  coordinates: number[][];
}

export interface NetworkData {
  nodes: NetworkNode[];
  segments: NetworkSegment[];
  truncated: boolean;
}

const MAX_AREA_DEG2 = 0.25;

export async function getNetworkData(bbox: Bbox): Promise<NetworkData> {
  const area =
    Math.abs(bbox.maxLon - bbox.minLon) * Math.abs(bbox.maxLat - bbox.minLat);
  if (area > MAX_AREA_DEG2) {
    return { nodes: [], segments: [], truncated: true };
  }

  const { nodes, ways } = await fetchOverpassTiles(bbox);

  const resultNodes: NetworkNode[] = [];
  for (const n of nodes.values()) {
    if (n.rcnRef) {
      resultNodes.push({ id: String(n.id), ref: n.rcnRef, lat: n.lat, lon: n.lon });
    }
  }

  const segments: NetworkSegment[] = [];
  for (const way of ways) {
    const coords: number[][] = [];
    for (const nid of way.nodes) {
      const n = nodes.get(nid);
      if (n) coords.push([n.lon, n.lat]);
    }
    if (coords.length >= 2) {
      segments.push({ id: String(way.id), coordinates: coords });
    }
  }

  return { nodes: resultNodes, segments, truncated: false };
}
