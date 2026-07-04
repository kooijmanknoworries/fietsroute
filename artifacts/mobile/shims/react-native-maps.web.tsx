import React, {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { View, StyleSheet, ViewStyle } from "react-native";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

export const PROVIDER_DEFAULT = null;
export const PROVIDER_GOOGLE = "google" as const;

export interface LatLng {
  latitude: number;
  longitude: number;
}

export interface Region extends LatLng {
  latitudeDelta: number;
  longitudeDelta: number;
}

export interface MapViewProps {
  style?: ViewStyle | ViewStyle[];
  children?: React.ReactNode;
  provider?: string | null;
  initialRegion?: Region;
  region?: Region;
  onRegionChangeComplete?: (region: Region) => void;
  showsUserLocation?: boolean;
  showsMyLocationButton?: boolean;
  showsCompass?: boolean;
  testID?: string;
}

export interface MarkerProps {
  coordinate: LatLng;
  onPress?: () => void;
  anchor?: { x: number; y: number };
  zIndex?: number;
  children?: React.ReactNode;
  testID?: string;
}

export interface PolylineProps {
  coordinates: LatLng[];
  strokeColor?: string;
  strokeWidth?: number;
  lineDashPattern?: number[] | null;
}

export interface UrlTileProps {
  urlTemplate?: string;
  maximumZ?: number;
  tileSize?: number;
  shouldReplaceMapContent?: boolean;
}

export interface MapViewHandle {
  animateToRegion: (region: Region, duration?: number) => void;
}

const DEFAULT_REGION: Region = {
  latitude: 52.1,
  longitude: 5.3,
  latitudeDelta: 1.8,
  longitudeDelta: 1.8,
};

function regionToBounds(r: Region): L.LatLngBoundsExpression {
  const south = r.latitude - r.latitudeDelta / 2;
  const north = r.latitude + r.latitudeDelta / 2;
  const west = r.longitude - r.longitudeDelta / 2;
  const east = r.longitude + r.longitudeDelta / 2;
  return [
    [south, west],
    [north, east],
  ];
}

function mapToRegion(map: L.Map): Region {
  const bounds = map.getBounds();
  const center = map.getCenter();
  return {
    latitude: center.lat,
    longitude: center.lng,
    latitudeDelta: bounds.getNorth() - bounds.getSouth(),
    longitudeDelta: bounds.getEast() - bounds.getWest(),
  };
}

// react-native-maps components — identified by reference on the web overlay.
export function Marker(_props: MarkerProps): React.ReactElement | null {
  return null;
}

export function Polyline(_props: PolylineProps): React.ReactElement | null {
  return null;
}

export function UrlTile(_props: UrlTileProps): React.ReactElement | null {
  return null;
}

export function Callout({ children }: { children?: React.ReactNode }) {
  return <>{children}</>;
}

const MapViewWeb = forwardRef<MapViewHandle, MapViewProps>(function MapViewWeb(
  props,
  ref
) {
  const { style, children, initialRegion, region, onRegionChangeComplete } = props;
  const hostRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const onRegionRef = useRef(onRegionChangeComplete);
  onRegionRef.current = onRegionChangeComplete;

  // Bumped on every map movement so the marker/polyline overlay reprojects.
  const [, setTick] = useState(0);
  const rerender = () => setTick((t) => (t + 1) % 1_000_000);

  useEffect(() => {
    const el = hostRef.current;
    if (!el || mapRef.current) return;

    const map = L.map(el, {
      zoomControl: false,
      attributionControl: true,
    });
    mapRef.current = map;

    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: "© OpenStreetMap-bijdragers",
    }).addTo(map);

    const start = region ?? initialRegion ?? DEFAULT_REGION;
    map.fitBounds(regionToBounds(start), { animate: false });

    const onMove = () => rerender();
    const onMoveEnd = () => {
      rerender();
      onRegionRef.current?.(mapToRegion(map));
    };
    map.on("move", onMove);
    map.on("zoom", onMove);
    // `moveend` fires after both pan and zoom, so it alone drives the
    // region-complete callback; listening to `zoomend` too would double-fire it.
    map.on("moveend", onMoveEnd);

    // Leaflet needs a size recalculation once the container has laid out.
    const resize = () => map.invalidateSize();
    const raf = requestAnimationFrame(resize);
    window.addEventListener("resize", resize);
    rerender();

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useImperativeHandle(
    ref,
    () => ({
      animateToRegion(target: Region, duration = 500) {
        const map = mapRef.current;
        if (!map) return;
        map.flyToBounds(regionToBounds(target), {
          duration: Math.max(duration, 0) / 1000,
        });
      },
    }),
    []
  );

  const map = mapRef.current;
  const markers: React.ReactElement[] = [];
  const polylinePaths: React.ReactElement[] = [];

  if (map) {
    React.Children.toArray(children).forEach((child, index) => {
      if (!React.isValidElement(child)) return;

      if (child.type === Marker) {
        const { coordinate, onPress, zIndex, children: markerChildren } =
          child.props as MarkerProps;
        const point = map.latLngToContainerPoint([
          coordinate.latitude,
          coordinate.longitude,
        ]);
        markers.push(
          <div
            key={child.key ?? `marker-${index}`}
            onClick={onPress}
            style={{
              position: "absolute",
              left: point.x,
              top: point.y,
              transform: "translate(-50%, -50%)",
              zIndex: zIndex ?? 1,
              pointerEvents: onPress ? "auto" : "none",
              cursor: onPress ? "pointer" : "default",
            }}
          >
            {markerChildren}
          </div>
        );
      } else if (child.type === Polyline) {
        const { coordinates, strokeColor, strokeWidth } =
          child.props as PolylineProps;
        if (!coordinates || coordinates.length < 2) return;
        const points = coordinates
          .map((c) => {
            const p = map.latLngToContainerPoint([c.latitude, c.longitude]);
            return `${p.x},${p.y}`;
          })
          .join(" ");
        polylinePaths.push(
          <polyline
            key={child.key ?? `polyline-${index}`}
            points={points}
            fill="none"
            stroke={strokeColor ?? "#336b45"}
            strokeWidth={strokeWidth ?? 4}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        );
      }
    });
  }

  return (
    <View style={[styles.container, style as ViewStyle]}>
      <View ref={hostRef as never} style={StyleSheet.absoluteFillObject} />
      <View
        style={StyleSheet.absoluteFillObject}
        pointerEvents="box-none"
      >
        {polylinePaths.length > 0 && (
          <svg
            width="100%"
            height="100%"
            style={{
              position: "absolute",
              inset: 0,
              pointerEvents: "none",
            }}
          >
            {polylinePaths}
          </svg>
        )}
        {markers}
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    flex: 1,
    overflow: "hidden",
  },
});

export default MapViewWeb;
