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

- **Never add `overpass.osm.ch` to the fallback list.** It only serves Switzerland and returns a valid-but-empty 200 for NL/BE bboxes.
  **Why:** during a de/kumi outage the fallback chain reached osm.ch, and its empty 200s were cached for 7 days, blanking the whole map. `overpass.openstreetmap.fr` is whitelist-only (returns "only available to white-listed usages").
  **How to apply:** treat empty Overpass results as suspect — never persist them to the Postgres cache; keep them only in a short (~5 min) in-memory TTL.

- **Isolated task environments can't reach overpass-api.de / kumi.systems** (connection refused from that egress IP; general internet works). Verify live-Overpass features via the persistent dataset/cache paths or mocks; a 502 on the live path there is environmental, not a code bug.

- For the NL/BE node network: query `node["rcn_ref"]` plus `relation["network"="rcn"]["route"="bicycle"]`, then recurse-down (`(._;>;)`) and `out body` to get all member ways + node coords. Build the routing graph from way node sequences; rcn_ref nodes are the selectable knooppunten.
