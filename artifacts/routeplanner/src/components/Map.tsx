import { useState, useRef, useEffect, useCallback } from "react";
import maplibregl from "maplibre-gl";
import { NetworkNode, NetworkSegment } from "@workspace/api-client-react";

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
  onBboxChange: (bbox: string) => void;
  onNodeClick: (node: NetworkNode) => void;
  flyToRegion?: { lat: number; lon: number; zoom: number } | null;
  initialBounds?: Bounds | null;
  fitBounds?: Bounds | null;
}

const OSM_TILE_URLS = [
  "https://a.tile.openstreetmap.org/{z}/{x}/{y}.png",
  "https://b.tile.openstreetmap.org/{z}/{x}/{y}.png",
  "https://c.tile.openstreetmap.org/{z}/{x}/{y}.png"
];

const UTRECHT = { lat: 52.0907, lon: 5.1214, zoom: 13 };

export default function Map({
  nodes,
  segments,
  selectedNodes,
  routeCoordinates,
  importedCoordinates,
  onBboxChange,
  onNodeClick,
  flyToRegion,
  initialBounds,
  fitBounds
}: MapProps) {
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const nodesRef = useRef(nodes);
  const onNodeClickRef = useRef(onNodeClick);
  const [mapError, setMapError] = useState(false);

  nodesRef.current = nodes;
  onNodeClickRef.current = onNodeClick;

  useEffect(() => {
    if (map.current || !mapContainer.current) return;

    try {
      map.current = new maplibregl.Map({
        container: mapContainer.current,
        style: {
          version: 8,
          sources: {
            "raster-tiles": {
              type: "raster",
              tiles: OSM_TILE_URLS,
              tileSize: 256,
              attribution: 'Map data &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
            }
          },
          layers: [
            {
              id: "simple-tiles",
              type: "raster",
              source: "raster-tiles",
              minzoom: 0,
              maxzoom: 22
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
      return;
    }

    const m = map.current;

    m.on("load", () => {
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

      const updateBbox = () => {
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
        onBboxChange(bboxStr);
      };

      m.on("moveend", updateBbox);
      updateBbox();
    });

  }, []);

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

  return (
    <div className="relative w-full h-full">
      <div ref={mapContainer} className="w-full h-full bg-muted" />
      {mapError && (
        <div className="absolute inset-0 flex items-center justify-center bg-muted p-8 text-center">
          <p className="max-w-md text-sm text-muted-foreground">
            The interactive map could not start because this browser or
            environment does not support WebGL. Try opening the app in a
            standard desktop browser with hardware acceleration enabled.
          </p>
        </div>
      )}
    </div>
  );
}
