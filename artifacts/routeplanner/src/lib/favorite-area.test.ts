import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  clearFavoriteArea,
  getFavoriteArea,
  setFavoriteArea,
  type FavoriteArea,
} from "./favorite-area";

const UTRECHT: FavoriteArea = {
  id: "relation/47811",
  name: "Utrecht",
  displayName: "Utrecht, Nederland",
  lat: 52.0907,
  lon: 5.1214,
  boundingBox: { south: 52.0, north: 52.15, west: 5.0, east: 5.25 },
};

describe("favorite-area persistence", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it("returns null when no favorite has been saved (Utrecht fallback applies)", () => {
    expect(getFavoriteArea()).toBeNull();
  });

  it("persists a favorite so it survives a page reload", () => {
    setFavoriteArea(UTRECHT);

    // Simulate a fresh page load: a brand new read from localStorage.
    const restored = getFavoriteArea();
    expect(restored).toEqual(UTRECHT);
    expect(restored?.boundingBox).toEqual(UTRECHT.boundingBox);
  });

  it("clears a saved favorite", () => {
    setFavoriteArea(UTRECHT);
    clearFavoriteArea();
    expect(getFavoriteArea()).toBeNull();
  });

  it("returns null for corrupt stored data", () => {
    localStorage.setItem("fietsrouteplanner.favoriteArea", "not-json");
    expect(getFavoriteArea()).toBeNull();
  });

  it("returns null for a structurally invalid stored value", () => {
    localStorage.setItem(
      "fietsrouteplanner.favoriteArea",
      JSON.stringify({ id: "x", name: "Broken" }),
    );
    expect(getFavoriteArea()).toBeNull();
  });
});
