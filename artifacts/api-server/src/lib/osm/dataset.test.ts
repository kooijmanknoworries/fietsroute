import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { inArray, like, or } from "drizzle-orm";
import {
  db,
  networkNodesTable,
  networkSegmentsTable,
  overpassCacheTable,
  pool,
} from "@workspace/db";
import {
  filterRoutableNodes,
  getNetworkForRoute,
  getNetworkFromDataset,
  isDatasetReady,
} from "./dataset";
import { getNetworkData } from "./network";
import type { Bbox } from "./overpass";

// Use a far-away region (Spain-ish) so these rows never overlap the NL/BE
// fixtures other suites exercise.
const IN_NODE_ID = "900000001";
const OUT_NODE_ID = "900000002";
const IN_SEG_ID = "900000101";
const OUT_SEG_ID = "900000102";

// Routing fixture: two numbered knooppunten connected by a segment that also
// passes through an intermediate (un-numbered) way node.
const ROUTE_NODE_A = "900000003";
const ROUTE_NODE_B = "900000004";
const ROUTE_MID_ID = 900000005;
const ROUTE_SEG_ID = "900000103";

const NODE_IDS = [IN_NODE_ID, OUT_NODE_ID, ROUTE_NODE_A, ROUTE_NODE_B];
const SEG_IDS = [IN_SEG_ID, OUT_SEG_ID, ROUTE_SEG_ID];

const VIEW: Bbox = { minLon: 1.0, minLat: 40.0, maxLon: 1.2, maxLat: 40.2 };

async function cleanup(): Promise<void> {
  await db.delete(networkNodesTable).where(inArray(networkNodesTable.id, NODE_IDS));
  await db
    .delete(networkSegmentsTable)
    .where(inArray(networkSegmentsTable.id, SEG_IDS));
}

beforeAll(async () => {
  await cleanup();
  await db.insert(networkNodesTable).values([
    { id: IN_NODE_ID, ref: "11", lat: 40.1, lon: 1.1 },
    { id: OUT_NODE_ID, ref: "12", lat: 41.5, lon: 1.1 },
    { id: ROUTE_NODE_A, ref: "21", lat: 40.3, lon: 1.3 },
    { id: ROUTE_NODE_B, ref: "22", lat: 40.3, lon: 1.34 },
  ]);
  await db.insert(networkSegmentsTable).values([
    {
      id: IN_SEG_ID,
      coordinates: [
        [1.05, 40.05],
        [1.15, 40.15],
      ],
      minLat: 40.05,
      maxLat: 40.15,
      minLon: 1.05,
      maxLon: 1.15,
    },
    {
      id: OUT_SEG_ID,
      coordinates: [
        [1.05, 41.4],
        [1.15, 41.6],
      ],
      minLat: 41.4,
      maxLat: 41.6,
      minLon: 1.05,
      maxLon: 1.15,
    },
    {
      id: ROUTE_SEG_ID,
      coordinates: [
        [1.3, 40.3],
        [1.32, 40.3],
        [1.34, 40.3],
      ],
      nodeIds: [Number(ROUTE_NODE_A), ROUTE_MID_ID, Number(ROUTE_NODE_B)],
      minLat: 40.3,
      maxLat: 40.3,
      minLon: 1.3,
      maxLon: 1.34,
    },
  ]);
});

afterAll(async () => {
  await cleanup();
  await pool.end();
});

describe("network dataset", () => {
  it("reports ready when rows exist", async () => {
    expect(await isDatasetReady()).toBe(true);
  });

  it("returns only nodes and segments inside the viewport bbox", async () => {
    const data = await getNetworkFromDataset(VIEW);
    expect(data.truncated).toBe(false);
    const nodeIds = data.nodes.map((n) => n.id);
    expect(nodeIds).toContain(IN_NODE_ID);
    expect(nodeIds).not.toContain(OUT_NODE_ID);
    const segIds = data.segments.map((s) => s.id);
    expect(segIds).toContain(IN_SEG_ID);
    expect(segIds).not.toContain(OUT_SEG_ID);
  });

  it("reconstructs intermediate way nodes for routing from segment geometry", async () => {
    const prev = process.env.DATASET_MIN_NODE_COUNT;
    process.env.DATASET_MIN_NODE_COUNT = "0";
    try {
      const data = await getNetworkForRoute({
        minLon: 1.25,
        minLat: 40.25,
        maxLon: 1.4,
        maxLat: 40.35,
      });
      const way = data.ways.find((w) => w.id === Number(ROUTE_SEG_ID));
      expect(way).toBeDefined();
      expect(way?.nodes).toEqual([
        Number(ROUTE_NODE_A),
        ROUTE_MID_ID,
        Number(ROUTE_NODE_B),
      ]);
      // The intermediate node is not stored as a numbered knooppunt, so it
      // must be rebuilt from the segment's coordinates for graph edges to form.
      const mid = data.nodes.get(ROUTE_MID_ID);
      expect(mid).toBeDefined();
      expect(mid?.lon).toBeCloseTo(1.32);
      expect(mid?.lat).toBeCloseTo(40.3);
      expect(mid?.rcnRef).toBeUndefined();
      // Numbered endpoints keep their refs.
      expect(data.nodes.get(Number(ROUTE_NODE_A))?.rcnRef).toBe("21");
    } finally {
      if (prev === undefined) delete process.env.DATASET_MIN_NODE_COUNT;
      else process.env.DATASET_MIN_NODE_COUNT = prev;
    }
  });

  it("serves from the dataset without hitting live Overpass", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new Error("live Overpass must not be called"));
    try {
      const data = await getNetworkData(VIEW);
      expect(data.nodes.map((n) => n.id)).toContain(IN_NODE_ID);
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it("live Overpass path excludes rcnRef nodes not connected to any way", async () => {
    // Use a distinct tile (lon 2.x) that doesn't share the in-memory L1 cache
    // with the adjacent hole-viewport test which uses lon 1.5.
    const filterBbox: Bbox = {
      minLon: 2.0,
      minLat: 41.0,
      maxLon: 2.05,
      maxLat: 41.05,
    };
    await db
      .delete(overpassCacheTable)
      .where(like(overpassCacheTable.key, "2.0%"));
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          elements: [
            // node 888001 is in way 888100 → routable, must be returned
            { type: "node", id: 888001, lat: 41.02, lon: 2.02, tags: { rcn_ref: "88" } },
            { type: "node", id: 888002, lat: 41.03, lon: 2.03 },
            { type: "way", id: 888100, nodes: [888001, 888002] },
            // node 888999 has rcn_ref but is NOT in any way → non-routable, must be absent
            { type: "node", id: 888999, lat: 41.04, lon: 2.04, tags: { rcn_ref: "99" } },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ) as Response,
    );
    try {
      const data = await getNetworkData(filterBbox);
      const ids = data.nodes.map((n) => n.id);
      expect(ids).toContain("888001");
      expect(ids).not.toContain("888999");
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it("falls back to live Overpass for an empty (hole) viewport even when ready", async () => {
    // A small viewport in a region with no dataset rows: the dataset is "ready"
    // (rows exist elsewhere) but returns empty, so we must hit live Overpass.
    const holeBbox: Bbox = {
      minLon: 1.5,
      minLat: 40.5,
      maxLon: 1.55,
      maxLat: 40.55,
    };
    // The live path uses fetchOverpassTiles, which reads a persistent Postgres
    // cache that survives across test runs. Clear this region's cached tiles so
    // the live fetch is actually issued and the assertion is deterministic.
    await db
      .delete(overpassCacheTable)
      .where(or(like(overpassCacheTable.key, "1.4%"), like(overpassCacheTable.key, "1.5%")));
    const liveElements = [
      { type: "node", id: 777001, lat: 40.52, lon: 1.52, tags: { rcn_ref: "77" } },
      // 777002 is an intermediate (un-numbered) way node needed to make 777001 routable.
      { type: "node", id: 777002, lat: 40.53, lon: 1.53 },
      { type: "way", id: 777100, nodes: [777001, 777002] },
    ];
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ elements: liveElements }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }) as Response,
    );
    try {
      const data = await getNetworkData(holeBbox);
      expect(fetchSpy).toHaveBeenCalled();
      expect(data.nodes.map((n) => n.id)).toContain("777001");
    } finally {
      fetchSpy.mockRestore();
    }
  });
});

describe("filterRoutableNodes", () => {
  it("keeps nodes whose ID appears in at least one segment's nodeIds", () => {
    const nodeRows = [
      { id: "1", ref: "1", lat: 52.0, lon: 5.0 },
      { id: "2", ref: "2", lat: 52.1, lon: 5.1 },
    ];
    const segRows = [
      {
        id: "100",
        coordinates: [],
        nodeIds: [1, 99],
        minLat: 52.0,
        maxLat: 52.1,
        minLon: 5.0,
        maxLon: 5.1,
      },
    ];
    const result = filterRoutableNodes(nodeRows, segRows);
    expect(result.map((n) => n.id)).toEqual(["1"]);
  });

  it("excludes an rcnRef node that appears in no way (standalone marker)", () => {
    const nodeRows = [{ id: "63", ref: "63", lat: 52.0, lon: 5.0 }];
    const result = filterRoutableNodes(nodeRows, []);
    expect(result).toHaveLength(0);
  });

  it("returns all nodes when every node appears in a segment", () => {
    const nodeRows = [
      { id: "1", ref: "1", lat: 52.0, lon: 5.0 },
      { id: "2", ref: "2", lat: 52.1, lon: 5.1 },
    ];
    const segRows = [
      {
        id: "100",
        coordinates: [],
        nodeIds: [1, 2, 99],
        minLat: 52.0,
        maxLat: 52.1,
        minLon: 5.0,
        maxLon: 5.1,
      },
    ];
    const result = filterRoutableNodes(nodeRows, segRows);
    expect(result).toHaveLength(2);
  });

  it("returns empty when there are no nodes", () => {
    const result = filterRoutableNodes([], []);
    expect(result).toHaveLength(0);
  });
});
