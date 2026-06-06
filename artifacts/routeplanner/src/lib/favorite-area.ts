import type { MunicipalityResult } from "@workspace/api-client-react";

const STORAGE_KEY = "fietsrouteplanner.favoriteArea";

export type FavoriteArea = MunicipalityResult;

/**
 * Returns the user's saved favorite area from localStorage, or null if none
 * is set or the stored value is invalid.
 */
export function getFavoriteArea(): FavoriteArea | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as FavoriteArea;
    if (
      parsed &&
      typeof parsed.id === "string" &&
      typeof parsed.name === "string" &&
      parsed.boundingBox &&
      typeof parsed.boundingBox.south === "number"
    ) {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

export function setFavoriteArea(area: FavoriteArea): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(area));
  } catch {
    // ignore persistence errors (e.g. storage disabled)
  }
}

export function clearFavoriteArea(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}
