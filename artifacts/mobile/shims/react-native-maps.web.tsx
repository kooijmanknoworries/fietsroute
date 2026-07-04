import React from "react";
import { View, StyleSheet, ViewStyle } from "react-native";

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
  ref?: React.Ref<any>;
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

class MapViewWeb extends React.Component<MapViewProps> {
  animateToRegion(_region: Region, _duration?: number) {}
  render() {
    const { style, children } = this.props;
    return (
      <View style={[styles.container, style as ViewStyle]}>
        {/* Web preview — use Expo Go on a real device for the interactive map */}
        <View style={styles.webMapFallback}>
          <View style={styles.placeholder} />
        </View>
        {children}
      </View>
    );
  }
}

export function Marker({ children }: MarkerProps) {
  return <>{children}</>;
}

export function Polyline(_props: PolylineProps) {
  return null;
}

export function UrlTile(_props: UrlTileProps) {
  return null;
}

export function Callout({ children }: { children?: React.ReactNode }) {
  return <>{children}</>;
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    overflow: "hidden",
  },
  webMapFallback: {
    flex: 1,
    backgroundColor: "#e8e4dc",
  },
  placeholder: {
    flex: 1,
  },
});

export default MapViewWeb;
