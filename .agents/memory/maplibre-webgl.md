---
name: MapLibre GL WebGL handling
description: How to initialize maplibre-gl robustly and why the screenshot tool shows a WebGL error.
---

# MapLibre GL + WebGL

- **`maplibregl.supported()` no longer exists in v4+.** Do not gate map init on it — it will be `undefined` and any `!maplibregl.supported()` check becomes always-true, breaking the real app.
  **How to apply:** wrap `new maplibregl.Map(...)` in try/catch and render a fallback message in the catch; the constructor throws synchronously when WebGL is unavailable.

- **The Replit screenshot/headless preview tool has no GPU/WebGL**, so a MapLibre app shows a "Could not create a WebGL context / Failed to initialize WebGL" runtime error in screenshots. This is environment-only — the user's real browser (and the live preview iframe) has WebGL and renders fine. Do not chase this as an app bug.

- Free no-key basemap for a cycling app: CyclOSM raster tiles `https://{s}.tile-cyclosm.openstreetmap.fr/cyclosm/{z}/{x}/{y}.png`, OSM standard tiles as fallback. Always include OSM attribution.
