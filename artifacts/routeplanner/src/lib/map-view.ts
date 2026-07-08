const STORAGE_KEY = "fietsrouteplanner.baseLayer";
const STREET_STYLE_KEY = "fietsrouteplanner.streetStyle";

export type BaseLayer = "map" | "satellite";

/**
 * The keyless street basemap "looks" a cyclist can pick between. Voyager/Light/
 * Dark are free CARTO raster styles; "osm" is the classic plain OpenStreetMap
 * raster. None need an API key or billing.
 */
export type StreetStyle = "voyager" | "positron" | "dark" | "osm";

export const STREET_STYLES: StreetStyle[] = ["voyager", "positron", "dark", "osm"];

/**
 * Returns the user's saved base-layer choice from localStorage, defaulting to
 * the standard street "map" view when nothing valid is stored.
 */
export function getBaseLayer(): BaseLayer {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === "map" || raw === "satellite") {
      return raw;
    }
    return "map";
  } catch {
    return "map";
  }
}

export function setBaseLayer(layer: BaseLayer): void {
  try {
    localStorage.setItem(STORAGE_KEY, layer);
  } catch {
    // ignore persistence errors (e.g. storage disabled)
  }
}

/**
 * Returns the user's saved street-style choice from localStorage, defaulting to
 * "osm" (classic OpenStreetMap) when nothing valid is stored.
 */
export function getStreetStyle(): StreetStyle {
  try {
    const raw = localStorage.getItem(STREET_STYLE_KEY);
    if (
      raw === "voyager" ||
      raw === "positron" ||
      raw === "dark" ||
      raw === "osm"
    ) {
      return raw;
    }
    return "osm";
  } catch {
    return "osm";
  }
}

/**
 * How many OSM tile-load failures we tolerate before warning the user that the
 * public OpenStreetMap tile servers appear overloaded. Kept small so a genuine
 * outage surfaces quickly, but above 1 so a single flaky tile doesn't nag.
 */
export const OSM_TILE_FAILURE_THRESHOLD = 3;

export interface TileFailureTracker {
  /** Records one failed tile load. Returns true once the threshold is hit. */
  recordFailure(): boolean;
  /** Clears the failure count (style switched, notice dismissed, etc.). */
  reset(): void;
}

/**
 * Counts consecutive-session tile failures for a source. Deliberately does NOT
 * reset on individual successful tiles: an overloaded tile server typically
 * serves some tiles and drops others, and intermittent successes shouldn't
 * suppress the warning forever.
 */
export function createTileFailureTracker(
  threshold: number = OSM_TILE_FAILURE_THRESHOLD,
): TileFailureTracker {
  let failures = 0;
  return {
    recordFailure() {
      failures += 1;
      return failures >= threshold;
    },
    reset() {
      failures = 0;
    },
  };
}

export function setStreetStyle(style: StreetStyle): void {
  try {
    localStorage.setItem(STREET_STYLE_KEY, style);
  } catch {
    // ignore persistence errors (e.g. storage disabled)
  }
}
