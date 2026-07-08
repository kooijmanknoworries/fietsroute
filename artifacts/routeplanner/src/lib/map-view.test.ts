import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  getStreetStyle,
  setStreetStyle,
  STREET_STYLES,
  createTileFailureTracker,
  OSM_TILE_FAILURE_THRESHOLD,
  type StreetStyle,
} from "./map-view";

const STREET_STYLE_KEY = "fietsrouteplanner.streetStyle";

describe("street-style persistence", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it("defaults to osm when nothing is stored", () => {
    expect(getStreetStyle()).toBe("osm");
  });

  it("defaults to osm when an invalid value is stored", () => {
    localStorage.setItem(STREET_STYLE_KEY, "not-a-style");
    expect(getStreetStyle()).toBe("osm");
  });

  it("round-trips every supported style through localStorage", () => {
    for (const style of STREET_STYLES) {
      setStreetStyle(style);
      // Simulate a fresh page load: a brand new read from localStorage.
      expect(getStreetStyle()).toBe(style);
      expect(localStorage.getItem(STREET_STYLE_KEY)).toBe(style);
    }
  });

  it("persists a non-default choice so it survives a reload", () => {
    const chosen: StreetStyle = "dark";
    setStreetStyle(chosen);
    expect(getStreetStyle()).toBe(chosen);
  });
});

describe("tile failure tracker", () => {
  it("does not trip before the threshold is reached", () => {
    const tracker = createTileFailureTracker();
    for (let i = 0; i < OSM_TILE_FAILURE_THRESHOLD - 1; i++) {
      expect(tracker.recordFailure()).toBe(false);
    }
  });

  it("trips exactly at the threshold and stays tripped after", () => {
    const tracker = createTileFailureTracker();
    for (let i = 0; i < OSM_TILE_FAILURE_THRESHOLD - 1; i++) {
      tracker.recordFailure();
    }
    expect(tracker.recordFailure()).toBe(true);
    expect(tracker.recordFailure()).toBe(true);
  });

  it("starts counting from zero again after reset", () => {
    const tracker = createTileFailureTracker();
    for (let i = 0; i < OSM_TILE_FAILURE_THRESHOLD; i++) {
      tracker.recordFailure();
    }
    tracker.reset();
    for (let i = 0; i < OSM_TILE_FAILURE_THRESHOLD - 1; i++) {
      expect(tracker.recordFailure()).toBe(false);
    }
    expect(tracker.recordFailure()).toBe(true);
  });

  it("honours a custom threshold", () => {
    const tracker = createTileFailureTracker(1);
    expect(tracker.recordFailure()).toBe(true);
  });
});
