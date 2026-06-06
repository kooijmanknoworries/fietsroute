import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, fireEvent } from "@testing-library/react";

interface StyleLayer {
  id: string;
  layout?: { visibility?: string };
}

interface MapStyle {
  glyphs?: string;
  sources?: Record<string, unknown>;
  layers?: StyleLayer[];
}

interface MapOptions {
  bounds?: [[number, number], [number, number]];
  center?: [number, number];
  zoom?: number;
  fitBoundsOptions?: unknown;
  style?: MapStyle;
}

interface LayoutCall {
  layerId: string;
  property: string;
  value: unknown;
}

const { constructorCalls, fitBoundsCalls, layoutCalls } = vi.hoisted(() => ({
  constructorCalls: [] as MapOptions[],
  fitBoundsCalls: [] as Array<{ bounds: unknown; options: unknown }>,
  layoutCalls: [] as LayoutCall[],
}));

vi.mock("maplibre-gl", () => {
  class FakeMap {
    constructor(options: MapOptions) {
      constructorCalls.push(options);
    }
    on() {}
    once() {}
    off() {}
    isStyleLoaded() {
      return true;
    }
    fitBounds(bounds: unknown, options: unknown) {
      fitBoundsCalls.push({ bounds, options });
    }
    flyTo() {}
    getBounds() {
      return {
        getWest: () => 0,
        getSouth: () => 0,
        getEast: () => 0,
        getNorth: () => 0,
      };
    }
    getCanvas() {
      return { style: {} };
    }
    getSource() {
      return undefined;
    }
    addSource() {}
    addLayer() {}
    setFeatureState() {}
    setLayoutProperty(layerId: string, property: string, value: unknown) {
      layoutCalls.push({ layerId, property, value });
    }
    addControl() {}
    remove() {}
  }
  class NavigationControl {}
  class ScaleControl {}
  return { default: { Map: FakeMap, NavigationControl, ScaleControl } };
});

import Map from "./Map";
import { I18nProvider } from "@/lib/i18n";

const UTRECHT_AREA = {
  south: 52.0,
  north: 52.15,
  west: 5.0,
  east: 5.25,
};

const baseProps = {
  nodes: [],
  segments: [],
  selectedNodes: [],
  routeCoordinates: null,
  importedCoordinates: null,
  onBboxChange: () => {},
  onNodeClick: () => {},
};

const BASE_LAYER_STORAGE_KEY = "fietsrouteplanner.baseLayer";

const STREET_LAYER = "street-voyager-layer";

function visibilityOf(style: MapOptions["style"], layerId: string) {
  return style?.layers?.find((l) => l.id === layerId)?.layout?.visibility;
}

function lastVisibility(layerId: string) {
  for (let i = layoutCalls.length - 1; i >= 0; i--) {
    const call = layoutCalls[i];
    if (call.layerId === layerId && call.property === "visibility") {
      return call.value;
    }
  }
  return undefined;
}

describe("Map", () => {
  beforeEach(() => {
    constructorCalls.length = 0;
    fitBoundsCalls.length = 0;
    layoutCalls.length = 0;
    localStorage.clear();
  });

  afterEach(() => {
    cleanup();
  });

  it("opens at the favorite area's bounds when initialBounds is provided", () => {
    render(
      <I18nProvider>
        <Map {...baseProps} initialBounds={UTRECHT_AREA} fitBounds={null} />
      </I18nProvider>,
    );

    expect(constructorCalls).toHaveLength(1);
    const opts = constructorCalls[0];
    expect(opts.bounds).toEqual([
      [UTRECHT_AREA.west, UTRECHT_AREA.south],
      [UTRECHT_AREA.east, UTRECHT_AREA.north],
    ]);
    expect(opts.center).toBeUndefined();
  });

  it("falls back to the Utrecht center when there is no favorite area", () => {
    render(
      <I18nProvider>
        <Map {...baseProps} initialBounds={null} fitBounds={null} />
      </I18nProvider>,
    );

    expect(constructorCalls).toHaveLength(1);
    const opts = constructorCalls[0];
    expect(opts.bounds).toBeUndefined();
    expect(opts.center).toEqual([5.1214, 52.0907]);
    expect(opts.zoom).toBe(13);
  });

  it("includes a glyphs source so the knooppunt number text layer can load its font", () => {
    render(
      <I18nProvider>
        <Map {...baseProps} initialBounds={null} fitBounds={null} />
      </I18nProvider>,
    );

    expect(constructorCalls).toHaveLength(1);
    const style = constructorCalls[0].style;
    expect(style).toBeDefined();
    expect(typeof style?.glyphs).toBe("string");
    expect(style?.glyphs).toMatch(/\{fontstack\}.*\{range\}/);
  });

  it("fits the map to a selected municipality's bounds via fitBounds", () => {
    const selected = { south: 51.8, north: 52.0, west: 4.4, east: 4.6 };
    render(
      <I18nProvider>
        <Map {...baseProps} initialBounds={null} fitBounds={selected} />
      </I18nProvider>,
    );

    expect(fitBoundsCalls).toHaveLength(1);
    expect(fitBoundsCalls[0].bounds).toEqual([
      [selected.west, selected.south],
      [selected.east, selected.north],
    ]);
    expect(fitBoundsCalls[0].options).toEqual({ padding: 40 });
  });

  it("toggling Satellite hides the street layer and shows imagery + labels, and back reverses it", () => {
    const { getByRole } = render(
      <I18nProvider>
        <Map {...baseProps} initialBounds={null} fitBounds={null} />
      </I18nProvider>,
    );

    // Default view is the street map, so the constructor renders the street
    // base layer visible and both satellite layers hidden.
    const style = constructorCalls[0].style;
    expect(visibilityOf(style, STREET_LAYER)).toBe("visible");
    expect(visibilityOf(style, "satellite-tiles-layer")).toBe("none");
    expect(visibilityOf(style, "satellite-labels-layer")).toBe("none");

    // Switch to Satellite.
    layoutCalls.length = 0;
    fireEvent.click(getByRole("button", { name: "Satelliet" }));
    expect(lastVisibility(STREET_LAYER)).toBe("none");
    expect(lastVisibility("satellite-tiles-layer")).toBe("visible");
    expect(lastVisibility("satellite-labels-layer")).toBe("visible");

    // Switch back to the street map.
    layoutCalls.length = 0;
    fireEvent.click(getByRole("button", { name: "Kaart" }));
    expect(lastVisibility(STREET_LAYER)).toBe("visible");
    expect(lastVisibility("satellite-tiles-layer")).toBe("none");
    expect(lastVisibility("satellite-labels-layer")).toBe("none");
  });

  it("persists the chosen view to localStorage", () => {
    const { getByRole } = render(
      <I18nProvider>
        <Map {...baseProps} initialBounds={null} fitBounds={null} />
      </I18nProvider>,
    );

    fireEvent.click(getByRole("button", { name: "Satelliet" }));
    expect(localStorage.getItem(BASE_LAYER_STORAGE_KEY)).toBe("satellite");

    fireEvent.click(getByRole("button", { name: "Kaart" }));
    expect(localStorage.getItem(BASE_LAYER_STORAGE_KEY)).toBe("map");
  });

  it("restores the persisted satellite view on the next load", () => {
    localStorage.setItem(BASE_LAYER_STORAGE_KEY, "satellite");

    render(
      <I18nProvider>
        <Map {...baseProps} initialBounds={null} fitBounds={null} />
      </I18nProvider>,
    );

    const style = constructorCalls[0].style;
    expect(visibilityOf(style, STREET_LAYER)).toBe("none");
    expect(visibilityOf(style, "satellite-tiles-layer")).toBe("visible");
    expect(visibilityOf(style, "satellite-labels-layer")).toBe("visible");
  });

  it("defaults to the street map view when nothing is stored", () => {
    render(
      <I18nProvider>
        <Map {...baseProps} initialBounds={null} fitBounds={null} />
      </I18nProvider>,
    );

    const style = constructorCalls[0].style;
    expect(visibilityOf(style, STREET_LAYER)).toBe("visible");
    expect(visibilityOf(style, "satellite-tiles-layer")).toBe("none");
    expect(visibilityOf(style, "satellite-labels-layer")).toBe("none");
  });

  it("defaults to the street map view when an invalid value is stored", () => {
    localStorage.setItem(BASE_LAYER_STORAGE_KEY, "bogus");

    render(
      <I18nProvider>
        <Map {...baseProps} initialBounds={null} fitBounds={null} />
      </I18nProvider>,
    );

    const style = constructorCalls[0].style;
    expect(visibilityOf(style, STREET_LAYER)).toBe("visible");
    expect(visibilityOf(style, "satellite-tiles-layer")).toBe("none");
    expect(visibilityOf(style, "satellite-labels-layer")).toBe("none");
  });
});
