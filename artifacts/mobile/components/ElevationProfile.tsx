import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet, ActivityIndicator } from "react-native";
import Svg, { Path, Line } from "react-native-svg";
import { Ionicons } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import { getElevationProfile } from "@workspace/api-client-react";
import type { ElevationProfileResult } from "@workspace/api-client-react";

interface Props {
  coordinates: number[][];
}

const CHART_HEIGHT = 72;

function routeKey(coordinates: number[][]): string {
  const pick = (i: number) => coordinates[i]?.join(",") ?? "";
  const mid = Math.floor(coordinates.length / 2);
  return [coordinates.length, pick(0), pick(mid), pick(coordinates.length - 1)].join("|");
}

export default function ElevationProfile({ coordinates }: Props) {
  const colors = useColors();
  const [profile, setProfile] = useState<ElevationProfileResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [width, setWidth] = useState(0);

  const key = routeKey(coordinates);

  useEffect(() => {
    if (coordinates.length < 2) {
      setProfile(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(false);
    getElevationProfile({ coordinates })
      .then((res) => {
        if (!cancelled) {
          setProfile(res);
          setLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setProfile(null);
          setError(true);
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  if (coordinates.length < 2) return null;

  let areaPath = "";
  let linePath = "";
  if (profile && width > 0 && profile.points.length >= 2) {
    const total = profile.totalDistanceMeters || 1;
    const min = profile.minElevationMeters;
    const max = profile.maxElevationMeters;
    const span = Math.max(max - min, 5);
    const px = (d: number) => (d / total) * width;
    const py = (e: number) =>
      CHART_HEIGHT - 6 - ((e - min) / span) * (CHART_HEIGHT - 12);
    linePath = profile.points
      .map(
        (p: { distanceMeters: number; elevationMeters: number }, i: number) =>
          `${i === 0 ? "M" : "L"}${px(p.distanceMeters).toFixed(1)},${py(p.elevationMeters).toFixed(1)}`,
      )
      .join(" ");
    areaPath = `${linePath} L${width.toFixed(1)},${CHART_HEIGHT} L0,${CHART_HEIGHT} Z`;
  }

  return (
    <View
      style={[styles.container, { borderTopColor: colors.border }]}
      testID="elevation-profile"
    >
      <View style={styles.titleRow}>
        <Ionicons name="trending-up" size={14} color={colors.mutedForeground} />
        <Text
          style={[
            styles.title,
            { color: colors.mutedForeground, fontFamily: "Inter_600SemiBold" },
          ]}
        >
          Hoogteprofiel
        </Text>
      </View>

      {loading && (
        <View style={styles.loadingRow}>
          <ActivityIndicator size="small" color={colors.primary} />
        </View>
      )}

      {error && !loading && (
        <Text
          style={[
            styles.errorText,
            { color: colors.mutedForeground, fontFamily: "Inter_400Regular" },
          ]}
        >
          Kon het hoogteprofiel niet laden.
        </Text>
      )}

      {profile && !loading && (
        <>
          <View
            style={styles.chart}
            onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
            testID="elevation-chart"
          >
            {width > 0 && (
              <Svg width={width} height={CHART_HEIGHT}>
                <Line
                  x1={0}
                  y1={CHART_HEIGHT - 0.5}
                  x2={width}
                  y2={CHART_HEIGHT - 0.5}
                  stroke={colors.border}
                  strokeWidth={1}
                />
                {areaPath ? (
                  <Path d={areaPath} fill={colors.primary} opacity={0.15} />
                ) : null}
                {linePath ? (
                  <Path
                    d={linePath}
                    stroke={colors.primary}
                    strokeWidth={1.5}
                    fill="none"
                  />
                ) : null}
              </Svg>
            )}
          </View>
          <View style={styles.statsRow}>
            <View style={styles.stat}>
              <Text
                style={[
                  styles.statLabel,
                  { color: colors.mutedForeground, fontFamily: "Inter_400Regular" },
                ]}
              >
                Klimmen
              </Text>
              <Text
                style={[
                  styles.statValue,
                  { color: colors.foreground, fontFamily: "Inter_600SemiBold" },
                ]}
                testID="elevation-ascent"
              >
                {Math.round(profile.ascentMeters)} m
              </Text>
            </View>
            <View style={styles.stat}>
              <Text
                style={[
                  styles.statLabel,
                  { color: colors.mutedForeground, fontFamily: "Inter_400Regular" },
                ]}
              >
                Hoogste
              </Text>
              <Text
                style={[
                  styles.statValue,
                  { color: colors.foreground, fontFamily: "Inter_600SemiBold" },
                ]}
                testID="elevation-highest"
              >
                {Math.round(profile.maxElevationMeters)} m
              </Text>
            </View>
            <View style={styles.stat}>
              <Text
                style={[
                  styles.statLabel,
                  { color: colors.mutedForeground, fontFamily: "Inter_400Regular" },
                ]}
              >
                Laagste
              </Text>
              <Text
                style={[
                  styles.statValue,
                  { color: colors.foreground, fontFamily: "Inter_600SemiBold" },
                ]}
                testID="elevation-lowest"
              >
                {Math.round(profile.minElevationMeters)} m
              </Text>
            </View>
          </View>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderTopWidth: 1,
    paddingTop: 8,
    marginTop: 8,
  },
  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginBottom: 6,
  },
  title: {
    fontSize: 12,
  },
  loadingRow: {
    paddingVertical: 12,
    alignItems: "center",
  },
  errorText: {
    fontSize: 12,
    paddingVertical: 6,
  },
  chart: {
    width: "100%",
    height: CHART_HEIGHT,
  },
  statsRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 6,
  },
  stat: {
    alignItems: "center",
    flex: 1,
  },
  statLabel: {
    fontSize: 11,
  },
  statValue: {
    fontSize: 13,
  },
});
