import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  getStreetStyle,
  setStreetStyle,
  STREET_STYLES,
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
