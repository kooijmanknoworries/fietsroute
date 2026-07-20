import React, { useState, useCallback, useEffect, useRef } from "react";
import {
  View,
  StyleSheet,
  TouchableOpacity,
  Text,
  Platform,
  ActivityIndicator,
} from "react-native";
import MapView, { Marker, Polyline, UrlTile, Region, PROVIDER_DEFAULT } from "react-native-maps";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter, Redirect, type Href } from "expo-router";
import { useAuth } from "@clerk/expo";
import { useQuery } from "@tanstack/react-query";
import { getNetwork, getPois, MunicipalityResult } from "@workspace/api-client-react";
import {
  POI_CATEGORIES,
  POI_COLORS,
  POI_ICONS,
  POI_LABELS,
  filterPoisAlongRoute,
  type PoiCategory,
} from "@/lib/poi";
import { useColors } from "@/hooks/useColors";
import { useRoutePlanner, NetworkNode } from "@/context/RoutePlannerContext";
import { useRideContext } from "@/context/RideContext";
import RoutePanel from "@/components/RoutePanel";
import RideOverlay from "@/components/RideOverlay";
import RegionPicker from "@/components/RegionPicker";
import RideSummaryModal from "@/components/RideSummaryModal";
import { isPlanningTapAllowed, shouldRenderPlanningMarkers } from "@/lib/planning-guard";

const INITIAL_REGION: Region = {
  latitude: 52.1,
  longitude: 5.3,
  latitudeDelta: 1.8,
  longitudeDelta: 1.8,
};

function snapCoord(v: number): number {
  return Number(v.toFixed(3));
}

function regionToBbox(r: Region): string {
  const west = snapCoord(r.longitude - r.longitudeDelta / 2);
  const south = snapCoord(r.latitude - r.latitudeDelta / 2);
  const east = snapCoord(r.longitude + r.longitudeDelta / 2);
  const north = snapCoord(r.latitude + r.latitudeDelta / 2);
  return `${west},${south},${east},${north}`;
}

interface Region2 {
  id: string;
  name: string;
  country: string;
  lat: number;
  lon: number;
  zoom: number;
}

function zoomLevelFromDelta(delta: number): number {
  return Math.round(Math.log(360 / delta) / Math.log(2));
}

// Gate the map/planning screen (and thus GPS ride tracking) behind an
// authenticated Clerk session. Signed-out users are redirected to the sign-in
// screen and only reach the planner once signed in. ClerkLoaded in the root
// layout guarantees Clerk is loaded by the time this renders, but the isLoaded
// guard stays as a safety net.
export default function MapScreen() {
  const { isLoaded, isSignedIn } = useAuth();
  if (!isLoaded) return null;
  if (!isSignedIn) return <Redirect href={"/(auth)/sign-in" as Href} />;
  return <MapScreenInner />;
}

function MapScreenInner() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { selectedNodes, routePlan, isPlanning, addNode, addFreePoint, planMode, setPlanMode } =
    useRoutePlanner();
  const { isRiding, ridePosition, rideSummary, dismissRideSummary } = useRideContext();
  const mapRef = useRef<MapView>(null);

  const [mapRegion, setMapRegion] = useState<Region>(INITIAL_REGION);
  // Latest region, readable from inside effects without re-running them.
  const mapRegionRef = useRef<Region>(INITIAL_REGION);
  const [showNodes, setShowNodes] = useState(false);

  const bbox = showNodes ? regionToBbox(mapRegion) : "";

  const { data: networkData, isFetching: networkLoading } = useQuery({
    queryKey: ["network", bbox],
    queryFn: () => getNetwork({ bbox }),
    enabled: !!bbox && showNodes,
    staleTime: 5 * 60 * 1000,
    placeholderData: (prev) => prev,
  });

  // Points of interest: user-toggled categories, fetched for the visible
  // viewport (same zoom gate as the knooppunten so we never query huge areas).
  const [poiCategories, setPoiCategories] = useState<PoiCategory[]>([]);
  const [poiAlongRoute, setPoiAlongRoute] = useState(false);
  const [poiMenuOpen, setPoiMenuOpen] = useState(false);
  const poiCategoriesParam = [...poiCategories].sort().join(",");
  const poisEnabled = poiCategories.length > 0 && !!bbox;
  const { data: poiData } = useQuery({
    queryKey: ["pois", bbox, poiCategoriesParam],
    queryFn: () => getPois({ bbox, categories: poiCategoriesParam }),
    enabled: poisEnabled,
    staleTime: 5 * 60 * 1000,
    placeholderData: (prev) => prev,
  });

  const togglePoiCategory = useCallback((category: PoiCategory) => {
    setPoiCategories((prev) =>
      prev.includes(category)
        ? prev.filter((c) => c !== category)
        : [...prev, category],
    );
  }, []);

  const visiblePois = React.useMemo(() => {
    const all = poisEnabled ? (poiData?.pois ?? []) : [];
    const coords = routePlan?.coordinates;
    if (!poiAlongRoute || !coords || coords.length === 0) return all;
    return filterPoisAlongRoute(all, coords);
  }, [poisEnabled, poiData, poiAlongRoute, routePlan]);

  const handleRegionChangeComplete = useCallback((r: Region) => {
    mapRegionRef.current = r;
    setMapRegion(r);
    const zoom = zoomLevelFromDelta(r.latitudeDelta);
    setShowNodes(zoom >= 11);
  }, []);

  const handleNodePress = useCallback(
    (node: NetworkNode) => {
      // Ignore planning taps while riding so an accidental marker tap can't
      // mutate the route and abort the ride.
      if (!isPlanningTapAllowed({ isRiding })) return;
      addNode(node);
    },
    [addNode, isRiding]
  );

  // Offgrid mode: a tap on the bare map adds a free waypoint. Node markers
  // call stopPropagation via their own onPress, and react-native-maps only
  // fires onPress for taps that didn't hit a marker.
  const handleMapPress = useCallback(
    (e: { nativeEvent: { coordinate?: { latitude: number; longitude: number } } }) => {
      if (planMode !== "offgrid") return;
      if (!isPlanningTapAllowed({ isRiding })) return;
      const coord = e.nativeEvent?.coordinate;
      if (!coord) return;
      addFreePoint(coord.latitude, coord.longitude);
    },
    [planMode, isRiding, addFreePoint]
  );

  const handleSelectRegion = useCallback((region: Region2) => {
    const delta = 360 / Math.pow(2, region.zoom ?? 12);
    mapRef.current?.animateToRegion(
      {
        latitude: region.lat,
        longitude: region.lon,
        latitudeDelta: delta,
        longitudeDelta: delta,
      },
      600
    );
  }, []);

  const handleSelectMunicipality = useCallback((m: MunicipalityResult) => {
    const { south, north, west, east } = m.boundingBox;
    const latitudeDelta = Math.max((north - south) * 1.3, 0.02);
    const longitudeDelta = Math.max((east - west) * 1.3, 0.02);
    mapRef.current?.animateToRegion(
      {
        latitude: (north + south) / 2,
        longitude: (east + west) / 2,
        latitudeDelta,
        longitudeDelta,
      },
      600
    );
  }, []);

  // Follow the rider: on the first GPS fix of a ride, zoom to a close
  // road-following view (~200 m across); on later fixes, keep them centred.
  const rideZoomedRef = useRef(false);
  useEffect(() => {
    if (!isRiding || !ridePosition) {
      rideZoomedRef.current = false;
      return;
    }
    const firstFix = !rideZoomedRef.current;
    rideZoomedRef.current = true;
    const delta = firstFix ? 0.004 : undefined;
    const current = mapRegionRef.current;
    mapRef.current?.animateToRegion(
      {
        latitude: ridePosition[1],
        longitude: ridePosition[0],
        latitudeDelta: delta ?? current.latitudeDelta,
        longitudeDelta: delta ?? current.longitudeDelta,
      },
      firstFix ? 1000 : 600
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isRiding, ridePosition]);

  const selectedNodeIds = new Set(selectedNodes.map((n) => n.id));

  const routeCoords =
    routePlan?.coordinates.map(([lon, lat]) => ({ latitude: lat, longitude: lon })) ?? [];

  const topPad = Platform.OS === "web" ? 67 : insets.top;

  return (
    <View style={styles.container}>
      <MapView
        ref={mapRef}
        provider={PROVIDER_DEFAULT}
        style={StyleSheet.absoluteFillObject}
        initialRegion={INITIAL_REGION}
        onRegionChangeComplete={handleRegionChangeComplete}
        onPress={handleMapPress}
        showsUserLocation
        showsMyLocationButton={false}
        showsCompass={false}
        testID="map-view"
      >
        <UrlTile
          urlTemplate="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
          maximumZ={19}
          tileSize={256}
          shouldReplaceMapContent={Platform.OS !== "web"}
        />

        {showNodes && shouldRenderPlanningMarkers({ isRiding }) &&
          networkData?.nodes.map((node) => {
            const isSelected = selectedNodeIds.has(node.id);
            return (
              <Marker
                key={node.id}
                coordinate={{ latitude: node.lat, longitude: node.lon }}
                onPress={() => handleNodePress(node)}
                anchor={{ x: 0.5, y: 0.5 }}
                testID={`node-marker-${node.ref}`}
              >
                <View
                  style={[
                    styles.markerContainer,
                    {
                      backgroundColor: isSelected ? colors.primary : colors.card,
                      borderColor: isSelected ? colors.primary : colors.border,
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.markerText,
                      {
                        color: isSelected ? "#ffffff" : colors.foreground,
                        fontFamily: "Inter_700Bold",
                      },
                    ]}
                  >
                    {node.ref}
                  </Text>
                </View>
              </Marker>
            );
          })}

        {routePlan?.legs?.length
          ? routePlan.legs.map((leg, i) =>
              leg.coordinates.length > 1 ? (
                <Polyline
                  key={`leg-${i}`}
                  coordinates={leg.coordinates.map(([lon, lat]) => ({
                    latitude: lat,
                    longitude: lon,
                  }))}
                  strokeColor={leg.mode === "offgrid" ? "#d97706" : colors.primary}
                  strokeWidth={4}
                  lineDashPattern={leg.mode === "offgrid" ? [8, 6] : undefined}
                />
              ) : null
            )
          : routeCoords.length > 1 && (
              <Polyline
                coordinates={routeCoords}
                strokeColor={colors.primary}
                strokeWidth={4}
                lineDashPattern={undefined}
              />
            )}

        {selectedNodes.map((node) => (
          <Marker
            key={`selected-${node.id}`}
            coordinate={{ latitude: node.lat, longitude: node.lon }}
            anchor={{ x: 0.5, y: 0.5 }}
            zIndex={10}
          >
            {node.kind === "free" ? (
              <View
                style={[
                  styles.freeMarker,
                  { backgroundColor: "#d97706", borderColor: "#ffffff" },
                ]}
              >
                <Ionicons name="navigate" size={14} color="#ffffff" />
              </View>
            ) : (
              <View
                style={[
                  styles.selectedMarker,
                  { backgroundColor: colors.primary, borderColor: "#ffffff" },
                ]}
              >
                <Text style={[styles.selectedMarkerText, { fontFamily: "Inter_700Bold" }]}>
                  {node.ref}
                </Text>
              </View>
            )}
          </Marker>
        ))}

        {visiblePois.map((poi) => (
          <Marker
            key={`poi-${poi.id}`}
            coordinate={{ latitude: poi.lat, longitude: poi.lon }}
            anchor={{ x: 0.5, y: 0.5 }}
            title={poi.name ?? POI_LABELS[poi.category as PoiCategory] ?? poi.category}
            description={POI_LABELS[poi.category as PoiCategory] ?? poi.category}
            zIndex={5}
            testID={`poi-marker-${poi.id}`}
          >
            <View
              style={[
                styles.poiMarker,
                {
                  backgroundColor:
                    POI_COLORS[poi.category as PoiCategory] ?? "#64748b",
                },
              ]}
            >
              <Ionicons
                name={POI_ICONS[poi.category as PoiCategory] ?? "location"}
                size={13}
                color="#ffffff"
              />
            </View>
          </Marker>
        ))}

        {ridePosition && (
          <Marker
            coordinate={{ latitude: ridePosition[1], longitude: ridePosition[0] }}
            anchor={{ x: 0.5, y: 0.5 }}
            zIndex={20}
            testID="ride-position-marker"
          >
            <View style={[styles.ridePositionOuter, { backgroundColor: colors.primary }]}>
              <Ionicons name="bicycle" size={20} color="#ffffff" />
            </View>
          </Marker>
        )}
      </MapView>

      {!isRiding && (
        <RegionPicker
          onSelectRegion={handleSelectRegion}
          onSelectMunicipality={handleSelectMunicipality}
        />
      )}

      {!isRiding && (
        <View
          style={[
            styles.modeToggle,
            {
              backgroundColor: colors.card,
              borderColor: colors.border,
              top: topPad + 64,
              right: 16,
            },
          ]}
        >
          <TouchableOpacity
            onPress={() => setPlanMode("network")}
            style={[
              styles.modeBtn,
              planMode === "network" && { backgroundColor: colors.primary },
            ]}
            testID="mode-network"
          >
            <Text
              style={[
                styles.modeBtnText,
                {
                  color: planMode === "network" ? "#ffffff" : colors.mutedForeground,
                  fontFamily: "Inter_600SemiBold",
                },
              ]}
            >
              Knooppunt
            </Text>
          </TouchableOpacity>
        </View>
      )}

      {!isRiding && (
        <TouchableOpacity
          onPress={() => router.push("/saved" as Href)}
          style={[
            styles.savedBtn,
            {
              backgroundColor: colors.card,
              borderColor: colors.border,
              top: topPad + 12,
              right: 16,
            },
          ]}
          testID="open-saved-routes"
        >
          <Ionicons name="bookmark-outline" size={20} color={colors.primary} />
        </TouchableOpacity>
      )}

      {!isRiding && (
        <>
          <TouchableOpacity
            onPress={() => setPoiMenuOpen((open) => !open)}
            style={[
              styles.savedBtn,
              {
                backgroundColor: poiCategories.length > 0 ? colors.primary : colors.card,
                borderColor: poiCategories.length > 0 ? colors.primary : colors.border,
                top: topPad + 64,
                right: 16,
              },
            ]}
            testID="poi-menu-button"
          >
            <Ionicons
              name="pin"
              size={20}
              color={poiCategories.length > 0 ? "#ffffff" : colors.primary}
            />
          </TouchableOpacity>

          {poiMenuOpen && (
            <View
              style={[
                styles.poiMenu,
                {
                  backgroundColor: colors.card,
                  borderColor: colors.border,
                  top: topPad + 116,
                  right: 16,
                },
              ]}
              testID="poi-menu"
            >
              {POI_CATEGORIES.map((category) => {
                const active = poiCategories.includes(category);
                return (
                  <TouchableOpacity
                    key={category}
                    onPress={() => togglePoiCategory(category)}
                    style={styles.poiMenuItem}
                    testID={`poi-toggle-${category}`}
                  >
                    <View
                      style={[
                        styles.poiMenuDot,
                        {
                          backgroundColor: POI_COLORS[category],
                          opacity: active ? 1 : 0.35,
                        },
                      ]}
                    >
                      <Ionicons name={POI_ICONS[category]} size={11} color="#ffffff" />
                    </View>
                    <Text
                      style={[
                        styles.poiMenuLabel,
                        {
                          color: active ? colors.foreground : colors.mutedForeground,
                          fontFamily: active ? "Inter_500Medium" : "Inter_400Regular",
                        },
                      ]}
                    >
                      {POI_LABELS[category]}
                    </Text>
                    {active && (
                      <Ionicons name="checkmark" size={16} color={colors.primary} />
                    )}
                  </TouchableOpacity>
                );
              })}
              <View style={[styles.poiMenuSeparator, { backgroundColor: colors.border }]} />
              <TouchableOpacity
                onPress={() => setPoiAlongRoute((v) => !v)}
                disabled={!routePlan?.coordinates?.length}
                style={styles.poiMenuItem}
                testID="poi-toggle-along-route"
              >
                <Ionicons
                  name="navigate"
                  size={15}
                  color={
                    routePlan?.coordinates?.length
                      ? colors.primary
                      : colors.mutedForeground
                  }
                />
                <Text
                  style={[
                    styles.poiMenuLabel,
                    {
                      color: routePlan?.coordinates?.length
                        ? colors.foreground
                        : colors.mutedForeground,
                      fontFamily: "Inter_400Regular",
                    },
                  ]}
                >
                  Alleen langs mijn route
                </Text>
                {poiAlongRoute && !!routePlan?.coordinates?.length && (
                  <Ionicons name="checkmark" size={16} color={colors.primary} />
                )}
              </TouchableOpacity>
              {poiCategories.length > 0 && !showNodes && (
                <Text
                  style={[
                    styles.poiMenuHint,
                    { color: colors.mutedForeground, fontFamily: "Inter_400Regular" },
                  ]}
                >
                  Zoom in om punten te zien
                </Text>
              )}
            </View>
          )}
        </>
      )}

      {networkLoading && !isRiding && (
        <View style={[styles.loadingIndicator, { top: topPad + 128, right: 16 }]}>
          <ActivityIndicator size="small" color={colors.primary} />
        </View>
      )}

      {!showNodes && !isRiding && (
        <View
          style={[
            styles.zoomHint,
            {
              backgroundColor: colors.card,
              borderColor: colors.border,
              top: topPad + 76,
              left: "50%",
              transform: [{ translateX: -90 }],
            },
          ]}
        >
          <Ionicons name="search-outline" size={14} color={colors.mutedForeground} />
          <Text style={[styles.zoomHintText, { color: colors.mutedForeground, fontFamily: "Inter_400Regular" }]}>
            Zoom in voor knooppunten
          </Text>
        </View>
      )}

      {isPlanning && (
        <View
          style={[
            styles.planningIndicator,
            { backgroundColor: colors.primary, bottom: 180 + (Platform.OS === "web" ? 34 : insets.bottom) },
          ]}
        >
          <ActivityIndicator size="small" color="#ffffff" />
          <Text style={[styles.planningText, { fontFamily: "Inter_500Medium" }]}>Route berekenen...</Text>
        </View>
      )}

      <RoutePanel />

      <RideOverlay />

      <RideSummaryModal summary={rideSummary} onClose={dismissRideSummary} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  markerContainer: {
    minWidth: 32,
    paddingHorizontal: 6,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.2,
    shadowRadius: 3,
    elevation: 3,
  },
  markerText: {
    fontSize: 12,
  },
  selectedMarker: {
    minWidth: 36,
    paddingHorizontal: 6,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 3,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 5,
  },
  selectedMarkerText: {
    fontSize: 13,
    color: "#ffffff",
  },
  freeMarker: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 3,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 5,
  },
  modeToggle: {
    position: "absolute",
    flexDirection: "row",
    borderRadius: 20,
    borderWidth: 1,
    overflow: "hidden",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  modeBtn: {
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  modeBtnText: {
    fontSize: 12,
  },
  offgridHint: {
    position: "absolute",
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
    right: 16,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 4,
    elevation: 2,
  },
  ridePositionOuter: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 3,
    borderColor: "#ffffff",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.3,
    shadowRadius: 3,
    elevation: 4,
  },
  savedBtn: {
    position: "absolute",
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  poiMarker: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: "#ffffff",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.25,
    shadowRadius: 3,
    elevation: 3,
  },
  poiMenu: {
    position: "absolute",
    minWidth: 220,
    borderRadius: 12,
    borderWidth: 1,
    paddingVertical: 4,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 5,
    zIndex: 30,
  },
  poiMenuItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 9,
  },
  poiMenuDot: {
    width: 20,
    height: 20,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  poiMenuLabel: {
    fontSize: 13,
    flex: 1,
  },
  poiMenuSeparator: {
    height: 1,
    marginVertical: 4,
  },
  poiMenuHint: {
    fontSize: 11,
    paddingHorizontal: 14,
    paddingBottom: 8,
    paddingTop: 2,
  },
  loadingIndicator: {
    position: "absolute",
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.9)",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  zoomHint: {
    position: "absolute",
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 4,
    elevation: 2,
    width: 180,
  },
  zoomHintText: {
    fontSize: 12,
  },
  planningIndicator: {
    position: "absolute",
    left: "50%",
    transform: [{ translateX: -70 }],
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 24,
  },
  planningText: {
    color: "#ffffff",
    fontSize: 14,
  },
});
