---
name: Elevation profile service
description: How route elevation profiles are fetched, cached, and tested
---
- Elevation endpoint samples routes to ≤200 points; providers: Open Topo Data eudem25m primary, Open-Meteo fallback; requests serialized with ~1.1s throttle slot.
- Results cached 180 days in Postgres `elevation_cache` under `elev:` + sha256 of sampled 5dp lat/lon. Tests must clear rows `LIKE 'elev:%'` or cached data shadows mocked fetch.
- Climb stats use 2m hysteresis to avoid noise inflating ascent.
- **Why:** free providers rate-limit hard; caching by sampled-coord hash makes repeat/saved-route views instant and provider-independent.
- Testing recharts in jsdom: stub `globalThis.ResizeObserver` or ResponsiveContainer throws an uncaught exception that unmounts the tree (empty body, confusing "element not found" errors).
- Cache read-back via jsonb reorders object keys — don't compare cached vs fresh responses with JSON.stringify equality.
