---
name: LF-routes overlay caching
description: How the LF-routes (ncn) overlay data is fetched and cached
---
LF long-distance routes (`network=ncn` route relations) are fetched with a single Overpass `out geom(bbox)` query (geometry inlined and clipped, no per-tile fan-out) and cached in the shared `overpass_cache` table under an `lf:`-prefixed key (per requested bbox, 7-day TTL, in-memory L1 in front).

**Why:** the same bbox holds different data for the knooppunten query vs the ncn relation query, so keys must be namespaced or the two would shadow each other.

**How to apply:** any new Overpass query kind sharing `overpass_cache` needs its own key prefix; tests must clear the prefixed rows (see `lf-routes.test.ts`) and use unique bboxes per test to dodge the module-level L1.
