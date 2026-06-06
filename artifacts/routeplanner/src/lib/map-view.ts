const STORAGE_KEY = "fietsrouteplanner.baseLayer";

export type BaseLayer = "map" | "satellite";

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
