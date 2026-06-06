---
name: Overpass persistent cache
description: How cycling-network Overpass results are cached persistently in Postgres
---
Overpass query results (cycling node network + bicycle route ways) are cached in a Postgres table `overpass_cache` (key, jsonb data, expires_at, created_at) in addition to an in-memory L1 Map.

**Lookup order in `fetchOverpass`:** in-memory → Postgres → live Overpass. On a DB hit the entry is rehydrated into the in-memory map; on a live fetch the result is written back to both layers.

**Why:** the in-memory cache was lost on every restart and the first load of each area took ~14s. The persistent layer makes repeat visits load in tens of milliseconds even after a restart, and shields the free Overpass service.

**How to apply:** TTL is 7 days (the rcn node network changes rarely). `OverpassResult.nodes` is a `Map`, so it is serialized to/from an array of nodes for jsonb storage. All DB calls are wrapped in try/catch so a DB outage degrades to live fetching rather than breaking the endpoint. Both `getNetworkData` and `planRoute` benefit since both route through `fetchOverpass`.

**Fresh-environment gotcha:** an isolated task environment's database may not have the `overpass_cache` table yet — symptom is repeated warn logs `relation "overpass_cache" does not exist` (the failed INSERT error dumps the full jsonb params, looking like a giant blob). Fix by running `pnpm --filter @workspace/db run push`. The try/catch hides it as warnings rather than failing requests, so it's easy to miss.

**Tile grid (critical for warming to work):** `getNetworkData` and the warmer must fetch the SAME grid-aligned tiles, or pre-warming is useless. The cache key is the exact request bbox rounded to 3 decimals, and a real viewport bbox (depends on screen size/zoom) almost never matches a synthetic per-region bbox. Fix: `fetchOverpassTiles(bbox)` splits any bbox into fixed `TILE_SIZE_DEG`-aligned tiles (`getTilesForBbox`), fetches/caches each tile via `fetchOverpass`, and merges. Both the request path and the warmer go through this, so warmed tiles are reused by any overlapping viewport. **Why:** code review rejected the first attempt that warmed one fixed bbox per region — verified the fix with a first-ever request to a warmer-only viewport returning in ~45ms vs ~2s cold.

**Cache warming:** `warmer.ts` collects the deduped set of grid tiles covering all `REGIONS` and warms them at startup (5s delay) + every 6h, force-refreshing tiles with <24h TTL left. `fetchOverpass(bbox, { forceRefresh })` bypasses both cache layers; `getPersistentCacheExpiry(bbox)` returns a tile's expiry (lets DB errors propagate so the warmer skips the tile instead of force-refreshing during a DB outage). `DISABLE_CACHE_WARMING=true` opts out.
