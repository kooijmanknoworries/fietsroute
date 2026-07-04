---
name: Dataset routing needs intermediate way nodes
description: Why the preloaded-network routing path must reconstruct un-numbered way nodes from segment geometry
---

The `network_nodes` table stores only numbered knooppunten (nodes with `rcn_ref`), but the router builds graph edges between *consecutive way node IDs*, skipping any edge whose endpoint is missing from the node map.

**Rule:** when serving routing data from the preloaded dataset, intermediate (un-numbered) way nodes must be reconstructed from each segment's stored geometry — `node_ids` runs parallel to `coordinates` (`[lon, lat]` order) — or the graph ends up disconnected and every route fails with "Could not locate node X on the cycling network".

**Why:** this bug stayed hidden for a long time because the dataset node count was below the routing threshold, so routing silently fell back to live Overpass. Once the dataset became complete, routing switched to the dataset path and broke.

**How to apply:** any new consumer of `network_segments` that needs graph topology (not just rendering) must hydrate nodes from `node_ids` + `coordinates`, not just from `network_nodes`. Regression test lives in the dataset test suite ("reconstructs intermediate way nodes for routing").

**End-to-end guard:** `artifacts/api-server/src/routes/route.livedataset.test.ts` posts real nearby knooppunten (read live from the preloaded tables, NO Overpass mock, NO `DATASET_MIN_NODE_COUNT` override) to `POST /api/route` and requires a route whose polyline has ≥3 points — a trivial endpoint-only edge is rejected precisely because the regression leaves those intact. It skips (console.warn + return) when the dataset isn't loaded (< 3000 nodes), since prod then uses the Overpass fallback. This is the headless stand-in for the impossible browser click-test (no WebGL in any automated browser here).
