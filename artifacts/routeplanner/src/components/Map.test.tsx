import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";

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

const { constructorCalls, fitBoundsCalls, layoutCalls, addedLayers } = vi.hoisted(() => ({
  constructorCalls: [] as MapOptions[],
  fitBoundsCalls: [] as Array<{ bounds: unknown; options: unknown }>,
  layoutCalls: [] as LayoutCall[],
  addedLayers: [] as Array<Record<string, unknown>>,
}));

vi.mock("maplibre-gl", () => {
  class FakeMap {
    constructor(options: MapOptions) {
      constructorCalls.push(options);
    }
    on(event: string, ...args: unknown[]) {
      // The component registers its layers/sources inside the "load" handler.
      // Fire it synchronously so the test can inspect the added layers. The
      // layer-target overload (on("click", "layer", cb)) passes the callback
      // as the last argument, so only invoke zero-arg "load" handlers.
      if (event === "load" && args.length === 1 && typeof args[0] === "function") {
        (args[0] as () => void)();
      }
    }
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
    getCenter() {
      return { lng: 0, lat: 0 };
    }
    getCanvas() {
      return { style: {} };
    }
    getSource() {
      return undefined;
    }
    addSource() {}
    addLayer(layer: Record<string, unknown>) {
      addedLayers.push(layer);
    }
    getLayer(id: string) {
      return addedLayers.find((l) => (l as { id?: string }).id === id);
    }
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

const STREET_LAYER = "street-osm-layer";

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
    addedLayers.length = 0;
    localStorage.clear();
  });

  afterEach(() => {
    cleanup();
    localStorage.clear();
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

  it("requests a font the configured glyphs host can serve for the node-number labels", () => {
    render(
      <I18nProvider>
        <Map {...baseProps} initialBounds={null} fitBounds={null} />
      </I18nProvider>,
    );

    // The fonts.openmaptiles.org glyphs host (set as the style's `glyphs` URL)
    // serves the "Open Sans" family. If the symbol layer asks for a font the
    // host doesn't provide, the knooppunt numbers render no text — so guard
    // that the text layer only requests fonts from this supported set.
    const SUPPORTED_FONTS = [
      "Open Sans Regular",
      "Open Sans Bold",
      "Open Sans Semibold",
      "Open Sans Italic",
    ];

    const textLayer = addedLayers.find((l) => l.id === "nodes-layer-text");
    expect(textLayer).toBeDefined();

    const layout = textLayer?.layout as { "text-font"?: unknown } | undefined;
    const textFont = layout?.["text-font"];
    expect(Array.isArray(textFont)).toBe(true);

    const fonts = textFont as string[];
    expect(fonts.length).toBeGreaterThan(0);
    for (const font of fonts) {
      expect(SUPPORTED_FONTS).toContain(font);
    }
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

  it("renders the three style options and persists the chosen look", () => {
    render(
      <I18nProvider>
        <Map {...baseProps} initialBounds={null} fitBounds={null} />
      </I18nProvider>,
    );

    // Open the style picker (only available while the street base is shown).
    // The default look is OpenStreetMap ("osm"), so that is the button label.
    fireEvent.click(screen.getByRole("button", { name: /OpenStreetMap/ }));

    const menu = screen.getByRole("menu");
    const options = within(menu).getAllByRole("menuitemradio");
    expect(options).toHaveLength(4);
    // Labels render in the default (Dutch) locale.
    expect(options.map((o) => o.textContent?.trim())).toEqual([
      "Voyager",
      "Licht",
      "Donker",
      "OpenStreetMap",
    ]);
    // OpenStreetMap is the default, so it starts checked.
    expect(
      within(menu)
        .getByRole("menuitemradio", { name: /OpenStreetMap/ })
        .getAttribute("aria-checked"),
    ).toBe("true");

    // Pick "Donker" (dark) and confirm the choice is saved for next session.
    fireEvent.click(within(menu).getByRole("menuitemradio", { name: /Donker/ }));

    expect(localStorage.getItem("fietsrouteplanner.streetStyle")).toBe("dark");
    // Choosing a street look also switches the street base back on.
    expect(localStorage.getItem("fietsrouteplanner.baseLayer")).toBe("map");
  });

  it("restores a previously saved street style on reload", () => {
    localStorage.setItem("fietsrouteplanner.streetStyle", "dark");

    render(
      <I18nProvider>
        <Map {...baseProps} initialBounds={null} fitBounds={null} />
      </I18nProvider>,
    );

    // The picker button shows the restored "Donker" (dark) look, not the
    // default. getByRole throws if it is missing, so this asserts it exists.
    fireEvent.click(screen.getByRole("button", { name: /Donker/ }));
    const menu = screen.getByRole("menu");
    const dark = within(menu).getByRole("menuitemradio", { name: /Donker/ });
    expect(dark.getAttribute("aria-checked")).toBe("true");
  });
});
