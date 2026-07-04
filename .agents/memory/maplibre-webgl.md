---
name: MapLibre GL WebGL handling
description: How to initialize maplibre-gl robustly and why the screenshot tool shows a WebGL error.
---

# MapLibre GL + WebGL

- **`maplibregl.supported()` no longer exists in v4+.** Do not gate map init on it — it will be `undefined` and any `!maplibregl.supported()` check becomes always-true, breaking the real app.
  **How to apply:** wrap `new maplibregl.Map(...)` in try/catch and render a fallback message in the catch; the constructor throws synchronously when WebGL is unavailable.

- **No automated browser in this environment has WebGL** — both the screenshot/app_preview tool AND the Playwright `runTest`/testing subagent render the MapLibre WebGL-fallback message ("De interactieve kaart kon niet starten ... geen WebGL"). A literal "click two knooppunten on the map" e2e test is therefore infeasible here; the map never initializes so its canvas nodes can't be clicked. This is environment-only — the user's real browser (and the live preview iframe) has WebGL and renders fine. Do not chase it as an app bug, and don't try to satisfy a "browser click test" deliverable via runTest.
  **How to apply:** to guard a map-driven flow, exercise the underlying HTTP endpoint (e.g. `POST /api/route`) headlessly instead — see `dataset-routing-intermediate-nodes.md` and the live-dataset guard in `artifacts/api-server/src/routes/route.livedataset.test.ts`.

- **WebGL-less e2e can still verify the auth→API→data path.** The web Map's ctor catch now reports a fallback snapped bbox (initialBounds or Utrecht default) via onBboxChange, so `/api/network` still fetches when WebGL init fails; the Home sidebar shows a `data-testid="network-node-count"` indicator ("N knooppunten in beeld") only when nodes actually reached the UI.
  **How to apply:** runTest with `testClerkAuth: true` can sign in and assert the node count > 0 and no /api 401s — this catches a blank-map auth regression without needing marker pixels. Tell the test plan the WebGL error message is expected and non-blocking.

- **CyclOSM tiles (`tile-cyclosm.openstreetmap.fr`) are unreachable from the Replit environment** (connection times out, http 000) — the map shows a blank grey area with no base tiles even though WebGL works. Use standard OSM tiles instead: `https://{a,b,c}.tile.openstreetmap.org/{z}/{x}/{y}.png` (fast, ~80ms). Always include OSM attribution.
  **How to apply:** if a user reports "I don't see the map" but nodes/overlays would render, suspect the tile source, not WebGL — curl a tile with `--max-time` to check reachability before assuming WebGL.
