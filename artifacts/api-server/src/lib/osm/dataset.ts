import { and, eq, gte, like, lt, lte, sql } from "drizzle-orm";
import {
  db,
  networkNodesTable,
  networkSegmentsTable,
  overpassCacheTable,
} from "@workspace/db";
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
const RETRY_FAILED_MS = 10 * 60 * 1000;

// Total number of chunks in the NL+BE grid. Precomputed so the rolling-refresh
// cadence can be derived from it without recomputing the grid every tick.
const CHUNK_COUNT = chunkBboxes().length;

// Rolling refresh: rather than let the whole dataset go stale and then re-import
// everything at once, continuously re-import the single oldest chunk. Spread
// across the grid this refreshes every chunk within roughly STALE_MS while only
// ever running one small Overpass query at a time. The interval is derived so
// that (interval * CHUNK_COUNT) ≈ STALE_MS, with a floor so it never hammers
// Overpass on tiny grids.
const ROLLING_REFRESH_INTERVAL_MS = Math.max(
  5 * 60 * 1000,
  Math.floor(STALE_MS / CHUNK_COUNT),
);

// A chunk is only picked for a rolling refresh once its data is older than this.
// Without a floor, a freshly imported dataset would still churn one chunk every
// interval even though nothing is close to stale yet.
const ROLLING_REFRESH_MIN_AGE_MS = 12 * 60 * 60 * 1000;

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

// Successfully imported chunks are marked in the persistent overpass_cache
// table (under their own key prefix) so an
// interrupted import resumes where it left off after a restart instead of
// re-querying all ~90 chunks from Overpass again.
const CHUNK_MARKER_PREFIX = "import-chunk:";

async function isChunkFresh(chunk: Bbox): Promise<boolean> {
  const rows = await db
    .select({ expiresAt: overpassCacheTable.expiresAt })
    .from(overpassCacheTable)
    .where(eq(overpassCacheTable.key, CHUNK_MARKER_PREFIX + chunkKey(chunk)))
    .limit(1);
  const row = rows[0];
  return row !== undefined && row.expiresAt.getTime() > Date.now();
}

async function markChunkFresh(chunk: Bbox): Promise<void> {
  const key = CHUNK_MARKER_PREFIX + chunkKey(chunk);
  const expiresAt = new Date(Date.now() + STALE_MS);
  await db
    .insert(overpassCacheTable)
    .values({ key, data: {}, expiresAt })
    .onConflictDoUpdate({
      target: overpassCacheTable.key,
      set: { expiresAt, createdAt: sql`now()` },
    });
}

// Read every import-chunk marker and return a map of chunkKey -> createdAt, so
// the rolling refresh and status report can reason about per-chunk data age
// without a query per chunk.
async function getChunkMarkers(): Promise<Map<string, Date>> {
  const rows = await db
    .select({
      key: overpassCacheTable.key,
      createdAt: overpassCacheTable.createdAt,
    })
    .from(overpassCacheTable)
    .where(like(overpassCacheTable.key, `${CHUNK_MARKER_PREFIX}%`));
  const map = new Map<string, Date>();
  for (const r of rows) {
    map.set(r.key.slice(CHUNK_MARKER_PREFIX.length), r.createdAt);
  }
  return map;
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
// Falls back to live Overpass if the dataset is still being imported,
// or if the requested area contains too few nodes to route reliably.
// The global-count threshold can be overridden via env (used by tests to make
// the dataset path deterministic regardless of shared-DB import progress).
function minNodeCountForRouting(): number {
  const raw = process.env.DATASET_MIN_NODE_COUNT;
  if (raw !== undefined && raw.trim().length > 0) {
    const parsed = Number(raw);
    if (Number.isFinite(parsed) && parsed >= 0) return parsed;
  }
  return DATASET_MIN_NODE_COUNT;
}

export async function getNetworkForRoute(bbox: Bbox): Promise<OverpassResult> {
  const totalNodes = await db
    .select({ count: sql<number>`count(*)` })
    .from(networkNodesTable);

  const minCount = minNodeCountForRouting();
  if (totalNodes[0].count < minCount) {
    logger.debug(
      { dbCount: totalNodes[0].count, threshold: minCount },
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

  // If the requested area contains no nodes/segments, we are outside the
  // pre-loaded region. Fall back to live Overpass so the user can still
  // plan routes.
  if (nodeRows.length < 2 || segRows.length < 1) {
    logger.debug(
      { nodes: nodeRows.length, segs: segRows.length, bbox },
      "Sparse dataset coverage for this bbox, falling back to live Overpass",
    );
    return fetchOverpass(bbox);
  }

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
    if (ids.length < 2) continue;
    ways.push({ id: Number(r.id), nodes: ids });

    // The dataset only stores numbered knooppunten as node rows, but the
    // router needs every intermediate way node to build graph edges. The
    // segment's nodeIds run parallel to its coordinates ([lon, lat]), so the
    // intermediate nodes can be reconstructed from the stored geometry.
    const coords = r.coordinates as number[][];
    const count = Math.min(ids.length, coords.length);
    for (let i = 0; i < count; i++) {
      const id = ids[i];
      if (nodes.has(id)) continue;
      const [lon, lat] = coords[i];
      nodes.set(id, { id, lat, lon });
    }
  }

  return { nodes, ways };
}

export interface NodeInsert {
  id: string;
  ref: string;
  lat: number;
  lon: number;
}

export interface SegmentInsert {
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
          nodeIds: sql`excluded.node_ids`,
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

// Keep only nodes whose OSM ID appears in at least one segment's nodeIds.
// A node with an rcnRef tag but no connecting way exists in OSM but is absent
// from the routing graph, so advertising it as a clickable marker would lead
// to "Could not locate node" 422 errors. Exported for unit testing.
export function filterRoutableNodes(
  nodeRows: NodeInsert[],
  segRows: SegmentInsert[],
): NodeInsert[] {
  const routableIds = new Set<number>();
  for (const seg of segRows) {
    for (const nid of seg.nodeIds) {
      routableIds.add(nid);
    }
  }
  return nodeRows.filter((n) => routableIds.has(Number(n.id)));
}

// Remove any network_nodes row whose OSM node ID does not appear in any stored
// segment's nodeIds. These orphan markers exist in OSM with an rcnRef tag but
// are not part of any route=bicycle relation way, so they look clickable on the
// map but cannot be routed. Calling this once at startup and after each full
// import ensures the dataset stays consistent with the routing graph.
async function pruneNonRoutableNodes(): Promise<void> {
  try {
    // Guard: an empty network_segments table would make the subquery return
    // the empty set, and "NOT IN (empty set)" is always false → every node
    // would survive. More importantly, if we have no segments at all we cannot
    // distinguish routable from non-routable anyway, so skip.
    const segCount = await db
      .select({ count: sql<number>`count(*)` })
      .from(networkSegmentsTable);
    if (Number(segCount[0]?.count ?? 0) === 0) return;

    const pruned = await db
      .delete(networkNodesTable)
      .where(
        sql`${networkNodesTable.id}::integer NOT IN (
          SELECT DISTINCT unnest(node_ids) FROM network_segments
        )`,
      )
      .returning({ id: networkNodesTable.id });

    if (pruned.length > 0) {
      logger.info(
        { deleted: pruned.length },
        "Pruned non-routable nodes from dataset",
      );
    }
  } catch (err) {
    logger.warn({ err }, "Failed to prune non-routable nodes, skipping");
  }
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

  // Only store nodes that are part of at least one routing way — standalone
  // rcnRef nodes (no connecting way) are not graph vertices and cannot be routed.
  const routableNodeRows = filterRoutableNodes(nodeRows, segRows);
  if (routableNodeRows.length > 0) await upsertNodes(routableNodeRows);
  if (segRows.length > 0) await upsertSegments(segRows);

  // Prune nodes in this chunk that weren't seen — they were removed from OSM.
  const pruned = await pruneChunkNodes(chunk, importStart);
  if (pruned > 0) {
    logger.info({ chunk, pruned }, "Pruned stale nodes from chunk");
  }

  // Record success so a restarted import can skip this chunk.
  await markChunkFresh(chunk);

  return { nodes: routableNodeRows.length, segs: segRows.length };
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
  let skipped = 0;
  let failed = 0;
  let nodeCount = 0;
  let segCount = 0;
  const importStart = new Date();
  logger.info({ chunks: chunks.length }, "Starting network dataset import");

  try {
    for (const chunk of chunks) {
      try {
        // Resume support: skip chunks already imported recently (marker in
        // the persistent cache), so a restart doesn't redo the whole region.
        if (await isChunkFresh(chunk)) {
          failedChunks.delete(chunkKey(chunk));
          skipped++;
          continue;
        }
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
    // every chunk was actually re-imported in this pass (no coverage holes
    // from failed or skipped chunks whose segments weren't touched).
    if (failed === 0 && skipped === 0) {
      const prunedSegs = await pruneStaleSegments(importStart);
      if (prunedSegs > 0) {
        logger.info({ prunedSegs }, "Pruned stale segments after full import");
      }
      // One-time cleanup of any pre-existing non-routable nodes that were
      // stored before this filter was introduced. Per-chunk filtering in
      // importChunk handles future imports; this catches the existing backlog.
      await pruneNonRoutableNodes();
    }

    // Safety net: if every chunk was skipped because of fresh markers but the
    // dataset is still incomplete (e.g., tables were cleared while markers
    // survived), the markers are lying — drop them so the next pass actually
    // re-imports instead of skipping forever.
    if (failed === 0 && imported === 0 && skipped > 0) {
      if (await isDatasetIncomplete()) {
        logger.warn(
          "Dataset incomplete despite fresh chunk markers, clearing markers",
        );
        await db
          .delete(overpassCacheTable)
          .where(like(overpassCacheTable.key, `${CHUNK_MARKER_PREFIX}%`));
      }
    }

    // Force the next readiness probe to re-read now that rows exist.
    readyCache = null;
  } finally {
    importing = false;
  }

  logger.info(
    { imported, skipped, failed, nodeCount, segCount },
    "Network dataset import complete",
  );
  await logDatasetStatus("import-complete");
}

// Retry only the chunks that failed during the last import pass. Runs on a
// short interval so coverage gaps from Overpass outages heal within an hour
// rather than waiting for the next full weekly re-import.
//
// If there are no recorded failed chunks (e.g., after a restart wiped the
// in-memory list) but the dataset is still incomplete, kick off a full
// re-import instead — otherwise a degraded dataset would sit unrepaired
// until the next 24h staleness check.
async function retryFailedChunks(): Promise<void> {
  if (importing) return;

  if (failedChunks.size === 0) {
    if (await isDatasetIncomplete()) {
      logger.info(
        "Dataset incomplete with no failed chunks recorded, re-importing",
      );
      await importNetworkDataset();
    }
    return;
  }

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

// Rolling refresh: re-import the single oldest chunk so that, over time, every
// part of the dataset is refreshed on a rolling window without a heavy full
// re-import. Skips entirely while a full import/retry is running (so it never
// competes for the single Overpass slot) and while the dataset is still being
// built (the full import + retry loops own that phase). Only touches a chunk
// once its data is older than ROLLING_REFRESH_MIN_AGE_MS.
async function refreshOldestChunk(): Promise<void> {
  if (importing) return;

  try {
    // Don't roll while the dataset is still incomplete — the full import and
    // failed-chunk retry loops are responsible for getting it whole first.
    if (await isDatasetIncomplete()) return;

    const markers = await getChunkMarkers();
    const now = Date.now();

    // Pick the oldest chunk. A chunk with no marker (never imported, or its
    // marker was swept) is treated as maximally old so it gets refreshed first.
    let oldest: Bbox | null = null;
    let oldestAge = -1;
    for (const chunk of chunkBboxes()) {
      const marker = markers.get(chunkKey(chunk));
      const age = marker ? now - marker.getTime() : Number.MAX_SAFE_INTEGER;
      if (age > oldestAge) {
        oldestAge = age;
        oldest = chunk;
      }
    }

    if (!oldest || oldestAge < ROLLING_REFRESH_MIN_AGE_MS) {
      logger.debug(
        { oldestAgeHours: Math.round(oldestAge / 3_600_000) },
        "Rolling refresh: no chunk old enough yet",
      );
      return;
    }

    const target = oldest;
    logger.info(
      {
        chunk: target,
        ageHours:
          oldestAge === Number.MAX_SAFE_INTEGER
            ? null
            : Math.round(oldestAge / 3_600_000),
      },
      "Rolling refresh: re-importing oldest network chunk",
    );
    const refreshStart = new Date();
    try {
      const result = await importChunk(target, refreshStart);
      logger.info(
        { chunk: target, nodes: result.nodes, segs: result.segs },
        "Rolling refresh: chunk re-imported",
      );
      readyCache = null;
    } catch (err) {
      // Record it so the fast failed-chunk retry loop picks it up too.
      failedChunks.set(chunkKey(target), target);
      logger.warn(
        { err, chunk: target },
        "Rolling refresh: chunk re-import failed",
      );
    }
  } catch (err) {
    logger.warn({ err }, "Rolling refresh check failed");
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

// A dataset is incomplete if the node count is clearly below the expected full
// NL+BE network size (~8,000+). This catches aborted imports (e.g., server
// restart mid-import) where the data is "fresh" but not full.
const DATASET_INCOMPLETE_THRESHOLD = 6000;

async function isDatasetIncomplete(): Promise<boolean> {
  try {
    const rows = await db
      .select({ count: sql<number>`count(*)` })
      .from(networkNodesTable);
    return rows[0].count < DATASET_INCOMPLETE_THRESHOLD;
  } catch (err) {
    logger.warn({ err }, "Dataset completeness check failed");
    return false;
  }
}

// A point-in-time snapshot of the local dataset: how big it is, how old its
// freshest and stalest data are, and how much of the grid has been imported.
// Powers the /network/status health field and the periodic status log so the
// dataset's age and coverage are observable at a glance.
export interface DatasetStatus {
  // Whether any rows exist (dataset can serve at all).
  ready: boolean;
  // Whether the dataset has enough nodes to be considered fully imported.
  complete: boolean;
  // Whether a full import is currently running.
  refreshing: boolean;
  nodeCount: number;
  segmentCount: number;
  // Total chunks in the NL+BE grid and how many currently have a fresh marker.
  chunkCount: number;
  importedChunkCount: number;
  // ISO timestamps of the stalest and freshest node rows, or null if empty.
  oldestDataAt: string | null;
  newestDataAt: string | null;
  // Age of the stalest node row in hours, or null if empty. This is the key
  // freshness signal: it's the worst-case staleness anywhere in the dataset.
  oldestDataAgeHours: number | null;
}

export async function getDatasetStatus(): Promise<DatasetStatus> {
  let nodeCount = 0;
  let segmentCount = 0;
  let oldest: Date | null = null;
  let newest: Date | null = null;
  let importedChunkCount = 0;

  try {
    const nodeAgg = await db
      .select({
        count: sql<number>`count(*)`,
        min: sql<string | null>`min(${networkNodesTable.updatedAt})`,
        max: sql<string | null>`max(${networkNodesTable.updatedAt})`,
      })
      .from(networkNodesTable);
    nodeCount = Number(nodeAgg[0]?.count ?? 0);
    oldest = nodeAgg[0]?.min ? new Date(nodeAgg[0].min) : null;
    newest = nodeAgg[0]?.max ? new Date(nodeAgg[0].max) : null;

    const segAgg = await db
      .select({ count: sql<number>`count(*)` })
      .from(networkSegmentsTable);
    segmentCount = Number(segAgg[0]?.count ?? 0);

    const now = Date.now();
    const markers = await getChunkMarkers();
    for (const createdAt of markers.values()) {
      if (createdAt.getTime() > now - STALE_MS) importedChunkCount++;
    }
  } catch (err) {
    logger.warn({ err }, "Dataset status query failed");
  }

  const oldestDataAgeHours =
    oldest !== null
      ? Math.round(((Date.now() - oldest.getTime()) / 3_600_000) * 10) / 10
      : null;

  return {
    ready: nodeCount > 0,
    complete: nodeCount >= DATASET_INCOMPLETE_THRESHOLD,
    refreshing: importing,
    nodeCount,
    segmentCount,
    chunkCount: CHUNK_COUNT,
    importedChunkCount,
    oldestDataAt: oldest?.toISOString() ?? null,
    newestDataAt: newest?.toISOString() ?? null,
    oldestDataAgeHours,
  };
}

// Emit a single log line summarizing dataset age and coverage. Called after
// imports and rolling refreshes so the dataset's freshness is visible in logs
// even without hitting the status endpoint.
async function logDatasetStatus(context: string): Promise<void> {
  const status = await getDatasetStatus();
  logger.info({ ...status, context }, "Network dataset status");
}

async function maybeImport(): Promise<void> {
  try {
    const stale = await isDatasetStale();
    const incomplete = await isDatasetIncomplete();
    if (stale || incomplete) {
      if (incomplete && !stale) {
        logger.info(
          { incomplete },
          "Dataset incomplete, forcing re-import",
        );
      }
      await importNetworkDataset();
    } else {
      logger.debug("Network dataset is fresh and complete, skipping import");
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
    // Clean up any non-routable nodes that were stored before the per-chunk
    // filter was introduced. Runs regardless of whether a fresh import fires,
    // so nodes that slipped in through a previous server version are evicted
    // within STARTUP_DELAY_MS of the first boot after this change is deployed.
    void pruneNonRoutableNodes();
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

  // Rolling refresh: continuously re-import the oldest chunk so the dataset
  // never drifts far from OSM without a heavy full re-import. Runs on its own
  // cadence derived from the grid size and STALE_MS.
  const rolling = setInterval(() => {
    void refreshOldestChunk();
  }, ROLLING_REFRESH_INTERVAL_MS);
  rolling.unref();

  logger.info(
    {
      rollingRefreshIntervalMin: Math.round(
        ROLLING_REFRESH_INTERVAL_MS / 60_000,
      ),
      chunkCount: CHUNK_COUNT,
    },
    "Network dataset rolling refresh scheduled",
  );
}
