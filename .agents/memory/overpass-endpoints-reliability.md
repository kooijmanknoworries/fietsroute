---
name: Overpass endpoint reliability
description: Which Overpass mirrors work from this environment and client-side rules to avoid aborts/429s
---

Observed from this environment (verified during full NL/BE import):

- `overpass.kumi.systems` — hangs/times out from this env; keep low priority or skip.
- `overpass-api.de` — works but intermittently returns 429/504 under load.
- `maps.mail.ru/osm/tools/overpass/api/interpreter` — fast full-planet mirror, reliable; good second endpoint.
- `overpass.openstreetmap.fr` — whitelist-only, always 403; do NOT use.

Client rules:
- The HTTP client timeout must exceed the query's `[timeout:N]` (e.g. query 30s → client ≥35s), or slow-but-valid responses get aborted.
- Serialize ALL Overpass requests through a single global slot — importer, tile warmer, and live requests running concurrently trip 429 rate limits.
- Retry up to 3 attempts with backoff across endpoints; log non-OK statuses.

**Why:** the bulk import repeatedly stalled/failed until these rules were applied.
