---
name: Overpass API usage
description: Practical constraints when fetching OpenStreetMap data via the Overpass API from a Node server.
---

# Overpass API

Used for the cycling node network (knooppunten) data — no API key required.

- **User-Agent is mandatory.** Node's global `fetch` sends a minimal/empty UA and Overpass responds `406 Not Acceptable`. Always send a descriptive `User-Agent` header (and `Accept: application/json`).
  **Why:** observed 406 from both `overpass-api.de` and via curl until a UA was set.
  **How to apply:** any server-side Overpass `fetch` must set headers.

- **Guard the query area.** Overpass cost/latency scales with bbox size (query timeout ~90s). Cap the bbox area before querying (network read caps at ~0.25 deg²; routing caps the selected-node bounding bbox at ~1.0 deg²) and return a typed error / `truncated` flag instead of issuing a giant query.

- **Use multiple endpoints as fallback** (e.g. overpass-api.de, overpass.kumi.systems) and cache results in-memory by rounded bbox key with a TTL.

- For the NL/BE node network: query `node["rcn_ref"]` plus `relation["network"="rcn"]["route"="bicycle"]`, then recurse-down (`(._;>;)`) and `out body` to get all member ways + node coords. Build the routing graph from way node sequences; rcn_ref nodes are the selectable knooppunten.
