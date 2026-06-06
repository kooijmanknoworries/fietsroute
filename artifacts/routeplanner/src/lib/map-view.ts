const STORAGE_KEY = "fietsrouteplanner.baseLayer";
const STREET_STYLE_KEY = "fietsrouteplanner.streetStyle";

export type BaseLayer = "map" | "satellite";

/**
 * The keyless street basemap "looks" a cyclist can pick between. All are free
 * CARTO raster styles, so switching never needs an API key or billing.
 */
export type StreetStyle = "voyager" | "positron" | "dark";

export const STREET_STYLES: StreetStyle[] = ["voyager", "positron", "dark"];

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
 * the clean "voyager" look when nothing valid is stored.
 */
export function getStreetStyle(): StreetStyle {
  try {
    const raw = localStorage.getItem(STREET_STYLE_KEY);
    if (raw === "voyager" || raw === "positron" || raw === "dark") {
      return raw;
    }
    return "voyager";
  } catch {
    return "voyager";
  }
}

export function setStreetStyle(style: StreetStyle): void {
  try {
    localStorage.setItem(STREET_STYLE_KEY, style);
  } catch {
    // ignore persistence errors (e.g. storage disabled)
  }
}
