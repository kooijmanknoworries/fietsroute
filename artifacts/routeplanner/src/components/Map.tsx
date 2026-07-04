import { useState, useRef, useEffect, useCallback } from "react";
import maplibregl from "maplibre-gl";
import { Map as MapIcon, Satellite, LocateFixed, Sun, Moon, Palette, Globe, Route } from "lucide-react";
import {
  NetworkNode,
  NetworkSegment,
  GeoJsonGeometry,
  useGetLfRoutes,
  getGetLfRoutesQueryKey,
} from "@workspace/api-client-react";
import { keepPreviousData } from "@tanstack/react-query";
import {
  getBaseLayer,
  setBaseLayer,
  getStreetStyle,
  setStreetStyle,
  getLfRoutesEnabled,
  setLfRoutesEnabled,
  STREET_STYLES,
  type BaseLayer,
  type StreetStyle,
} from "@/lib/map-view";
import { useI18n } from "@/lib/i18n";

interface Bounds {
  south: number;
  north: number;
  west: number;
  east: number;
}

interface MapProps {
  nodes: NetworkNode[];
  segments: NetworkSegment[];
  selectedNodes: NetworkNode[];
  routeCoordinates: number[][] | null;
  importedCoordinates: number[][] | null;
  boundaryGeometry?: GeoJsonGeometry | null;
  onBboxChange: (
    bbox: string,
    direction: { dx: number; dy: number } | null,
  ) => void;
  onNodeClick: (node: NetworkNode) => void;
  onRecenter?: () => void;
  flyToRegion?: { lat: number; lon: number; zoom: number } | null;
  initialBounds?: Bounds | null;
  fitBounds?: Bounds | null;
  /** Live snapped "you are here" position as [lon, lat] while riding. */
  ridePosition?: number[] | null;
  /** The travelled portion of the route, recoloured while riding. */
  traveledCoordinates?: number[][] | null;
  /** Lock markers for completed / previously-ridden segments. */
  visitedLockPoints?: { lon: number; lat: number }[];
  /** Whether the map recenters to follow the rider. Defaults to true. */
  followRide?: boolean;
  /** Called when the rider pans/zooms the map by hand during a ride. */
  onFollowPause?: () => void;
  /** Called when the rider taps the "recenter on me" control. */
  onFollowResume?: () => void;
}

// Free, keyless raster basemaps. The CARTO styles' "@2x" variant serves high-
// resolution (retina) tiles so text and lines stay sharp on high-DPI screens.
// Each style is a different "look" the cyclist can pick between:
//  - voyager : clean, modern colour map with crisp, readable labels (default)
//  - positron: bright, low-detail light map (good for printing / glare)
//  - dark    : high-contrast dark map
//  - osm     : the classic plain OpenStreetMap raster
const CARTO_STYLE_PATHS: Partial<Record<StreetStyle, string>> = {
  voyager: "rastertiles/voyager",
  positron: "light_all",
  dark: "dark_all",
};

const OSM_TILE_URLS = ["a", "b", "c"].map(
  (sub) => `https://${sub}.tile.openstreetmap.org/{z}/{x}/{y}.png`,
);

const streetTileUrls = (style: StreetStyle): string[] =>
  style === "osm"
    ? OSM_TILE_URLS
    : ["a", "b", "c", "d"].map(
        (sub) =>
          `https://${sub}.basemaps.cartocdn.com/${CARTO_STYLE_PATHS[style]}/{z}/{x}/{y}@2x.png`,
      );

const streetSourceId = (style: StreetStyle): string => `street-${style}`;
const streetLayerId = (style: StreetStyle): string => `street-${style}-layer`;

const STREET_STYLE_ICONS: Record<StreetStyle, typeof MapIcon> = {
  voyager: MapIcon,
  positron: Sun,
  dark: Moon,
  osm: Globe,
};

// Esri World Imagery: free, keyless high-resolution aerial imagery. Used as a
// satellite alternative to Google (whose tiles require a paid, licensed API).
const SATELLITE_TILE_URLS = [
  "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
];
// Esri reference overlay so place/road names stay readable over the imagery.
const SATELLITE_LABEL_URLS = [
  "https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}"
];
const OSM_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';
const STREET_ATTRIBUTION =
  OSM_ATTRIBUTION + ' &copy; <a href="https://carto.com/attributions">CARTO</a>';
const streetAttribution = (style: StreetStyle): string =>
  style === "osm" ? OSM_ATTRIBUTION : STREET_ATTRIBUTION;
const SATELLITE_ATTRIBUTION =
  'Imagery &copy; <a href="https://www.esri.com">Esri</a>, Maxar, Earthstar Geographics, and the GIS User Community';

const UTRECHT = { lat: 52.0907, lon: 5.1214, zoom: 13 };

const RIDE_LOCK_IMAGE_ID = "ride-lock";

// Build a small padlock icon as raw RGBA pixels (an ImageData-like object).
// Generating the pixels directly avoids needing a <canvas> 2D context, which
// isn't available in the jsdom test environment, so the same code path runs in
// tests and in real browsers. Marks a segment the rider has already completed.
function makeLockIcon(ratio = 2): {
  width: number;
  height: number;
  data: Uint8ClampedArray;
} {
  const size = 22;
  const width = Math.round(size * ratio);
  const height = Math.round(size * ratio);
  const data = new Uint8ClampedArray(width * height * 4);

  // All geometry is expressed in logical (unscaled) coordinates.
  const bodyX0 = 4,
    bodyX1 = 18,
    bodyY0 = 10,
    bodyY1 = 20,
    bodyR = 2.5;
  const shCx = 11,
    shCy = 10,
    shOuter = 6,
    shInner = 3.4;
  const keyCx = 11,
    keyCy = 14.5,
    keyR = 1.5;

  const clamp = (v: number, lo: number, hi: number) =>
    Math.max(lo, Math.min(hi, v));

  const inRoundedRect = (
    x: number,
    y: number,
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    r: number,
  ): boolean => {
    const dx = x - clamp(x, x0 + r, x1 - r);
    const dy = y - clamp(y, y0 + r, y1 - r);
    return dx * dx + dy * dy <= r * r;
  };

  // The U-shaped shackle: an upper ring plus the two short legs meeting the
  // body top. Only the portion above the body is drawn.
  const inShackle = (x: number, y: number, grow: number): boolean => {
    if (y > bodyY0 + 0.5) return false;
    const dx = x - shCx;
    const dy = y - shCy;
    const d = Math.sqrt(dx * dx + dy * dy);
    return d <= shOuter + grow && d >= shInner - grow;
  };

  const inShape = (x: number, y: number, grow: number): boolean =>
    inRoundedRect(
      x,
      y,
      bodyX0 - grow,
      bodyY0 - grow,
      bodyX1 + grow,
      bodyY1 + grow,
      bodyR + grow,
    ) || inShackle(x, y, grow);

  const setPixel = (
    px: number,
    py: number,
    r: number,
    g: number,
    b: number,
    a: number,
  ) => {
    const idx = (py * width + px) * 4;
    data[idx] = r;
    data[idx + 1] = g;
    data[idx + 2] = b;
    data[idx + 3] = a;
  };

  for (let py = 0; py < height; py++) {
    for (let px = 0; px < width; px++) {
      const x = px / ratio;
      const y = py / ratio;
      const dxk = x - keyCx;
      const dyk = y - keyCy;
      const inKeyhole = dxk * dxk + dyk * dyk <= keyR * keyR;

      if (inShape(x, y, 0)) {
        if (inKeyhole) {
          setPixel(px, py, 255, 255, 255, 255); // keyhole
        } else {
          setPixel(px, py, 51, 65, 85, 255); // slate-700 lock body
        }
      } else if (inShape(x, y, 1.1)) {
        setPixel(px, py, 255, 255, 255, 235); // white halo for contrast
      }
    }
  }

  return { width, height, data };
}

export default function Map({
  nodes,
  segments,
  selectedNodes,
  routeCoordinates,
  importedCoordinates,
  boundaryGeometry,
  onBboxChange,
  onNodeClick,
  onRecenter,
  flyToRegion,
  initialBounds,
  fitBounds,
  ridePosition,
  traveledCoordinates,
  visitedLockPoints,
  followRide = true,
  onFollowPause,
  onFollowResume,
}: MapProps) {
  const { t } = useI18n();
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const nodesRef = useRef(nodes);
  const onNodeClickRef = useRef(onNodeClick);
  const onBboxChangeRef = useRef(onBboxChange);
  const lastCenterRef = useRef<{ lon: number; lat: number } | null>(null);
  const rideMarkerRef = useRef<maplibregl.Marker | null>(null);
  // Latest follow state, ride position, and pause callback, read from inside the
  // map's (once-registered) gesture handler so it always sees current values.
  const followRideRef = useRef(followRide);
  followRideRef.current = followRide;
  const ridePositionRef = useRef(ridePosition);
  ridePositionRef.current = ridePosition;
  const onFollowPauseRef = useRef(onFollowPause);
  onFollowPauseRef.current = onFollowPause;
  const [mapError, setMapError] = useState(false);
  const [baseLayer, setBaseLayerState] = useState<BaseLayer>(() => getBaseLayer());
  const baseLayerRef = useRef<BaseLayer>(baseLayer);
  baseLayerRef.current = baseLayer;
  const [streetStyle, setStreetStyleState] = useState<StreetStyle>(() => getStreetStyle());
  const streetStyleRef = useRef<StreetStyle>(streetStyle);
  streetStyleRef.current = streetStyle;
  const [styleMenuOpen, setStyleMenuOpen] = useState(false);
  const styleMenuRef = useRef<HTMLDivElement>(null);
  const [lfEnabled, setLfEnabled] = useState<boolean>(() => getLfRoutesEnabled());
  const lfEnabledRef = useRef<boolean>(lfEnabled);
  lfEnabledRef.current = lfEnabled;
  const [lfBbox, setLfBbox] = useState<string | null>(null);

  // LF-routes overlay data: only fetched while the toggle is on, keyed on the
  // same snapped viewport bbox as the network query so server-side caching is
  // shared across pans within the same tiles.
  const { data: lfRoutesData } = useGetLfRoutes(
    { bbox: lfBbox ?? "" },
    {
      query: {
        enabled: lfEnabled && !!lfBbox,
        queryKey: getGetLfRoutesQueryKey({ bbox: lfBbox ?? "" }),
        placeholderData: keepPreviousData,
        staleTime: 5 * 60 * 1000,
      },
    },
  );

  nodesRef.current = nodes;
  onNodeClickRef.current = onNodeClick;
  onBboxChangeRef.current = onBboxChange;

  useEffect(() => {
    if (map.current || !mapContainer.current) return;

    const initialBase = baseLayerRef.current;
    const initialStyle = streetStyleRef.current;

    // One raster source + layer per street style. Only the chosen street style's
    // layer is visible (and only while the street base is selected); switching
    // styles just toggles layer visibility, which keeps all overlays intact and
    // avoids tearing down/rebuilding the map.
    const streetSources = Object.fromEntries(
      STREET_STYLES.map((style) => [
        streetSourceId(style),
        {
          type: "raster" as const,
          tiles: streetTileUrls(style),
          tileSize: 256,
          attribution: streetAttribution(style),
        },
      ]),
    );
    const streetLayers = STREET_STYLES.map((style) => ({
      id: streetLayerId(style),
      type: "raster" as const,
      source: streetSourceId(style),
      minzoom: 0,
      maxzoom: 22,
      layout: {
        visibility:
          initialBase === "map" && style === initialStyle
            ? ("visible" as const)
            : ("none" as const),
      },
    }));

    try {
      map.current = new maplibregl.Map({
        container: mapContainer.current,
        style: {
          version: 8,
          // Free, keyless glyph host so text/symbol layers (the knooppunt
          // numbers) can load their font. Without this, symbol layers render
          // no text. Serves "Open Sans Regular" used by the node-number layer.
          glyphs: "https://fonts.openmaptiles.org/{fontstack}/{range}.pbf",
          sources: {
            ...streetSources,
            "satellite-tiles": {
              type: "raster",
              tiles: SATELLITE_TILE_URLS,
              tileSize: 256,
              attribution: SATELLITE_ATTRIBUTION
            },
            "satellite-labels": {
              type: "raster",
              tiles: SATELLITE_LABEL_URLS,
              tileSize: 256
            }
          },
          layers: [
            ...streetLayers,
            {
              id: "satellite-tiles-layer",
              type: "raster",
              source: "satellite-tiles",
              minzoom: 0,
              maxzoom: 22,
              layout: { visibility: initialBase === "satellite" ? "visible" : "none" }
            },
            {
              id: "satellite-labels-layer",
              type: "raster",
              source: "satellite-labels",
              minzoom: 0,
              maxzoom: 22,
              layout: { visibility: initialBase === "satellite" ? "visible" : "none" }
            }
          ]
        },
        ...(initialBounds
          ? {
              bounds: [
                [initialBounds.west, initialBounds.south],
                [initialBounds.east, initialBounds.north],
              ] as [[number, number], [number, number]],
              fitBoundsOptions: { padding: 40 },
            }
          : {
              center: [UTRECHT.lon, UTRECHT.lat] as [number, number],
              zoom: UTRECHT.zoom,
            }),
      });
    } catch {
      setMapError(true);
      // The map canvas needs WebGL, but the rest of the planner (the
      // /api/network fetch, sidebar states, saved routes) does not. Report the
      // initial viewport's bbox anyway so network data still loads — the
      // sidebar can show what was found, and end-to-end tests in WebGL-less
      // browsers can still catch auth regressions that would blank the map.
      const fb = initialBounds ?? {
        west: UTRECHT.lon - 0.15,
        east: UTRECHT.lon + 0.15,
        south: UTRECHT.lat - 0.1,
        north: UTRECHT.lat + 0.1,
      };
      // Same 0.1° tile-grid snapping as updateBbox below, so the fallback
      // request hits the identical server-side cache tiles.
      const TILE_SIZE_DEG = 0.1;
      const snap = (v: number, mode: "floor" | "ceil") => {
        const tiles = v / TILE_SIZE_DEG;
        const t = mode === "floor" ? Math.floor(tiles) : Math.ceil(tiles);
        return Number((t * TILE_SIZE_DEG).toFixed(3));
      };
      onBboxChangeRef.current(
        `${snap(fb.west, "floor")},${snap(fb.south, "floor")},${snap(fb.east, "ceil")},${snap(fb.north, "ceil")}`,
        null,
      );
      return;
    }

    const m = map.current;

    // Zoom (+/-) buttons in the lower-left corner, with a scale bar beneath them
    // showing the current distance in km/m (e.g. 2 km, 1 km, 500 m, 200 m...).
    m.addControl(
      new maplibregl.NavigationControl({ showZoom: true, showCompass: false }),
      "bottom-left"
    );
    m.addControl(
      new maplibregl.ScaleControl({ maxWidth: 120, unit: "metric" }),
      "bottom-left"
    );

    m.on("load", () => {
      m.addSource("boundary", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] }
      });
      m.addLayer({
        id: "boundary-fill",
        type: "fill",
        source: "boundary",
        paint: {
          "fill-color": "#2563eb",
          "fill-opacity": 0.05
        }
      });
      m.addLayer({
        id: "boundary-line",
        type: "line",
        source: "boundary",
        layout: {
          "line-join": "round",
          "line-cap": "round"
        },
        paint: {
          "line-color": "#2563eb",
          "line-width": 2,
          "line-opacity": 0.6,
          "line-dasharray": [3, 2]
        }
      });

      m.addSource("segments", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] }
      });
      m.addLayer({
        id: "segments-layer",
        type: "line",
        source: "segments",
        layout: {
          "line-join": "round",
          "line-cap": "round"
        },
        paint: {
          "line-color": "#2c7a4b",
          "line-width": 2,
          "line-opacity": 0.5
        }
      });

      // LF-routes overlay: long-distance cycling routes shown above the
      // knooppunten segments but below the planned route. Hidden until the
      // user enables the toggle; data is filled in by a separate effect.
      m.addSource("lf-routes", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] }
      });
      m.addLayer({
        id: "lf-routes-layer",
        type: "line",
        source: "lf-routes",
        layout: {
          "line-join": "round",
          "line-cap": "round",
          visibility: lfEnabledRef.current ? "visible" : "none"
        },
        paint: {
          "line-color": "#d97706",
          "line-width": 3,
          "line-opacity": 0.75
        }
      });

      // Hovering (or tapping, on touch devices) an LF-route line shows its
      // name/ref in a small popup near the cursor.
      const lfPopup = new maplibregl.Popup({
        closeButton: false,
        closeOnClick: false,
        offset: 10,
        maxWidth: "260px",
      });
      const showLfPopup = (e: maplibregl.MapLayerMouseEvent) => {
        const feature = e.features?.[0];
        if (!feature) return;
        const name = feature.properties?.name as string | undefined;
        const ref = feature.properties?.ref as string | undefined;
        const label =
          name && ref && !name.includes(ref)
            ? `${ref} ${name}`
            : name || ref;
        if (!label) return;
        const el = document.createElement("div");
        el.className = "text-xs font-medium";
        el.textContent = label;
        lfPopup.setLngLat(e.lngLat).setDOMContent(el).addTo(m);
      };
      m.on("mouseenter", "lf-routes-layer", (e) => {
        m.getCanvas().style.cursor = "pointer";
        showLfPopup(e);
      });
      m.on("mousemove", "lf-routes-layer", showLfPopup);
      m.on("mouseleave", "lf-routes-layer", () => {
        m.getCanvas().style.cursor = "";
        lfPopup.remove();
      });
      m.on("click", "lf-routes-layer", showLfPopup);

      m.addSource("imported-route", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] }
      });
      m.addLayer({
        id: "imported-route-layer",
        type: "line",
        source: "imported-route",
        layout: {
          "line-join": "round",
          "line-cap": "round"
        },
        paint: {
          "line-color": "#8b5cf6",
          "line-width": 4,
          "line-dasharray": [2, 2]
        }
      });

      m.addSource("planned-route", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] }
      });
      m.addLayer({
        id: "planned-route-layer",
        type: "line",
        source: "planned-route",
        layout: {
          "line-join": "round",
          "line-cap": "round"
        },
        paint: {
          "line-color": "#e11d48",
          "line-width": 5
        }
      });

      // Ride-traveled: the portion of the planned route already ridden, drawn
      // on top of the planned route so the completed stretch reads as a
      // different colour. Empty until a ride is in progress.
      m.addSource("ride-traveled", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] }
      });
      m.addLayer({
        id: "ride-traveled-layer",
        type: "line",
        source: "ride-traveled",
        layout: {
          "line-join": "round",
          "line-cap": "round"
        },
        paint: {
          "line-color": "#2563eb",
          "line-width": 6
        }
      });

      m.addSource("nodes", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] }
      });
      
      m.addLayer({
        id: "nodes-layer-circle",
        type: "circle",
        source: "nodes",
        paint: {
          "circle-radius": 12,
          "circle-color": "#ffffff",
          "circle-stroke-width": 2,
          "circle-stroke-color": [
            "case",
            ["boolean", ["feature-state", "selected"], false],
            "#e11d48",
            "#2c7a4b"
          ]
        }
      });

      m.addLayer({
        id: "nodes-layer-text",
        type: "symbol",
        source: "nodes",
        layout: {
          "text-field": ["get", "ref"],
          "text-font": ["Open Sans Regular"],
          "text-size": 12
        },
        paint: {
          "text-color": [
            "case",
            ["boolean", ["feature-state", "selected"], false],
            "#e11d48",
            "#2c7a4b"
          ]
        }
      });

      // Visited-segment lock markers, rendered above every other layer so a
      // completed leg's padlock stays visible. The icon is registered as a raw
      // image; guard the call because the headless test map has no addImage.
      if (typeof m.addImage === "function" && !m.hasImage?.(RIDE_LOCK_IMAGE_ID)) {
        try {
          m.addImage(RIDE_LOCK_IMAGE_ID, makeLockIcon(2), { pixelRatio: 2 });
        } catch {
          // Non-fatal: the lock layer simply renders without its icon.
        }
      }
      m.addSource("visited-locks", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] }
      });
      m.addLayer({
        id: "visited-locks-layer",
        type: "symbol",
        source: "visited-locks",
        layout: {
          "icon-image": RIDE_LOCK_IMAGE_ID,
          "icon-size": 1,
          "icon-allow-overlap": true,
          "icon-ignore-placement": true
        }
      });

      m.on("mouseenter", "nodes-layer-circle", () => {
        m.getCanvas().style.cursor = "pointer";
      });
      m.on("mouseleave", "nodes-layer-circle", () => {
        m.getCanvas().style.cursor = "";
      });

      m.on("click", "nodes-layer-circle", (e) => {
        if (e.features && e.features.length > 0) {
          const feature = e.features[0];
          const node = nodesRef.current.find(n => n.id === feature.properties?.id);
          if (node) {
            onNodeClickRef.current(node);
          }
        }
      });

      // Hide the cycling nodes (knooppunten) once the visible map area is wider
      // than this, so the map stays readable when zoomed far out.
      const MAX_NODE_VISIBLE_KM = 50;
      const updateNodeVisibility = () => {
        const bounds = m.getBounds();
        const centreLat = (bounds.getNorth() + bounds.getSouth()) / 2;
        const toRad = (d: number) => (d * Math.PI) / 180;
        // Approximate east-west width of the viewport in km at its centre.
        const widthKm =
          6371 *
          Math.cos(toRad(centreLat)) *
          toRad(bounds.getEast() - bounds.getWest());
        const visibility = widthKm > MAX_NODE_VISIBLE_KM ? "none" : "visible";
        for (const layerId of ["nodes-layer-circle", "nodes-layer-text"]) {
          if (m.getLayer(layerId)) {
            m.setLayoutProperty(layerId, "visibility", visibility);
          }
        }
      };

      const updateBbox = () => {
        updateNodeVisibility();
        const bounds = m.getBounds();
        // Snap the requested area outward to the 0.1° tile grid the server
        // caches on. Small pans/zooms within the same tiles then produce an
        // identical bbox string, so the network query is reused from cache
        // instead of refetching on every map movement.
        const TILE_SIZE_DEG = 0.1;
        const snap = (v: number, mode: "floor" | "ceil") => {
          const tiles = v / TILE_SIZE_DEG;
          const t = mode === "floor" ? Math.floor(tiles) : Math.ceil(tiles);
          return Number((t * TILE_SIZE_DEG).toFixed(3));
        };
        const west = snap(bounds.getWest(), "floor");
        const south = snap(bounds.getSouth(), "floor");
        const east = snap(bounds.getEast(), "ceil");
        const north = snap(bounds.getNorth(), "ceil");
        const bboxStr = `${west},${south},${east},${north}`;
        setLfBbox(bboxStr);

        // Work out which way the user just panned by comparing the new view
        // centre with the previous settled centre. The resulting (dx, dy)
        // vector (in degrees) lets the pre-loader prioritise the neighbouring
        // tiles the user is actually heading toward. A pure zoom or the very
        // first settle leaves the centre unchanged, so direction is null.
        const centre = m.getCenter();
        const prev = lastCenterRef.current;
        let direction: { dx: number; dy: number } | null = null;
        if (prev) {
          const dx = centre.lng - prev.lon;
          const dy = centre.lat - prev.lat;
          if (Math.abs(dx) > 1e-9 || Math.abs(dy) > 1e-9) {
            direction = { dx, dy };
          }
        }
        lastCenterRef.current = { lon: centre.lng, lat: centre.lat };

        onBboxChangeRef.current(bboxStr, direction);
      };

      m.on("moveend", updateBbox);
      updateBbox();

      // Pause auto-follow when the rider pans/zooms by hand. A user gesture
      // carries an originalEvent; the follow easeTo (and other programmatic
      // moves) do not, so this only fires on genuine rider interaction and
      // never feeds back on the follow animation itself.
      m.on("movestart", (e) => {
        if (!e.originalEvent) return;
        if (followRideRef.current && ridePositionRef.current) {
          onFollowPauseRef.current?.();
        }
      });
    });

  }, []);

  useEffect(() => {
    if (!map.current) return;
    const m = map.current;
    const apply = () => {
      const showMap = baseLayer === "map";
      STREET_STYLES.forEach((style) => {
        m.setLayoutProperty(
          streetLayerId(style),
          "visibility",
          showMap && style === streetStyle ? "visible" : "none",
        );
      });
      m.setLayoutProperty("satellite-tiles-layer", "visibility", showMap ? "none" : "visible");
      m.setLayoutProperty("satellite-labels-layer", "visibility", showMap ? "none" : "visible");
    };
    if (m.isStyleLoaded()) {
      apply();
      return;
    }
    m.once("load", apply);
    return () => {
      m.off("load", apply);
    };
  }, [baseLayer, streetStyle]);

  // Keep the LF-routes layer visibility in sync with the toggle.
  useEffect(() => {
    if (!map.current) return;
    const m = map.current;
    const apply = () => {
      if (m.getLayer("lf-routes-layer")) {
        m.setLayoutProperty(
          "lf-routes-layer",
          "visibility",
          lfEnabled ? "visible" : "none",
        );
      }
    };
    if (m.isStyleLoaded()) {
      apply();
      return;
    }
    m.once("load", apply);
    return () => {
      m.off("load", apply);
    };
  }, [lfEnabled]);

  // Push fetched LF-route geometries into the map source. One feature per
  // route line keeps hover hit-testing simple while carrying name/ref props.
  useEffect(() => {
    if (!map.current) return;
    const m = map.current;
    const apply = () => {
      const source = m.getSource("lf-routes") as maplibregl.GeoJSONSource | undefined;
      if (!source) return;
      source.setData({
        type: "FeatureCollection",
        features: (lfRoutesData?.routes ?? []).flatMap((route) =>
          route.lines.map((line, i) => ({
            type: "Feature" as const,
            id: `${route.id}-${i}`,
            properties: { id: route.id, name: route.name, ref: route.ref },
            geometry: { type: "LineString" as const, coordinates: line },
          })),
        ),
      });
    };
    if (m.isStyleLoaded()) {
      apply();
      return;
    }
    m.once("load", apply);
    return () => {
      m.off("load", apply);
    };
  }, [lfRoutesData]);

  const toggleLfRoutes = useCallback(() => {
    setLfEnabled((prev) => {
      const next = !prev;
      setLfRoutesEnabled(next);
      return next;
    });
  }, []);

  const toggleBaseLayer = useCallback((next: BaseLayer) => {
    setBaseLayerState(next);
    setBaseLayer(next);
  }, []);

  const chooseStreetStyle = useCallback((next: StreetStyle) => {
    setStreetStyleState(next);
    setStreetStyle(next);
    setBaseLayerState("map");
    setBaseLayer("map");
    setStyleMenuOpen(false);
  }, []);

  useEffect(() => {
    if (!styleMenuOpen) return;
    const onPointerDown = (e: PointerEvent) => {
      if (styleMenuRef.current && !styleMenuRef.current.contains(e.target as Node)) {
        setStyleMenuOpen(false);
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [styleMenuOpen]);

  useEffect(() => {
    if (!map.current || !map.current.isStyleLoaded()) return;
    const m = map.current;
    
    if (flyToRegion) {
      m.flyTo({
        center: [flyToRegion.lon, flyToRegion.lat],
        zoom: flyToRegion.zoom
      });
    }
  }, [flyToRegion]);

  useEffect(() => {
    if (!map.current || !fitBounds) return;
    const m = map.current;
    const apply = () => {
      m.fitBounds(
        [
          [fitBounds.west, fitBounds.south],
          [fitBounds.east, fitBounds.north],
        ],
        { padding: 40 },
      );
    };
    if (m.isStyleLoaded()) {
      apply();
      return;
    }
    m.once("load", apply);
    return () => {
      m.off("load", apply);
    };
  }, [fitBounds]);

  useEffect(() => {
    if (!map.current) return;
    const m = map.current;
    const apply = () => {
      const boundarySource = m.getSource("boundary") as maplibregl.GeoJSONSource | undefined;
      if (!boundarySource) return;
      boundarySource.setData({
        type: "FeatureCollection",
        features: boundaryGeometry
          ? [
              {
                type: "Feature",
                properties: {},
                geometry: boundaryGeometry as unknown as GeoJSON.Geometry,
              },
            ]
          : [],
      });
    };
    if (m.isStyleLoaded()) {
      apply();
      return;
    }
    m.once("load", apply);
    return () => {
      m.off("load", apply);
    };
  }, [boundaryGeometry]);

  useEffect(() => {
    if (!map.current || !map.current.isStyleLoaded()) return;
    const m = map.current;
    
    const nodesSource = m.getSource("nodes") as maplibregl.GeoJSONSource;
    if (nodesSource) {
      nodesSource.setData({
        type: "FeatureCollection",
        features: nodes.map(n => ({
          type: "Feature",
          id: n.id,
          properties: { id: n.id, ref: n.ref },
          geometry: { type: "Point", coordinates: [n.lon, n.lat] }
        }))
      });
    }

    const segmentsSource = m.getSource("segments") as maplibregl.GeoJSONSource;
    if (segmentsSource) {
      segmentsSource.setData({
        type: "FeatureCollection",
        features: segments.map(s => ({
          type: "Feature",
          properties: { id: s.id },
          geometry: { type: "LineString", coordinates: s.coordinates }
        }))
      });
    }

  }, [nodes, segments]);

  useEffect(() => {
    if (!map.current || !map.current.isStyleLoaded()) return;
    const m = map.current;

    nodes.forEach(n => {
      m.setFeatureState(
        { source: "nodes", id: n.id },
        { selected: false }
      );
    });

    selectedNodes.forEach(n => {
      m.setFeatureState(
        { source: "nodes", id: n.id },
        { selected: true }
      );
    });

    const routeSource = m.getSource("planned-route") as maplibregl.GeoJSONSource;
    if (routeSource) {
      routeSource.setData({
        type: "FeatureCollection",
        features: routeCoordinates && routeCoordinates.length > 0 ? [{
          type: "Feature",
          properties: {},
          geometry: { type: "LineString", coordinates: routeCoordinates }
        }] : []
      });
    }
    
    const importedSource = m.getSource("imported-route") as maplibregl.GeoJSONSource;
    if (importedSource) {
      importedSource.setData({
        type: "FeatureCollection",
        features: importedCoordinates && importedCoordinates.length > 0 ? [{
          type: "Feature",
          properties: {},
          geometry: { type: "LineString", coordinates: importedCoordinates }
        }] : []
      });
    }

  }, [selectedNodes, routeCoordinates, importedCoordinates, nodes]);

  // Push the ride's travelled polyline and lock markers into their sources.
  useEffect(() => {
    if (!map.current) return;
    const m = map.current;
    const apply = () => {
      const traveledSource = m.getSource("ride-traveled") as
        | maplibregl.GeoJSONSource
        | undefined;
      if (traveledSource) {
        traveledSource.setData({
          type: "FeatureCollection",
          features:
            traveledCoordinates && traveledCoordinates.length > 1
              ? [
                  {
                    type: "Feature",
                    properties: {},
                    geometry: {
                      type: "LineString",
                      coordinates: traveledCoordinates,
                    },
                  },
                ]
              : [],
        });
      }

      const locksSource = m.getSource("visited-locks") as
        | maplibregl.GeoJSONSource
        | undefined;
      if (locksSource) {
        locksSource.setData({
          type: "FeatureCollection",
          features: (visitedLockPoints ?? []).map((p) => ({
            type: "Feature",
            properties: {},
            geometry: { type: "Point", coordinates: [p.lon, p.lat] },
          })),
        });
      }
    };
    if (m.isStyleLoaded()) {
      apply();
      return;
    }
    m.once("load", apply);
    return () => {
      m.off("load", apply);
    };
  }, [traveledCoordinates, visitedLockPoints]);

  // Maintain the live "you are here" marker and, when following, recenter the
  // map on each new fix. The marker is a DOM element via maplibregl.Marker,
  // which the headless test map doesn't provide — so guard its existence.
  useEffect(() => {
    if (!map.current) return;
    const m = map.current;

    if (!ridePosition) {
      rideMarkerRef.current?.remove();
      rideMarkerRef.current = null;
      return;
    }

    if (typeof maplibregl.Marker !== "function") return;

    if (!rideMarkerRef.current) {
      const el = document.createElement("div");
      el.className = "ride-position-marker";
      el.style.width = "18px";
      el.style.height = "18px";
      el.style.borderRadius = "9999px";
      el.style.background = "#2563eb";
      el.style.border = "3px solid #ffffff";
      el.style.boxShadow = "0 0 0 2px rgba(37,99,235,0.4)";
      rideMarkerRef.current = new maplibregl.Marker({ element: el });
    }

    rideMarkerRef.current
      .setLngLat([ridePosition[0], ridePosition[1]])
      .addTo(m);

    if (followRide && typeof m.easeTo === "function") {
      m.easeTo({ center: [ridePosition[0], ridePosition[1]], duration: 800 });
    }
  }, [ridePosition, followRide]);

  // Remove the ride marker if the map is torn down.
  useEffect(() => {
    return () => {
      rideMarkerRef.current?.remove();
      rideMarkerRef.current = null;
    };
  }, []);

  return (
    <div className="relative w-full h-full">
      <div ref={mapContainer} className="w-full h-full bg-muted" />
      {!mapError && (onRecenter || (ridePosition && !followRide)) && (
        <div className="absolute left-3 top-3 z-10 flex flex-col items-start gap-2">
          {ridePosition && !followRide && onFollowResume && (
            <button
              type="button"
              onClick={onFollowResume}
              title={t("ride.recenterTitle")}
              className="flex items-center gap-1.5 rounded-md border border-primary bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground shadow-md backdrop-blur transition-colors hover:bg-primary/90"
            >
              <LocateFixed className="h-3.5 w-3.5" /> {t("ride.recenter")}
            </button>
          )}
          {onRecenter && (
            <button
              type="button"
              onClick={onRecenter}
              title={t("map.centerTitle")}
              className="flex items-center gap-1.5 rounded-md border border-border bg-card/95 px-3 py-1.5 text-xs font-medium text-muted-foreground shadow-md backdrop-blur transition-colors hover:bg-accent"
            >
              <LocateFixed className="h-3.5 w-3.5" /> {t("map.center")}
            </button>
          )}
        </div>
      )}
      {!mapError && (
        <div className="absolute right-3 top-3 z-10 flex flex-wrap items-start justify-end gap-2 max-w-[calc(100%-6rem)]">
          <button
            type="button"
            onClick={toggleLfRoutes}
            aria-pressed={lfEnabled}
            title={t("map.lfRoutesTitle")}
            className={
              "flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs font-medium shadow-md backdrop-blur transition-colors " +
              (lfEnabled
                ? "bg-primary text-primary-foreground"
                : "bg-card/95 text-muted-foreground hover:bg-accent")
            }
          >
            <Route className="h-3.5 w-3.5" /> {t("map.lfRoutes")}
          </button>
          {baseLayer === "map" && (
            <div className="relative" ref={styleMenuRef}>
              <button
                type="button"
                onClick={() => setStyleMenuOpen((open) => !open)}
                aria-haspopup="menu"
                aria-expanded={styleMenuOpen}
                title={t("map.styleTitle")}
                className="flex items-center gap-1.5 rounded-md border border-border bg-card/95 px-3 py-1.5 text-xs font-medium text-muted-foreground shadow-md backdrop-blur transition-colors hover:bg-accent"
              >
                <Palette className="h-3.5 w-3.5" /> {t(`map.style.${streetStyle}`)}
              </button>
              {styleMenuOpen && (
                <div
                  role="menu"
                  className="absolute right-0 top-full mt-1 flex min-w-[10rem] flex-col overflow-hidden rounded-md border border-border bg-card/95 shadow-md backdrop-blur"
                >
                  {STREET_STYLES.map((style) => {
                    const StyleIcon = STREET_STYLE_ICONS[style];
                    const active = style === streetStyle;
                    return (
                      <button
                        key={style}
                        type="button"
                        role="menuitemradio"
                        aria-checked={active}
                        onClick={() => chooseStreetStyle(style)}
                        className={
                          "flex items-center gap-2 px-3 py-1.5 text-left text-xs font-medium transition-colors " +
                          (active
                            ? "bg-primary text-primary-foreground"
                            : "text-muted-foreground hover:bg-accent")
                        }
                      >
                        <StyleIcon className="h-3.5 w-3.5" /> {t(`map.style.${style}`)}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}
          <div className="flex overflow-hidden rounded-md border border-border bg-card/95 shadow-md backdrop-blur">
            <button
              type="button"
              onClick={() => toggleBaseLayer("map")}
              aria-pressed={baseLayer === "map"}
              title={t("map.streetTitle")}
              className={
                "flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium transition-colors " +
                (baseLayer === "map"
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-accent")
              }
            >
              <MapIcon className="h-3.5 w-3.5" /> {t("map.street")}
            </button>
            <button
              type="button"
              onClick={() => toggleBaseLayer("satellite")}
              aria-pressed={baseLayer === "satellite"}
              title={t("map.satelliteTitle")}
              className={
                "flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium transition-colors " +
                (baseLayer === "satellite"
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-accent")
              }
            >
              <Satellite className="h-3.5 w-3.5" /> {t("map.satellite")}
            </button>
          </div>
        </div>
      )}
      {mapError && (
        <div className="absolute inset-0 flex items-center justify-center bg-muted p-8 text-center">
          <p className="max-w-md text-sm text-muted-foreground">
            {t("map.webglError")}
          </p>
        </div>
      )}
    </div>
  );
}
