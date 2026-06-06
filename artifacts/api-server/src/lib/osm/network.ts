import { fetchOverpassTiles, type Bbox } from "./overpass";
import {
  isDatasetReady,
  getNetworkFromDataset,
  DATASET_MAX_AREA_DEG2,
} from "./dataset";
import { logger } from "../logger";

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

// The client snaps the requested viewport outward to the 0.1° tile grid, which
// can grow each axis by up to ~0.1°. The cap is sized so viewports that used to
// render nodes don't get truncated purely because of that outward snapping;
// tiles are fetched concurrently and cached per tile, so the extra area is cheap.
const MAX_AREA_DEG2 = 0.36;

export async function getNetworkData(bbox: Bbox): Promise<NetworkData> {
  const area =
    Math.abs(bbox.maxLon - bbox.minLon) * Math.abs(bbox.maxLat - bbox.minLat);

  // Prefer the locally preloaded NL+BE dataset when it's populated: a single
  // indexed bbox query serves instantly and covers a far larger viewport than
  // the live per-tile path. Fall back to live Overpass if the dataset is empty
  // (not yet imported) or the query fails.
  if (await isDatasetReady()) {
    if (area > DATASET_MAX_AREA_DEG2) {
      return { nodes: [], segments: [], truncated: true };
    }
    try {
      const data = await getNetworkFromDataset(bbox);
      // A populated dataset can still have coverage holes when some import
      // chunks failed (Overpass is flaky). Treat an empty-but-untruncated
      // result as a possible hole and fall through to the live path so those
      // regions still load (and get cached) instead of showing nothing.
      if (data.truncated || data.nodes.length > 0 || data.segments.length > 0) {
        return data;
      }
    } catch (err) {
      logger.warn({ err }, "Dataset query failed, falling back to live tiles");
    }
  }

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
