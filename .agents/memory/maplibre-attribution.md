---
name: MapLibre attribution gating by layer visibility
description: Whether MapLibre's default AttributionControl hides attribution for hidden base layers
---

MapLibre's default `AttributionControl` aggregates `source.attribution` only for sources whose `sourceCache.used` is true. `used` is recomputed each render: a source is used only if at least one layer referencing it is NOT hidden (`layer.isHidden(zoom)` returns true when `visibility === 'none'`, or zoom is outside min/maxzoom).

**Why:** When building a Map/Satellite base-layer toggle by stacking both raster layers and flipping `setLayoutProperty(id, 'visibility', ...)`, you do NOT need a custom attribution control. Setting the inactive base layer to `visibility: 'none'` automatically removes its attribution and shows only the active layer's. A code reviewer may flag this as a risk — it is correct for maplibre-gl v4.7.1 (verified in installed dist).

**How to apply:** Put each base source's `attribution` on the source, keep both layers in the style, toggle visibility. Attribution follows visibility for free. Only revisit if upgrading MapLibre changes this logic.
