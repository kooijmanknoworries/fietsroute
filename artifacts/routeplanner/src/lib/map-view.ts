const STORAGE_KEY = "fietsrouteplanner.baseLayer";
const STREET_STYLE_KEY = "fietsrouteplanner.streetStyle";
const LF_ROUTES_KEY = "fietsrouteplanner.lfRoutes";

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
 * "voyager" (CARTO) when nothing valid is stored. CARTO tiles are generally
 * more reliable than the classic OpenStreetMap tile layer, which is frequently
 * overloaded or rate-limited.
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

/**
 * Returns whether the LF-routes (long-distance cycling routes) overlay is
 * enabled. Off by default; the choice persists across sessions.
 */
export function getLfRoutesEnabled(): boolean {
  try {
    return localStorage.getItem(LF_ROUTES_KEY) === "on";
  } catch {
    return false;
  }
}

export function setLfRoutesEnabled(enabled: boolean): void {
  try {
    localStorage.setItem(LF_ROUTES_KEY, enabled ? "on" : "off");
  } catch {
    // ignore persistence errors (e.g. storage disabled)
  }
}
