---
name: Nominatim geocoding usage
description: Constraints when geocoding place/municipality names via OpenStreetMap Nominatim from a Node server.
---

# Nominatim geocoding

Used for the "find a municipality (gemeente)" search — no API key required.

- **User-Agent is mandatory** (same lesson as Overpass). Node's global `fetch` sends a minimal UA; Nominatim's usage policy requires a descriptive `User-Agent`. Always set it.
- **Respect the 1 request/second policy.** Debounce the client-side query (~500ms) and cache results server-side (in-memory keyed by normalized query, long TTL) so typing doesn't hammer the endpoint.
  **Why:** Nominatim throttles/blocks abusive clients; place data is stable so caching is safe.
- **Filtering for places:** request `format=jsonv2&countrycodes=nl,be`, then keep results where `category` is `boundary` (administrative gemeente) or `place` (city/town/village) to drop streets/POIs. A gemeente like "De Ronde Venen" comes back as a `boundary/administrative` relation, not a single town.
- Each result includes `boundingbox` as `[south, north, west, east]` (strings) — fit the map to it (`fitBounds`) so the node network loads for that area.
