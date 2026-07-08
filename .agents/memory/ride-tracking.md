---
name: Live ride tracking (visited segments)
description: Design constraints for the GPS ride-tracking + visited-segment history feature in routeplanner.
---

# Live ride tracking

- **MapLibre icons in jsdom**: register the lock/marker icon as a raw ImageData-like `{width,height,data:Uint8ClampedArray}` computed pixel-by-pixel, NOT via `<canvas>.getContext('2d')`. jsdom returns `null` for the 2D context, so a canvas-drawn icon silently breaks tests; hand-built RGBA runs identically in tests and real browsers.
  **Why:** Map.test.tsx uses a FakeMap with no `addImage`/`Marker`; any new map image or DOM marker must be guarded (`typeof m.addImage === "function"`, `typeof maplibregl.Marker === "function"`) or the headless test crashes.
  **How to apply:** when adding any symbol-layer icon or `maplibregl.Marker`, guard existence and prefer ImageData over canvas.

- **Segment identity** = canonical sorted pair of the two endpoint OSM node ids joined `a__b` (`segmentKeyFor`). Order-independent + globally unique, so a leg keeps the same key across rides/sessions and is safe to persist and dedupe on.
  **Why:** knooppunt refs are only locally unique and reused across the network; node ids are the only stable identity for a leg.

- **Persistence gating**: ride mode (GPS marker, recoloring, current-ride lock markers) works for everyone; fetching + saving permanent visited history is gated to signed-in users (Clerk userId as owner key, same pattern as saved routes). `useSaveVisitedSegments` uses `onConflictDoNothing` on unique `(owner_key, segment_key)`.

- **Screen-lock strategy**: rides hold an expo-keep-awake lock (tag `ride-tracking`, `lib/keep-awake.ts`) instead of background location — Expo Go has no background-location task support on iOS, and screen lock suspends the foreground watch + silences expo-speech. Release in stopRide, unmount cleanup, AND the plan-changed effect; UI must state the battery cost.
  **Why:** task-manager background updates need a dev build/config plugin unavailable in Expo Go; keep-awake is the only strategy that keeps GPS + TTS alive there.
  **How to apply:** any new code path that ends a ride must also release the keep-awake lock; tests mock `expo-keep-awake` via vitest alias.
