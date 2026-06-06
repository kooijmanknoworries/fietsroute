import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";

interface MapStyle {
  glyphs?: string;
  sources?: Record<string, unknown>;
  layers?: Array<Record<string, unknown>>;
}

interface MapOptions {
  bounds?: [[number, number], [number, number]];
  center?: [number, number];
  zoom?: number;
  fitBoundsOptions?: unknown;
  style?: MapStyle;
}

const { constructorCalls, fitBoundsCalls } = vi.hoisted(() => ({
  constructorCalls: [] as MapOptions[],
  fitBoundsCalls: [] as Array<{ bounds: unknown; options: unknown }>,
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
    setLayoutProperty() {}
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

describe("Map", () => {
  beforeEach(() => {
    constructorCalls.length = 0;
    fitBoundsCalls.length = 0;
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
});
