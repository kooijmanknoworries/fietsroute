import React, { useEffect, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Platform,
} from "react-native";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
} from "react-native-reanimated";
import { useColors } from "@/hooks/useColors";
import { useRoutePlanner } from "@/context/RoutePlannerContext";
import { useRideContext } from "@/context/RideContext";
import SaveRouteModal from "@/components/SaveRouteModal";

function formatDistance(meters: number): string {
  if (meters >= 1000) {
    return `${(meters / 1000).toFixed(1)} km`;
  }
  return `${Math.round(meters)} m`;
}

export default function RoutePanel() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { selectedNodes, routePlan, isPlanning, planError, clearRoute, undoLastNode, removeNode } =
    useRoutePlanner();
  const {
    canRide,
    isRiding,
    startRide,
    stopRide,
    gpsError,
    ridePosition,
    progressMeters,
    totalMeters,
  } = useRideContext();

  const [saveVisible, setSaveVisible] = useState(false);

  const canSave = selectedNodes.length >= 2 && !!routePlan;

  const translateY = useSharedValue(200);

  useEffect(() => {
    if (selectedNodes.length > 0) {
      translateY.value = withSpring(0, { damping: 20, stiffness: 200 });
    } else {
      translateY.value = withSpring(200, { damping: 20, stiffness: 200 });
    }
  }, [selectedNodes.length]);

  const animStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
  }));

  const bottomPad = Platform.OS === "web" ? 34 : insets.bottom;

  if (selectedNodes.length === 0) return null;

  return (
    <Animated.View
      style={[
        styles.panel,
        animStyle,
        {
          backgroundColor: colors.card,
          borderColor: colors.border,
          paddingBottom: bottomPad + 8,
        },
      ]}
    >
      <View style={styles.handleContainer}>
        <View style={[styles.handle, { backgroundColor: colors.border }]} />
      </View>

      <View style={styles.header}>
        <View style={styles.headerLeft}>
          {isPlanning ? (
            <ActivityIndicator size="small" color={colors.primary} />
          ) : routePlan ? (
            <View style={styles.distanceBadge}>
              <MaterialCommunityIcons name="bike" size={16} color={colors.primary} />
              <Text style={[styles.distanceText, { color: colors.primary, fontFamily: "Inter_600SemiBold" }]}>
                {formatDistance(routePlan.distanceMeters)}
              </Text>
            </View>
          ) : planError ? (
            <Text style={[styles.errorText, { color: colors.destructive, fontFamily: "Inter_400Regular" }]}>
              {planError}
            </Text>
          ) : (
            <Text style={[styles.hintText, { color: colors.mutedForeground, fontFamily: "Inter_400Regular" }]}>
              Tik een knooppunt toe
            </Text>
          )}
        </View>
        <View style={styles.headerActions}>
          {canSave && (
            <TouchableOpacity
              onPress={() => setSaveVisible(true)}
              style={[styles.saveBtn, { backgroundColor: colors.primary }]}
              testID="save-route"
            >
              <Ionicons name="bookmark-outline" size={16} color="#ffffff" />
              <Text style={[styles.saveBtnText, { fontFamily: "Inter_600SemiBold" }]}>Opslaan</Text>
            </TouchableOpacity>
          )}
          {selectedNodes.length > 1 && (
            <TouchableOpacity
              onPress={undoLastNode}
              style={[styles.iconBtn, { backgroundColor: colors.muted }]}
              testID="undo-node"
            >
              <Ionicons name="arrow-undo" size={18} color={colors.foreground} />
            </TouchableOpacity>
          )}
          <TouchableOpacity
            onPress={clearRoute}
            style={[styles.iconBtn, { backgroundColor: colors.muted }]}
            testID="clear-route"
          >
            <Ionicons name="trash-outline" size={18} color={colors.destructive} />
          </TouchableOpacity>
        </View>
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.nodeList}
        scrollEnabled={!!selectedNodes && selectedNodes.length > 3}
      >
        {selectedNodes.map((node, index) => (
          <View key={node.id} style={styles.nodeChipWrapper}>
            {index > 0 && (
              <View style={[styles.arrowConnector, { backgroundColor: colors.border }]} />
            )}
            <TouchableOpacity
              onPress={() => removeNode(node.id)}
              style={[
                styles.nodeChip,
                {
                  backgroundColor:
                    index === 0
                      ? colors.primary
                      : index === selectedNodes.length - 1
                      ? colors.destructive
                      : colors.secondary,
                  borderColor: colors.border,
                },
              ]}
              testID={`node-chip-${node.ref}`}
            >
              <Text
                style={[
                  styles.nodeChipText,
                  {
                    color:
                      index === 0 || index === selectedNodes.length - 1
                        ? "#ffffff"
                        : colors.foreground,
                    fontFamily: "Inter_700Bold",
                  },
                ]}
              >
                {node.ref}
              </Text>
            </TouchableOpacity>
          </View>
        ))}
      </ScrollView>

      {selectedNodes.length >= 2 && routePlan && (
        <View style={[styles.routeSummary, { borderTopColor: colors.border }]}>
          <Text style={[styles.routeSummaryText, { color: colors.mutedForeground, fontFamily: "Inter_400Regular" }]}>
            {selectedNodes.length} knooppunten · {routePlan.legs.length} etappe{routePlan.legs.length !== 1 ? "s" : ""}
          </Text>
        </View>
      )}

      {(canRide || isRiding) && (
        <View style={[styles.rideSection, { borderTopColor: colors.border }]}>
          {!isRiding ? (
            <TouchableOpacity
              onPress={startRide}
              style={[styles.rideStartBtn, { backgroundColor: colors.primary }]}
              testID="start-ride"
            >
              <Ionicons name="play" size={18} color="#ffffff" />
              <Text style={[styles.rideStartText, { fontFamily: "Inter_600SemiBold" }]}>Rit starten</Text>
            </TouchableOpacity>
          ) : (
            <View style={styles.rideActive}>
              <View style={styles.rideStatusRow}>
                <View style={styles.rideStatusLeft}>
                  <View style={[styles.liveDot, { backgroundColor: colors.primary }]} />
                  <Text style={[styles.rideStatusText, { color: colors.primary, fontFamily: "Inter_600SemiBold" }]}>
                    Rit bezig
                  </Text>
                </View>
                <Text style={[styles.rideProgressText, { color: colors.mutedForeground, fontFamily: "Inter_400Regular" }]}>
                  {formatDistance(progressMeters)} van {formatDistance(totalMeters)} gereden
                </Text>
              </View>

              {gpsError ? (
                <View style={[styles.rideNotice, { backgroundColor: colors.muted }]}>
                  <Ionicons name="warning-outline" size={14} color={colors.destructive} />
                  <Text style={[styles.rideNoticeText, { color: colors.destructive, fontFamily: "Inter_400Regular" }]}>
                    {gpsError === "denied"
                      ? "Locatietoegang is geblokkeerd. Sta locatietoegang toe om je rit te volgen."
                      : "Je locatie is nu niet beschikbaar. Het volgen gaat verder zodra er weer gps is."}
                  </Text>
                </View>
              ) : !ridePosition ? (
                <View style={styles.rideNotice}>
                  <ActivityIndicator size="small" color={colors.mutedForeground} />
                  <Text style={[styles.rideNoticeText, { color: colors.mutedForeground, fontFamily: "Inter_400Regular" }]}>
                    Wachten op gps-signaal…
                  </Text>
                </View>
              ) : null}

              <TouchableOpacity
                onPress={stopRide}
                style={[styles.rideStopBtn, { borderColor: colors.border }]}
                testID="stop-ride"
              >
                <Ionicons name="stop" size={18} color={colors.destructive} />
                <Text style={[styles.rideStopText, { color: colors.foreground, fontFamily: "Inter_600SemiBold" }]}>
                  Rit stoppen
                </Text>
              </TouchableOpacity>
            </View>
          )}
        </View>
      )}

      <SaveRouteModal visible={saveVisible} onClose={() => setSaveVisible(false)} />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  panel: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderWidth: 1,
    paddingHorizontal: 16,
    paddingTop: 4,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.1,
    shadowRadius: 12,
    elevation: 8,
  },
  handleContainer: {
    alignItems: "center",
    paddingVertical: 8,
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 12,
  },
  headerLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    flex: 1,
  },
  headerActions: {
    flexDirection: "row",
    gap: 8,
  },
  iconBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  saveBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    height: 36,
    paddingHorizontal: 14,
    borderRadius: 18,
  },
  saveBtnText: {
    color: "#ffffff",
    fontSize: 14,
  },
  distanceBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  distanceText: {
    fontSize: 20,
  },
  errorText: {
    fontSize: 14,
  },
  hintText: {
    fontSize: 14,
  },
  nodeList: {
    flexDirection: "row",
    alignItems: "center",
    paddingBottom: 8,
    gap: 0,
  },
  nodeChipWrapper: {
    flexDirection: "row",
    alignItems: "center",
  },
  arrowConnector: {
    width: 16,
    height: 2,
    marginHorizontal: 2,
  },
  nodeChip: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
  },
  nodeChipText: {
    fontSize: 14,
  },
  routeSummary: {
    borderTopWidth: 1,
    paddingTop: 8,
    marginTop: 4,
  },
  routeSummaryText: {
    fontSize: 12,
    textAlign: "center",
  },
  rideSection: {
    borderTopWidth: 1,
    paddingTop: 12,
    marginTop: 8,
  },
  rideStartBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    height: 48,
    borderRadius: 12,
  },
  rideStartText: {
    color: "#ffffff",
    fontSize: 15,
  },
  rideActive: {
    gap: 10,
  },
  rideStatusRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  rideStatusLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  liveDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  rideStatusText: {
    fontSize: 14,
  },
  rideProgressText: {
    fontSize: 13,
  },
  rideNotice: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 10,
  },
  rideNoticeText: {
    flex: 1,
    fontSize: 12,
    lineHeight: 17,
  },
  rideStopBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    height: 48,
    borderRadius: 12,
    borderWidth: 1,
  },
  rideStopText: {
    fontSize: 15,
  },
});
