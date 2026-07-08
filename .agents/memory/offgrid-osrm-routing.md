---
name: Offgrid OSRM routing
description: How offgrid (free-point) legs are routed and the constraints around the external OSRM router.
---

Offgrid legs (nodes with `kind: "free"`) are routed via the public FOSSGIS OSRM bike router (`routing.openstreetmap.de/routed-bike`), not the in-house node-network graph.

**Rules:**
- OSRM needs a descriptive User-Agent; requests are funneled through a single in-flight slot (public instances allow ~1 concurrent request per IP).
- OSRM signals "no route" as HTTP 400 with code `NoRoute`/`NoSegment` — that must map to a user-facing 422, not a server error.
- Results are cached in the shared `overpass_cache` table under an `osrm:` key prefix (7-day TTL) with an in-memory L1 — tests must clear `osrm:`-prefixed rows or the persistent cache shadows mocked fetch.
- The node-network graph is only fetched when at least one leg is network-mode; pure offgrid requests skip Overpass/dataset entirely.
- Legs carry an optional `mode` ("network"|"offgrid"); UIs render offgrid legs dashed amber (#d97706). GPX export is coordinates-only, so mixed routes need no GPX changes.

**Why:** avoids building/maintaining a full OSM routing graph; the demo router is rate-limited and failure-prone, hence caching + serialization + retry.
