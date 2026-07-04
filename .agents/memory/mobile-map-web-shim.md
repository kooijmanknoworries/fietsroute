---
name: Mobile map web shim (Leaflet)
description: How the Expo mobile app renders a real map on web, and why the headless test harness can't validate it
---

# Mobile map on web = Leaflet shim, not react-native-maps

`react-native-maps` has no web implementation. `artifacts/mobile/metro.config.js` resolves
`react-native-maps` → `artifacts/mobile/shims/react-native-maps.web.tsx` **only on web**.
The shim implements the `react-native-maps` API surface (MapView/Marker/Polyline/UrlTile,
`animateToRegion`, `onRegionChangeComplete`) on top of **Leaflet** (DOM raster OSM tiles).

**Why Leaflet, not MapLibre:** Leaflet is DOM/`<img>`-tile based — no WebGL, no web workers —
so it bundles cleanly under Expo Metro web and renders in a plain browser. (The routeplanner web
app uses MapLibre/WebGL separately.)

**How the shim bridges the API:**
- `Marker`/`Polyline`/`UrlTile` are inert marker components; `MapView` reads them via
  `React.Children` and `child.type === Marker` reference equality, then reprojects with
  `map.latLngToContainerPoint` into an absolutely-positioned DOM overlay (divs for markers,
  one `<svg><polyline>` for the route). A `setTick` on Leaflet `move`/`zoom` forces reprojection.
- `Region` ↔ Leaflet: `animateToRegion` → `flyToBounds(regionToBounds)` (duration is **ms→s**);
  `onRegionChangeComplete` fires on `moveend`/`zoomend` with a Region computed from `getBounds()`.
- `import "leaflet/dist/leaflet.css"` — Expo SDK 54 Metro supports CSS imports on web; the shim is
  web-only so this never loads on native or under vitest.

**Why the earlier grey-box stub broke everything:** it was a no-op View, so `animateToRegion` did
nothing (place search appeared dead) and no pan/zoom events ever fired, so `showNodes` never
flipped true → knooppunten never loaded and the "Zoom in voor knooppunten" hint never cleared.
A single real-map fix resolves all of: place search, node loading, and saved-route reopen (which
now draws the polyline + node markers instead of looking like a bare save panel).

**Testing limitation (important):** the `runTest` Playwright harness cannot validate this.
It defaults to `/` (the routeplanner MapLibre app) whose headless browser has no WebGL → shows the
Dutch fallback "...geen WebGL ondersteunt" (`artifacts/routeplanner/src/lib/i18n.tsx`). Even
pointed at the Expo domain (`$REPLIT_EXPO_DEV_DOMAIN`, an `*.expo.picard.replit.dev` host) it kept
landing on the routeplanner. **Verify the mobile map with the `screenshot` app_preview tool**
(artifact_dir_name `mobile`) — a real browser renders Leaflet fine — plus curl the data endpoints
(`/api/geocode?q=`, `/api/network?bbox=`) on the api-server (port 8080).
