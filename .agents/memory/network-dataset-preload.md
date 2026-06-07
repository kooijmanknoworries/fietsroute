---
name: Preloaded NL+BE network dataset
description: Why the cycling node network is stored locally and how serving falls back to live Overpass
---

The full NL+BE cycling node network (rcn) is preloaded into durable Postgres
tables, separate from the short-lived per-tile Overpass cache. Serving prefers
this dataset (one indexed bbox query, instant, large viewport) and falls back to
the live per-tile Overpass path when the dataset is empty or a query throws.

**Why:** Live per-tile Overpass fetches on every pan were slow, and the small
area cap only showed a tiny cluster when zoomed out. Local serving mirrors
fietsknooppunt.app's instant panning.

**How to apply:**
- A partially-imported dataset can have coverage holes (Overpass is flaky and the
  importer skips failed regions). Guard against it at request time: if the
  dataset path returns an *empty-but-untruncated* result, fall through to live so
  that region still loads. Don't assume "any rows exist" means full coverage.
- Two area guards differ on purpose: the dataset path allows a much larger
  viewport than the live path, plus a node-count cap that returns truncated.
- The importer must stay resilient per-region (one failed Overpass chunk must not
  abort the whole run) and idempotent (upserts), so re-runs heal gaps.
- The whole preloader is opt-out via env `DISABLE_NETWORK_PRELOAD=true`.
- Tests that exercise the live fallback must clear the persistent Postgres
  Overpass cache for the test region first — it survives across runs, so a stale
  cached tile makes "expect fetch called" flaky/order-dependent.

**Per-request fallback threshold:**
- The `getNetworkForRoute` function checks the global node count (needs ≥3000
  for dataset to be "ready"). Once ready, it also does a per-request check:
  if the queried bbox returns fewer than 2 nodes or 1 segment, it falls back to
  live Overpass. This covers coverage holes and routes outside the pre-loaded
  region.

**Upsert completeness:**
- When updating an existing segment on conflict, the `nodeIds` column must be
  included in the conflict `set` alongside `coordinates` and bounds, or the
  stored topology becomes stale when OSM ways are re-ordered.
