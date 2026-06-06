import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { inArray } from "drizzle-orm";
import { db, overpassCacheTable } from "@workspace/db";
import { type Bbox, fetchOverpassTiles, getTilesForBbox } from "./overpass";

// fetchOverpassTiles splits a viewport into 0.1deg tiles (getTilesForBbox),
// fetches each tile through fetchOverpass concurrently, then merges the results
// while de-duplicating nodes/ways that appear in more than one tile. The L1
// in-memory cache inside fetchOverpass is module-level and survives across tests
// in this file, so each test uses its own tile keys. These keys (10.x/50.x and
// 11.x/51.x) are far from the bboxes overpass.test.ts exercises (9.x/49.x) so
// the two suites never shadow each other.

// A 2-tile-wide viewport. ix = floor(10.05/0.1)..floor(10.15/0.1) = 100..101,
// iy = floor(50.05/0.1)..floor(50.09/0.1) = 500. -> tiles (100,500) and
// (101,500).
const MERGE_BBOX: Bbox = {
  minLon: 10.05,
  minLat: 50.05,
  maxLon: 10.15,
  maxLat: 50.09,
};
const MERGE_KEYS = [
  "10.000,50.000,10.100,50.100",
  "10.100,50.000,10.200,50.100",
];
// The Overpass query area string buildQuery emits for each merge tile, in the
// order `minLat,minLon,maxLat,maxLon`. The mock keys responses off this.
const MERGE_AREA_TILE0 = "50,10,50.1,10.1";
const MERGE_AREA_TILE1 = "50,10.1,50.1,10.2";

// A separate 2-tile viewport for the caching assertions so its keys never share
// the L1 cache with the merge test.
const CACHE_BBOX: Bbox = {
  minLon: 11.05,
  minLat: 51.05,
  maxLon: 11.15,
  maxLat: 51.09,
};
const CACHE_KEYS = [
  "11.000,51.000,11.100,51.100",
  "11.100,51.000,11.200,51.100",
];
const CACHE_AREA_TILE0 = "51,11,51.1,11.1";
const CACHE_AREA_TILE1 = "51,11.1,51.1,11.2";

const ALL_KEYS = [...MERGE_KEYS, ...CACHE_KEYS];

type Element = Record<string, unknown>;

// Pull the bbox out of the `node["rcn_ref"](...)` clause of the Overpass query
// so the mock can answer with tile-specific elements.
function extractArea(body: string): string {
  const decoded = decodeURIComponent(body);
  const m = decoded.match(/node\["rcn_ref"\]\(([^)]+)\)/);
  if (!m) throw new Error(`could not parse area from query: ${decoded}`);
  return m[1];
}

function mockTiles(elementsByArea: Record<string, Element[]>): {
  spy: ReturnType<typeof vi.fn>;
  requestedAreas: string[];
} {
  const requestedAreas: string[] = [];
  const spy = vi.fn(async (_input: unknown, init?: { body?: string }) => {
    const area = extractArea(init?.body ?? "");
    requestedAreas.push(area);
    const elements = elementsByArea[area];
    if (!elements) throw new Error(`unexpected area requested: ${area}`);
    return new Response(JSON.stringify({ elements }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });
  vi.spyOn(globalThis, "fetch").mockImplementation(spy as typeof fetch);
  return { spy, requestedAreas };
}

async function clearCache(): Promise<void> {
  await db
    .delete(overpassCacheTable)
    .where(inArray(overpassCacheTable.key, ALL_KEYS));
}

async function persistedKeys(keys: string[]): Promise<string[]> {
  const rows = await db
    .select({ key: overpassCacheTable.key })
    .from(overpassCacheTable)
    .where(inArray(overpassCacheTable.key, keys));
  return rows.map((r) => r.key).sort();
}

describe("fetchOverpassTiles merge and de-dup", () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    await clearCache();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await clearCache();
  });

  afterAll(async () => {
    await clearCache();
  });

  it("merges multiple tiles and de-duplicates shared nodes and ways", async () => {
    // Sanity: the viewport really does span more than one tile.
    expect(getTilesForBbox(MERGE_BBOX)).toHaveLength(2);

    // A node (500) and a way (5000) sit on the tile boundary and so are returned
    // by both tiles' Overpass responses. The merge must keep one copy of each.
    const SHARED_NODE_ID = 500;
    const SHARED_WAY_ID = 5000;
    const sharedNode: Element = {
      type: "node",
      id: SHARED_NODE_ID,
      lat: 50.05,
      lon: 10.1,
      tags: { rcn_ref: "50" },
    };
    const sharedWay: Element = {
      type: "way",
      id: SHARED_WAY_ID,
      nodes: [100, SHARED_NODE_ID],
    };

    const { spy, requestedAreas } = mockTiles({
      [MERGE_AREA_TILE0]: [
        { type: "node", id: 100, lat: 50.02, lon: 10.03, tags: { rcn_ref: "10" } },
        sharedNode,
        { type: "way", id: 1000, nodes: [100, SHARED_NODE_ID] },
        sharedWay,
      ],
      [MERGE_AREA_TILE1]: [
        { type: "node", id: 101, lat: 50.02, lon: 10.13, tags: { rcn_ref: "11" } },
        sharedNode,
        { type: "way", id: 1001, nodes: [101, SHARED_NODE_ID] },
        sharedWay,
      ],
    });

    const merged = await fetchOverpassTiles(MERGE_BBOX);

    // Each distinct tile is fetched exactly once (concurrency), no tile twice.
    expect(spy).toHaveBeenCalledTimes(2);
    expect([...requestedAreas].sort()).toEqual(
      [MERGE_AREA_TILE0, MERGE_AREA_TILE1].sort(),
    );

    // Nodes from both tiles are present; the shared node appears only once.
    expect([...merged.nodes.keys()].sort((a, b) => a - b)).toEqual([
      100, 101, SHARED_NODE_ID,
    ]);

    // Ways from both tiles are present; the shared way appears only once.
    const wayIds = merged.ways.map((w) => w.id).sort((a, b) => a - b);
    expect(wayIds).toEqual([1000, 1001, SHARED_WAY_ID]);
    expect(merged.ways.filter((w) => w.id === SHARED_WAY_ID)).toHaveLength(1);
  });

  it("caches each tile so a repeat viewport needs no further upstream fetches", async () => {
    expect(getTilesForBbox(CACHE_BBOX)).toHaveLength(2);

    const { spy } = mockTiles({
      [CACHE_AREA_TILE0]: [
        { type: "node", id: 110, lat: 51.02, lon: 11.03, tags: { rcn_ref: "10" } },
      ],
      [CACHE_AREA_TILE1]: [
        { type: "node", id: 111, lat: 51.02, lon: 11.13, tags: { rcn_ref: "11" } },
      ],
    });

    const first = await fetchOverpassTiles(CACHE_BBOX);
    // One upstream request per distinct tile on the cold path.
    expect(spy).toHaveBeenCalledTimes(2);
    expect([...first.nodes.keys()].sort((a, b) => a - b)).toEqual([110, 111]);

    // Per-tile persistent caching applies: both tile keys were written.
    expect(await persistedKeys(CACHE_KEYS)).toEqual([...CACHE_KEYS].sort());

    const second = await fetchOverpassTiles(CACHE_BBOX);
    // Second viewport is served entirely from cache: no new upstream calls.
    expect(spy).toHaveBeenCalledTimes(2);
    expect([...second.nodes.keys()].sort((a, b) => a - b)).toEqual([110, 111]);
  });
});
