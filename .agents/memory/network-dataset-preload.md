---
name: Preloaded NL+BE network dataset
description: Why the cycling node network is stored locally and how serving falls back to live Overpass
---

The full NL+BE cycling node network (rcn) is preloaded into durable Postgres
tables (`network_nodes`, `network_segments`) separate from the short-lived
`overpass_cache`. Serving prefers this dataset (one indexed bbox query, instant,
covers a large viewport) and only falls back to the live per-tile Overpass path
when the dataset is empty (not yet imported) or a query throws.

**Why:** Live per-tile Overpass fetches on every pan were slow and the small
area cap only showed a tiny cluster when zoomed out. Local serving mirrors
fietsknooppunt.app's instant panning.

**How to apply:**
- Readiness is probed cheaply (`SELECT 1 ... LIMIT 1`) and cached ~30s; don't
  add a per-request count.
- Two area/size guards differ on purpose: dataset path allows a much larger
  viewport (DATASET_MAX_AREA_DEG2) than the live path (MAX_AREA_DEG2 0.36), plus
  a node-count cap that returns `truncated:true`.
- Importer walks NL+BE in ~0.5° chunks, resilient per-chunk (a failed Overpass
  chunk is logged and skipped). Upserts use `excluded.*` so batch conflicts keep
  each row's own values. Refreshes on startup-if-stale (7d) + daily check.
- Disable the whole preloader with env `DISABLE_NETWORK_PRELOAD=true`.
- The import only populates when Overpass is reachable; outages leave the table
  empty and the endpoint on the live fallback (which also fails during an
  outage — that's external, not a code bug).
