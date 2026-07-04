import { beforeAll, describe, expect, it } from "vitest";
import express, { type Express } from "express";
import request from "supertest";
import { and, gte, lte, sql } from "drizzle-orm";
import { db, networkNodesTable } from "@workspace/db";
import routeRouter from "./route";

// End-to-end regression guard for route planning against the REAL preloaded
// NL+BE dataset — the headless equivalent of the browser flow "open the map,
// click two knooppunten, see a drawn route with a distance".
//
// Why this exists and why it is separate from route.test.ts:
//   The dataset-routing path was silently broken for a long time (every route
//   returned 422 once the import completed). It stayed hidden because the unit
//   tests in route.test.ts mock Overpass and insert their own fixtures, and the
//   live-Overpass fallback masked the failure whenever the dataset was small.
//   This test does NEITHER — it hits the same POST /api/route endpoint the
//   planner UI calls, using genuine knooppunten read from the preloaded
//   network_nodes/network_segments tables, so a disconnected-graph regression
//   fails loudly here.
//
//   (A true in-browser click test isn't possible in CI: the map is a MapLibre
//   WebGL canvas and the automated browser/jsdom environments have no WebGL, so
//   the map never renders and its nodes can't be clicked. This exercises the
//   exact server code path that break would surface through.)

// Mirrors DATASET_MIN_NODE_COUNT in lib/osm/dataset.ts. Below this the router
// deliberately falls back to live Overpass, so the dataset path we want to
// guard isn't exercised — in that case we skip rather than fail.
const MIN_DATASET_NODES = 3000;

// A small, node-dense area (Leeuwarden, Friesland) well inside the preloaded
// region. Kept tiny so the selected knooppunten are close neighbours (very
// likely directly connected in a knooppunt network) and the route stays well
// under the planner's area cap.
const DENSE_BBOX = { minLat: 53.15, maxLat: 53.25, minLon: 5.7, maxLon: 5.9 };

// How many of the closest node pairs to try before giving up. If dataset
// routing is healthy a connected pair returns a real route quickly; if it is
// broken every intermediate-spanning pair 422s and the test fails with the
// collected reasons.
const MAX_PAIRS_TO_TRY = 24;

// A route that traverses real path geometry visits intermediate (un-numbered)
// way nodes, so its polyline has more than the two endpoint points. Requiring
// this is what makes the test catch the specific regression: dropping the
// intermediate-node rebuild disconnects every route that needs those nodes,
// leaving only trivial endpoint-to-endpoint edges — which we deliberately do
// NOT accept as proof that routing works.
const MIN_POLYLINE_POINTS = 3;

interface Node {
  id: string;
  ref: string;
  lat: number;
  lon: number;
}

function buildApp(): Express {
  const app = express();
  app.use(express.json());
  // pino-http normally attaches `req.log`; provide a no-op stand-in so the
  // error path can log without a full logging stack.
  app.use((req, _res, next) => {
    (req as unknown as { log: { error: () => void } }).log = {
      error: () => {},
    };
    next();
  });
  app.use("/api", routeRouter);
  return app;
}

function haversineMeters(
  aLat: number,
  aLon: number,
  bLat: number,
  bLon: number,
): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLon = toRad(bLon - aLon);
  const lat1 = toRad(aLat);
  const lat2 = toRad(bLat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// Build a list of distinct-node pairs sorted by how close they are, nearest
// first. Zero-distance pairs (two ids at the exact same spot) are dropped so a
// successful route always has real geometry to assert against.
function nearestPairs(nodes: Node[], maxPairs: number): [Node, Node][] {
  const pairs: { a: Node; b: Node; d: number }[] = [];
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const d = haversineMeters(
        nodes[i].lat,
        nodes[i].lon,
        nodes[j].lat,
        nodes[j].lon,
      );
      if (d <= 0) continue;
      pairs.push({ a: nodes[i], b: nodes[j], d });
    }
  }
  pairs.sort((x, y) => x.d - y.d);
  return pairs.slice(0, maxPairs).map((p) => [p.a, p.b] as [Node, Node]);
}

describe("POST /api/route (live preloaded dataset)", () => {
  let datasetNodes: Node[] = [];
  let datasetReady = false;

  beforeAll(async () => {
    const countRows = await db
      .select({ count: sql<number>`count(*)` })
      .from(networkNodesTable);
    if (Number(countRows[0].count) < MIN_DATASET_NODES) return;

    const rows = await db
      .select()
      .from(networkNodesTable)
      .where(
        and(
          gte(networkNodesTable.lat, DENSE_BBOX.minLat),
          lte(networkNodesTable.lat, DENSE_BBOX.maxLat),
          gte(networkNodesTable.lon, DENSE_BBOX.minLon),
          lte(networkNodesTable.lon, DENSE_BBOX.maxLon),
        ),
      )
      .limit(400);

    datasetNodes = rows.map((r) => ({
      id: r.id,
      ref: r.ref,
      lat: r.lat,
      lon: r.lon,
    }));
    datasetReady = datasetNodes.length >= 2;
  });

  it("plans a real route between two nearby knooppunten with a distance and a drawn polyline", async () => {
    if (!datasetReady) {
      // The preloaded dataset isn't present in this environment (e.g. a fresh
      // CI database), so production would fall back to live Overpass and the
      // dataset-routing path can't be meaningfully exercised. Skip loudly
      // instead of passing silently or failing spuriously.
      console.warn(
        "[route.livedataset] skipped: preloaded network dataset not present in this environment",
      );
      return;
    }

    const app = buildApp();
    const pairs = nearestPairs(datasetNodes, MAX_PAIRS_TO_TRY);
    expect(pairs.length).toBeGreaterThan(0);

    const failures: string[] = [];
    let trivialSuccesses = 0;
    let plan: { nodeRefs: string[]; coordinates: number[][]; distanceMeters: number } | null =
      null;

    for (const [a, b] of pairs) {
      const res = await request(app)
        .post("/api/route")
        .send({ nodes: [a, b] });
      if (res.status === 200) {
        const coords = res.body?.coordinates;
        // Only a route that visits intermediate way nodes proves the dataset
        // graph is properly connected. A bare endpoint-to-endpoint edge is not
        // enough — the regression leaves exactly those trivial edges intact.
        if (Array.isArray(coords) && coords.length >= MIN_POLYLINE_POINTS) {
          plan = res.body;
          break;
        }
        trivialSuccesses++;
        continue;
      }
      failures.push(
        `${a.ref}(${a.id}) -> ${b.ref}(${b.id}): HTTP ${res.status} ${
          res.body?.message ?? ""
        }`,
      );
    }

    // No pair produced a real multi-point route: the dataset graph is
    // disconnected across intermediate way nodes — exactly the regression this
    // test exists to catch. Fail with the collected reasons.
    if (!plan) {
      throw new Error(
        "Route planning against the preloaded dataset never produced a route " +
          `spanning intermediate nodes (${trivialSuccesses} trivial endpoint-only ` +
          "routes, the rest failed) — the routing graph is likely disconnected:\n" +
          failures.join("\n"),
      );
    }

    // A drawn route: a real distance and a multi-point polyline.
    expect(plan.distanceMeters).toBeGreaterThan(0);
    expect(Array.isArray(plan.coordinates)).toBe(true);
    expect(plan.coordinates.length).toBeGreaterThanOrEqual(2);
    expect(plan.nodeRefs.length).toBe(2);
  });
});
