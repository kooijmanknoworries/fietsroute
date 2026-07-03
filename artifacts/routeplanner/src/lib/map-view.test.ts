import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  getStreetStyle,
  setStreetStyle,
  getLfRoutesEnabled,
  setLfRoutesEnabled,
  STREET_STYLES,
  type StreetStyle,
} from "./map-view";

const STREET_STYLE_KEY = "fietsrouteplanner.streetStyle";
const LF_ROUTES_KEY = "fietsrouteplanner.lfRoutes";

describe("street-style persistence", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it("defaults to voyager when nothing is stored", () => {
    expect(getStreetStyle()).toBe("voyager");
  });

  it("defaults to voyager when an invalid value is stored", () => {
    localStorage.setItem(STREET_STYLE_KEY, "not-a-style");
    expect(getStreetStyle()).toBe("voyager");
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

describe("LF-routes toggle persistence", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it("is off by default when nothing is stored", () => {
    expect(getLfRoutesEnabled()).toBe(false);
  });

  it("is off when an invalid value is stored", () => {
    localStorage.setItem(LF_ROUTES_KEY, "bogus");
    expect(getLfRoutesEnabled()).toBe(false);
  });

  it("round-trips on and off through localStorage", () => {
    setLfRoutesEnabled(true);
    expect(getLfRoutesEnabled()).toBe(true);
    expect(localStorage.getItem(LF_ROUTES_KEY)).toBe("on");

    setLfRoutesEnabled(false);
    expect(getLfRoutesEnabled()).toBe(false);
    expect(localStorage.getItem(LF_ROUTES_KEY)).toBe("off");
  });
});
