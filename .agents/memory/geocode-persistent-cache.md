---
name: Geocode persistent cache
description: Municipality/geocode search results are cached in Postgres (geocode_cache) behind an in-memory L1, mirroring overpass_cache.
---

Nominatim municipality searches are cached two layers deep in `geocode.ts`:
- L1: in-memory `Map` keyed by normalized lowercased query (fast, wiped on restart).
- L2: Postgres `geocode_cache` table (`key`, `data` jsonb, `expires_at`, `created_at`), 24h TTL, survives restarts.

Read order in `searchMunicipalities`: L1 → L2 (rehydrates L1) → Nominatim (writes both). Expired L2 rows are deleted lazily on read; an hourly sweeper (`startGeocodeCacheSweeper`, started in `index.ts`) prunes them.

**Why:** in-memory-only cache was wiped on every restart/redeploy, so first search per query went back to rate-limited Nominatim. Same proven pattern as `overpass_cache`.

**How to apply:** schema lives in `@workspace/db` (`lib/db/src/schema/geocodeCache.ts`); after schema export changes run `pnpm --filter @workspace/db run push` and rebuild dist d.ts (`tsc -b lib/db/tsconfig.json`). The `/api/geocode` route uses query param `q` (not `query`).
