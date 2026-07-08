import React from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Platform,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";
import { useRideContext } from "@/context/RideContext";

function formatDistance(meters: number): string {
  if (meters >= 1000) {
    return `${(meters / 1000).toFixed(1)} km`;
  }
  return `${Math.round(meters)} m`;
}

export default function RideOverlay() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const {
    isRiding,
    stopRide,
    gpsError,
    ridePosition,
    progressMeters,
    totalMeters,
    isMuted,
    toggleMute,
  } = useRideContext();

  const bottomPad = Platform.OS === "web" ? 34 : insets.bottom;

  if (!isRiding) return null;

  return (
    <View
      style={[
        styles.bar,
        {
          backgroundColor: colors.card,
          borderColor: colors.border,
          paddingBottom: bottomPad + 10,
        },
      ]}
      testID="ride-overlay"
    >
      <View style={styles.statusRow}>
        <View style={styles.statusLeft}>
          <View style={[styles.liveDot, { backgroundColor: colors.primary }]} />
          <Text style={[styles.statusText, { color: colors.primary, fontFamily: "Inter_600SemiBold" }]}>
            Rit bezig
          </Text>
        </View>
        <View style={styles.statusLeft}>
          <Text style={[styles.progressText, { color: colors.mutedForeground, fontFamily: "Inter_400Regular" }]}>
            {formatDistance(progressMeters)} van {formatDistance(totalMeters)} gereden
          </Text>
          <TouchableOpacity
            onPress={toggleMute}
            style={[styles.muteBtn, { borderColor: colors.border }]}
            testID="toggle-voice"
            accessibilityLabel={
              isMuted ? "Spraakinstructies aanzetten" : "Spraakinstructies uitzetten"
            }
          >
            <Ionicons
              name={isMuted ? "volume-mute" : "volume-high"}
              size={18}
              color={isMuted ? colors.mutedForeground : colors.primary}
            />
          </TouchableOpacity>
        </View>
      </View>

      <View style={[styles.notice, { backgroundColor: colors.muted }]}>
        <Ionicons
          name="sunny-outline"
          size={14}
          color={colors.mutedForeground}
        />
        <Text
          style={[
            styles.noticeText,
            { color: colors.mutedForeground, fontFamily: "Inter_400Regular" },
          ]}
          testID="keep-awake-notice"
        >
          Het scherm blijft aan tijdens de rit zodat gps en spraakinstructies
          blijven werken. Dit verbruikt meer batterij — zet de helderheid
          gerust laag.
        </Text>
      </View>

      {gpsError ? (
        <View style={[styles.notice, { backgroundColor: colors.muted }]}>
          <Ionicons name="warning-outline" size={14} color={colors.destructive} />
          <Text style={[styles.noticeText, { color: colors.destructive, fontFamily: "Inter_400Regular" }]}>
            {gpsError === "denied"
              ? "Locatietoegang is geblokkeerd. Sta locatietoegang toe om je rit te volgen."
              : "Je locatie is nu niet beschikbaar. Het volgen gaat verder zodra er weer gps is."}
          </Text>
        </View>
      ) : !ridePosition ? (
        <View style={styles.notice}>
          <ActivityIndicator size="small" color={colors.mutedForeground} />
          <Text style={[styles.noticeText, { color: colors.mutedForeground, fontFamily: "Inter_400Regular" }]}>
            Wachten op gps-signaal…
          </Text>
        </View>
      ) : null}

      <TouchableOpacity
        onPress={stopRide}
        style={[styles.stopBtn, { backgroundColor: colors.destructive }]}
        testID="stop-ride"
      >
        <Ionicons name="stop" size={18} color="#ffffff" />
        <Text style={[styles.stopText, { fontFamily: "Inter_600SemiBold" }]}>Rit stoppen</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderWidth: 1,
    paddingHorizontal: 16,
    paddingTop: 14,
    gap: 12,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.1,
    shadowRadius: 12,
    elevation: 8,
  },
  statusRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  statusLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  liveDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  statusText: {
    fontSize: 14,
  },
  progressText: {
    fontSize: 13,
  },
  muteBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  notice: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 10,
  },
  noticeText: {
    flex: 1,
    fontSize: 12,
    lineHeight: 17,
  },
  stopBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    height: 52,
    borderRadius: 12,
  },
  stopText: {
    color: "#ffffff",
    fontSize: 15,
  },
});
