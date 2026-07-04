import React from "react";
import {
  Modal,
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
} from "react-native";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import type { RideSummary } from "@/hooks/useRide";

function formatDistance(meters: number): string {
  if (meters >= 1000) {
    return `${(meters / 1000).toFixed(1)} km`;
  }
  return `${Math.round(meters)} m`;
}

interface RideSummaryModalProps {
  summary: RideSummary | null;
  onClose: () => void;
}

export default function RideSummaryModal({ summary, onClose }: RideSummaryModalProps) {
  const colors = useColors();

  return (
    <Modal
      visible={summary !== null}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <View style={styles.overlay}>
        <TouchableOpacity
          style={StyleSheet.absoluteFill}
          activeOpacity={1}
          onPress={onClose}
        />
        <View style={[styles.sheet, { backgroundColor: colors.card, borderColor: colors.border }]}>
          {summary && (
            <>
              <View style={styles.headerWrap}>
                <View style={[styles.iconCircle, { backgroundColor: colors.accent }]}>
                  <Ionicons name="trophy" size={28} color={colors.primary} />
                </View>
                <Text
                  style={[styles.title, { color: colors.foreground, fontFamily: "Inter_700Bold" }]}
                  testID="ride-summary-title"
                >
                  Rit voltooid!
                </Text>
                <Text style={[styles.subtitle, { color: colors.mutedForeground, fontFamily: "Inter_400Regular" }]}>
                  Goed gedaan — dit is hoe je rit ging.
                </Text>
              </View>

              <View style={styles.stats}>
                <View style={[styles.statRow, { borderColor: colors.border, backgroundColor: colors.muted }]}>
                  <MaterialCommunityIcons name="bike" size={20} color={colors.primary} />
                  <Text style={[styles.statLabel, { color: colors.mutedForeground, fontFamily: "Inter_400Regular" }]}>
                    Gereden afstand
                  </Text>
                  <Text
                    style={[styles.statValue, { color: colors.foreground, fontFamily: "Inter_700Bold" }]}
                    testID="ride-summary-distance"
                  >
                    {formatDistance(summary.distanceMeters)}
                  </Text>
                </View>

                <View style={[styles.statRow, { borderColor: colors.border, backgroundColor: colors.muted }]}>
                  <Ionicons name="lock-open-outline" size={20} color={colors.primary} />
                  <Text style={[styles.statLabel, { color: colors.mutedForeground, fontFamily: "Inter_400Regular" }]}>
                    Nieuwe segmenten ontgrendeld
                  </Text>
                  <Text
                    style={[styles.statValue, { color: colors.foreground, fontFamily: "Inter_700Bold" }]}
                    testID="ride-summary-new-segments"
                  >
                    {summary.newSegments}
                  </Text>
                </View>

                {summary.isSignedIn ? (
                  <View style={[styles.statRow, { borderColor: colors.border, backgroundColor: colors.muted }]}>
                    <Ionicons name="lock-closed-outline" size={20} color={colors.primary} />
                    <Text style={[styles.statLabel, { color: colors.mutedForeground, fontFamily: "Inter_400Regular" }]}>
                      Totaal aantal segmenten
                    </Text>
                    <Text
                      style={[styles.statValue, { color: colors.foreground, fontFamily: "Inter_700Bold" }]}
                      testID="ride-summary-total-segments"
                    >
                      {summary.totalSegments}
                    </Text>
                  </View>
                ) : (
                  <View style={styles.hintRow} testID="ride-summary-sign-in-hint">
                    <Ionicons name="lock-closed-outline" size={14} color={colors.mutedForeground} />
                    <Text style={[styles.hintText, { color: colors.mutedForeground, fontFamily: "Inter_400Regular" }]}>
                      Log in om deze segmenten in je totaaloverzicht te bewaren.
                    </Text>
                  </View>
                )}
              </View>

              <TouchableOpacity
                onPress={onClose}
                style={[styles.primaryBtn, { backgroundColor: colors.primary }]}
                testID="ride-summary-done"
              >
                <Text style={[styles.primaryBtnText, { fontFamily: "Inter_600SemiBold" }]}>Klaar</Text>
              </TouchableOpacity>
            </>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.45)",
    justifyContent: "center",
    paddingHorizontal: 24,
  },
  sheet: {
    borderRadius: 20,
    borderWidth: 1,
    padding: 20,
  },
  headerWrap: {
    alignItems: "center",
    marginBottom: 16,
  },
  iconCircle: {
    width: 60,
    height: 60,
    borderRadius: 30,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 12,
  },
  title: {
    fontSize: 20,
  },
  subtitle: {
    fontSize: 14,
    marginTop: 6,
    textAlign: "center",
    lineHeight: 20,
  },
  stats: {
    gap: 10,
    marginBottom: 20,
  },
  statRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  statLabel: {
    flex: 1,
    fontSize: 14,
  },
  statValue: {
    fontSize: 18,
  },
  hintRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 6,
    paddingHorizontal: 4,
    paddingTop: 2,
  },
  hintText: {
    flex: 1,
    fontSize: 12,
    lineHeight: 17,
  },
  primaryBtn: {
    height: 52,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  primaryBtnText: {
    color: "#ffffff",
    fontSize: 16,
  },
});
