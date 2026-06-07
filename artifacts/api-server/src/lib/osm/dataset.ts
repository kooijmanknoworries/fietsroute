import { and, gte, lt, lte, sql } from "drizzle-orm";
import { db, networkNodesTable, networkSegmentsTable } from "@workspace/db";
import { logger } from "../logger";
import {
  fetchOverpassUncached,
  fetchOverpass,
  type Bbox,
  type OverpassNode,
  type OverpassWay,
  type OverpassResult,
} from "./overpass";
import type { NetworkData, NetworkNode, NetworkSegment } from "./network";

// Minimal node count for the dataset to be considered useful for routing.
// The full NL+BE network has ~8,000+ nodes; below this we fall back to live
// Overpass so the route planner keeps working while the import is still running.
const DATASET_MIN_NODE_COUNT = 3000;

// Bounding box covering the Netherlands + Belgium. The importer walks this in
// fixed chunks and pulls the full cycling node network (rcn) into our own
// tables so the map can be served locally instead of hitting Overpass per pan.
const NL_BE_BBOX: Bbox = {
  minLat: 49.4,
  maxLat: 53.75,
  minLon: 2.45,
  maxLon: 7.3,
};

// Per-query chunk size, in degrees. Small enough that a single rcn query stays
// well within Overpass timeouts, large enough that the whole region is a few
// dozen requests rather than thousands of tiny tiles.
const CHUNK_DEG = 0.5;

// Politeness gap between chunk queries so the import never hammers Overpass.
const IMPORT_THROTTLE_MS = 1200;

// Rows per insert statement when upserting a chunk's results.
const INSERT_BATCH = 500;

// Re-import the whole dataset when the freshest row is older than this.
const STALE_MS = 7 * 24 * 60 * 60 * 1000;

// Delay before the first import attempt after boot, so startup isn't blocked
// and the server is already serving (falling back to live tiles) meanwhile.
const STARTUP_DELAY_MS = 15 * 1000;

// How often to re-check staleness and refresh if needed.
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;

// How often to retry chunks that failed during the last import. Much shorter
// than the full weekly re-import so coverage gaps from Overpass blips heal
// within an hour rather than waiting for the next full pass.
const RETRY_FAILED_MS = 60 * 60 * 1000;

// Cache the (cheap) readiness probe so we don't hit the DB on every request.
const READY_CACHE_MS = 30 * 1000;

// The dataset can serve a much larger viewport than the live per-tile path
// because it's a single indexed bbox query. Still capped so a whole-country
// view doesn't return tens of thousands of nodes.
export const DATASET_MAX_AREA_DEG2 = 4.0;

// Above this many nodes in view we report truncation rather than shipping a
// huge payload the client can't usefully render.
const DATASET_NODE_CAP = 8000;

// Chunks that failed during the last import run, keyed by "minLat,minLon"
// so they can be identified and scheduled for a fast retry.
const failedChunks = new Map<string, Bbox>();

function chunkKey(b: Bbox): string {
  return `${b.minLat},${b.minLon}`;
}

function round(n: number): number {
  return Number(n.toFixed(4));
}

function chunkBboxes(): Bbox[] {
  const out: Bbox[] = [];
  for (let lat = NL_BE_BBOX.minLat; lat < NL_BE_BBOX.maxLat; lat += CHUNK_DEG) {
    for (let lon = NL_BE_BBOX.minLon; lon < NL_BE_BBOX.maxLon; lon += CHUNK_DEG) {
      out.push({
        minLat: round(lat),
        maxLat: round(Math.min(lat + CHUNK_DEG, NL_BE_BBOX.maxLat)),
        minLon: round(lon),
        maxLon: round(Math.min(lon + CHUNK_DEG, NL_BE_BBOX.maxLon)),
      });
    }
  }
  return out;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

let readyCache: { ready: boolean; at: number } | null = null;

// Whether the local dataset has been populated. Cached briefly so the per-pan
// network endpoint doesn't issue an extra DB round-trip on every request.
export async function isDatasetReady(): Promise<boolean> {
  const now = Date.now();
  if (readyCache && now - readyCache.at < READY_CACHE_MS) {
    return readyCache.ready;
  }
  try {
    const rows = await db
      .select({ one: sql<number>`1` })
      .from(networkNodesTable)
      .limit(1);
    const ready = rows.length > 0;
    readyCache = { ready, at: now };
    return ready;
  } catch (err) {
    logger.warn({ err }, "Dataset readiness check failed");
    return false;
  }
}

// Serve a viewport from the local dataset. Returns truncated when the viewport
// holds more nodes than the cap. The caller checks the area cap beforehand.
export async function getNetworkFromDataset(bbox: Bbox): Promise<NetworkData> {
  const nodeRows = await db
    .select()
    .from(networkNodesTable)
    .where(
      and(
        gte(networkNodesTable.lat, bbox.minLat),
        lte(networkNodesTable.lat, bbox.maxLat),
        gte(networkNodesTable.lon, bbox.minLon),
        lte(networkNodesTable.lon, bbox.maxLon),
      ),
    )
    .limit(DATASET_NODE_CAP + 1);

  if (nodeRows.length > DATASET_NODE_CAP) {
    return { nodes: [], segments: [], truncated: true };
  }

  const segRows = await db
    .select()
    .from(networkSegmentsTable)
    .where(
      and(
        gte(networkSegmentsTable.maxLat, bbox.minLat),
        lte(networkSegmentsTable.minLat, bbox.maxLat),
        gte(networkSegmentsTable.maxLon, bbox.minLon),
        lte(networkSegmentsTable.minLon, bbox.maxLon),
      ),
    );

  const nodes: NetworkNode[] = nodeRows.map((r) => ({
    id: r.id,
    ref: r.ref,
    lat: r.lat,
    lon: r.lon,
  }));
  const segments: NetworkSegment[] = segRows.map((r) => ({
    id: r.id,
    coordinates: r.coordinates as number[][],
  }));

  return { nodes, segments, truncated: false };
}

// Serve data for route planning in the format the router expects.
// Used instead of live Overpass so routes compute instantly from the
// pre-loaded NL+BE dataset.
// Falls back to live Overpass if the dataset is still being imported and
// doesn't yet contain enough nodes to be useful.
export async function getNetworkForRoute(bbox: Bbox): Promise<OverpassResult> {
  const totalNodes = await db
    .select({ count: sql<number>`count(*)` })
    .from(networkNodesTable);

  if (totalNodes[0].count < DATASET_MIN_NODE_COUNT) {
    logger.debug(
      { dbCount: totalNodes[0].count, threshold: DATASET_MIN_NODE_COUNT },
      "Dataset too small for routing, falling back to live Overpass",
    );
    return fetchOverpass(bbox);
  }

  const nodeRows = await db
    .select()
    .from(networkNodesTable)
    .where(
      and(
        gte(networkNodesTable.lat, bbox.minLat),
        lte(networkNodesTable.lat, bbox.maxLat),
        gte(networkNodesTable.lon, bbox.minLon),
        lte(networkNodesTable.lon, bbox.maxLon),
      ),
    );

  const segRows = await db
    .select()
    .from(networkSegmentsTable)
    .where(
      and(
        gte(networkSegmentsTable.maxLat, bbox.minLat),
        lte(networkSegmentsTable.minLat, bbox.maxLat),
        gte(networkSegmentsTable.maxLon, bbox.minLon),
        lte(networkSegmentsTable.minLon, bbox.maxLon),
      ),
    );

  const nodes = new Map<number, OverpassNode>();
  for (const r of nodeRows) {
    nodes.set(Number(r.id), {
      id: Number(r.id),
      lat: r.lat,
      lon: r.lon,
      rcnRef: r.ref,
    });
  }

  const ways: OverpassWay[] = [];
  for (const r of segRows) {
    const ids = r.nodeIds as number[];
    if (ids.length >= 2) {
      ways.push({ id: Number(r.id), nodes: ids });
    }
  }

  return { nodes, ways };
}

interface NodeInsert {
  id: string;
  ref: string;
  lat: number;
  lon: number;
}

interface SegmentInsert {
  id: string;
  coordinates: number[][];
  nodeIds: number[];
  minLat: number;
  maxLat: number;
  minLon: number;
  maxLon: number;
}

async function upsertNodes(rows: NodeInsert[]): Promise<void> {
  for (let i = 0; i < rows.length; i += INSERT_BATCH) {
    const batch = rows.slice(i, i + INSERT_BATCH);
    await db
      .insert(networkNodesTable)
      .values(batch)
      .onConflictDoUpdate({
        target: networkNodesTable.id,
        set: {
          ref: sql`excluded.ref`,
          lat: sql`excluded.lat`,
          lon: sql`excluded.lon`,
          updatedAt: sql`now()`,
        },
      });
  }
}

async function upsertSegments(rows: SegmentInsert[]): Promise<void> {
  for (let i = 0; i < rows.length; i += INSERT_BATCH) {
    const batch = rows.slice(i, i + INSERT_BATCH);
    await db
      .insert(networkSegmentsTable)
      .values(batch)
      .onConflictDoUpdate({
        target: networkSegmentsTable.id,
        set: {
          coordinates: sql`excluded.coordinates`,
          minLat: sql`excluded.min_lat`,
          maxLat: sql`excluded.max_lat`,
          minLon: sql`excluded.min_lon`,
          maxLon: sql`excluded.max_lon`,
          updatedAt: sql`now()`,
        },
      });
  }
}

// Delete nodes inside a chunk's bbox that weren't updated in this import pass.
// A node is a point, so it belongs to exactly one chunk — safe to prune per-chunk.
async function pruneChunkNodes(chunk: Bbox, before: Date): Promise<number> {
  const deleted = await db
    .delete(networkNodesTable)
    .where(
      and(
        gte(networkNodesTable.lat, chunk.minLat),
        lte(networkNodesTable.lat, chunk.maxLat),
        gte(networkNodesTable.lon, chunk.minLon),
        lte(networkNodesTable.lon, chunk.maxLon),
        lt(networkNodesTable.updatedAt, before),
      ),
    )
    .returning({ id: networkNodesTable.id });
  return deleted.length;
}

// Delete segments that weren't touched anywhere in this full import pass.
// Segments can span chunk boundaries so we only prune them globally after all
// chunks succeed, not per-chunk.
async function pruneStaleSegments(before: Date): Promise<number> {
  const deleted = await db
    .delete(networkSegmentsTable)
    .where(lt(networkSegmentsTable.updatedAt, before))
    .returning({ id: networkSegmentsTable.id });
  return deleted.length;
}

// Import a single chunk: fetch from Overpass, upsert nodes/segments, then
// prune nodes in that chunk that weren't seen (they no longer exist in OSM).
async function importChunk(
  chunk: Bbox,
  importStart: Date,
): Promise<{ nodes: number; segs: number }> {
  const { nodes, ways } = await fetchOverpassUncached(chunk);

  const nodeRows: NodeInsert[] = [];
  for (const n of nodes.values()) {
    if (n.rcnRef) {
      nodeRows.push({
        id: String(n.id),
        ref: n.rcnRef,
        lat: n.lat,
        lon: n.lon,
      });
    }
  }

  const segRows: SegmentInsert[] = [];
  for (const way of ways) {
    const coords: number[][] = [];
    const nodeIds: number[] = [];
    for (const nid of way.nodes) {
      const n = nodes.get(nid);
      if (n) {
        coords.push([n.lon, n.lat]);
        nodeIds.push(nid);
      }
    }
    if (coords.length < 2) continue;
    let minLat = Infinity;
    let maxLat = -Infinity;
    let minLon = Infinity;
    let maxLon = -Infinity;
    for (const [lon, lat] of coords) {
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
      if (lon < minLon) minLon = lon;
      if (lon > maxLon) maxLon = lon;
    }
    segRows.push({
      id: String(way.id),
      coordinates: coords,
      nodeIds,
      minLat,
      maxLat,
      minLon,
      maxLon,
    });
  }

  if (nodeRows.length > 0) await upsertNodes(nodeRows);
  if (segRows.length > 0) await upsertSegments(segRows);

  // Prune nodes in this chunk that weren't seen — they were removed from OSM.
  const pruned = await pruneChunkNodes(chunk, importStart);
  if (pruned > 0) {
    logger.info({ chunk, pruned }, "Pruned stale nodes from chunk");
  }

  return { nodes: nodeRows.length, segs: segRows.length };
}

let importing = false;

// Pull the whole NL+BE network chunk by chunk and upsert it into the dataset
// tables. Resilient: a failing chunk is logged, recorded for fast retry, and
// skipped so a single Overpass hiccup never aborts the whole import.
// After all chunks complete without error, stale segments are also pruned.
export async function importNetworkDataset(): Promise<void> {
  if (importing) {
    logger.info("Network dataset import already in progress, skipping");
    return;
  }
  importing = true;

  const chunks = chunkBboxes();
  let imported = 0;
  let failed = 0;
  let nodeCount = 0;
  let segCount = 0;
  const importStart = new Date();
  logger.info({ chunks: chunks.length }, "Starting network dataset import");

  try {
    for (const chunk of chunks) {
      try {
        const result = await importChunk(chunk, importStart);
        failedChunks.delete(chunkKey(chunk));
        imported++;
        nodeCount += result.nodes;
        segCount += result.segs;
      } catch (err) {
        failed++;
        failedChunks.set(chunkKey(chunk), chunk);
        logger.warn({ err, chunk }, "Failed to import network chunk");
      }
      await sleep(IMPORT_THROTTLE_MS);
    }

    // Segments can span chunk boundaries so they're pruned globally only when
    // every chunk succeeded (no coverage holes from failed chunks).
    if (failed === 0) {
      const prunedSegs = await pruneStaleSegments(importStart);
      if (prunedSegs > 0) {
        logger.info({ prunedSegs }, "Pruned stale segments after full import");
      }
    }

    // Force the next readiness probe to re-read now that rows exist.
    readyCache = null;
  } finally {
    importing = false;
  }

  logger.info(
    { imported, failed, nodeCount, segCount },
    "Network dataset import complete",
  );
}

// Retry only the chunks that failed during the last import pass. Runs on a
// short interval so coverage gaps from Overpass outages heal within an hour
// rather than waiting for the next full weekly re-import.
async function retryFailedChunks(): Promise<void> {
  if (importing || failedChunks.size === 0) return;

  const toRetry = [...failedChunks.values()];
  logger.info({ count: toRetry.length }, "Retrying failed network chunks");

  for (const chunk of toRetry) {
    const retryStart = new Date();
    try {
      await importChunk(chunk, retryStart);
      failedChunks.delete(chunkKey(chunk));
      logger.info({ chunk }, "Retried network chunk successfully");
    } catch (err) {
      logger.warn({ err, chunk }, "Retry of network chunk still failing");
    }
    await sleep(IMPORT_THROTTLE_MS);
  }
}

async function isDatasetStale(): Promise<boolean> {
  try {
    const rows = await db
      .select({ max: sql<string | null>`max(${networkNodesTable.updatedAt})` })
      .from(networkNodesTable);
    const max = rows[0]?.max;
    if (!max) return true;
    return Date.now() - new Date(max).getTime() > STALE_MS;
  } catch (err) {
    logger.warn({ err }, "Dataset staleness check failed");
    // On error, don't trigger a fresh (heavy) import.
    return false;
  }
}

async function maybeImport(): Promise<void> {
  try {
    if (await isDatasetStale()) {
      await importNetworkDataset();
    } else {
      logger.debug("Network dataset is fresh, skipping import");
    }
  } catch (err) {
    logger.warn({ err }, "Network dataset refresh check failed");
  }
}

// Schedule the initial import (after a short delay) and a periodic staleness
// check. A faster retry loop targets only failed chunks so coverage gaps heal
// quickly without re-running the full import. Disabled entirely via
// DISABLE_NETWORK_PRELOAD=true.
export function startNetworkPreload(): void {
  if (process.env["DISABLE_NETWORK_PRELOAD"] === "true") {
    logger.info("Network dataset preload disabled via DISABLE_NETWORK_PRELOAD");
    return;
  }
  const startup = setTimeout(() => {
    void maybeImport();
  }, STARTUP_DELAY_MS);
  startup.unref();

  const interval = setInterval(() => {
    void maybeImport();
  }, CHECK_INTERVAL_MS);
  interval.unref();

  // Retry failed chunks much more often than the full weekly re-import.
  const retry = setInterval(() => {
    void retryFailedChunks();
  }, RETRY_FAILED_MS);
  retry.unref();
}
