---
name: Overpass persistent cache
description: How cycling-network Overpass results are cached persistently in Postgres
---
Overpass query results (cycling node network + bicycle route ways) are cached in a Postgres table `overpass_cache` (key, jsonb data, expires_at, created_at) in addition to an in-memory L1 Map.

**Lookup order in `fetchOverpass`:** in-memory → Postgres → live Overpass. On a DB hit the entry is rehydrated into the in-memory map; on a live fetch the result is written back to both layers.

**Why:** the in-memory cache was lost on every restart and the first load of each area took ~14s. The persistent layer makes repeat visits load in tens of milliseconds even after a restart, and shields the free Overpass service.

**How to apply:** TTL is 7 days (the rcn node network changes rarely). `OverpassResult.nodes` is a `Map`, so it is serialized to/from an array of nodes for jsonb storage. All DB calls are wrapped in try/catch so a DB outage degrades to live fetching rather than breaking the endpoint. Both `getNetworkData` and `planRoute` benefit since both route through `fetchOverpass`.
