import React, { useState, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  ScrollView,
  Alert,
  Platform,
} from "react-native";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter, useFocusEffect, type Href } from "expo-router";
import { useAuth, useUser } from "@clerk/expo";
import {
  useListSavedRoutes,
  useDeleteSavedRoute,
  getSavedRoute,
  getListSavedRoutesQueryKey,
  type SavedRouteSummary,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useColors } from "@/hooks/useColors";
import { useRoutePlanner } from "@/context/RoutePlannerContext";
import {
  listLocalRoutes,
  getLocalRoute,
  deleteLocalRoute,
  type LocalRoute,
} from "@/lib/localRoutes";

function formatDistance(meters: number): string {
  if (meters >= 1000) return `${(meters / 1000).toFixed(1)} km`;
  return `${Math.round(meters)} m`;
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString("nl-NL", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  } catch {
    return "";
  }
}

export default function SavedRoutesScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { isSignedIn, signOut } = useAuth();
  const { user } = useUser();
  const queryClient = useQueryClient();
  const { loadPlan } = useRoutePlanner();

  const [localRoutes, setLocalRoutes] = useState<LocalRoute[]>([]);
  const [opening, setOpening] = useState<string | null>(null);

  const {
    data: serverRoutes,
    isLoading: serverLoading,
    isError: serverError,
  } = useListSavedRoutes({
    query: { enabled: !!isSignedIn, queryKey: getListSavedRoutesQueryKey() },
  });

  const deleteMutation = useDeleteSavedRoute();

  const refreshLocal = useCallback(() => {
    listLocalRoutes().then(setLocalRoutes);
  }, []);

  useFocusEffect(
    useCallback(() => {
      refreshLocal();
    }, [refreshLocal])
  );

  const goHome = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace("/" as Href);
  }, [router]);

  const accountEmail =
    user?.primaryEmailAddress?.emailAddress ??
    user?.emailAddresses?.[0]?.emailAddress ??
    null;

  const confirmSignOut = useCallback(() => {
    Alert.alert(
      "Afmelden",
      "Weet je zeker dat je je wilt afmelden? Je account-routes verdwijnen van dit toestel, lokale back-ups blijven bewaard.",
      [
        { text: "Annuleren", style: "cancel" },
        {
          text: "Afmelden",
          style: "destructive",
          onPress: async () => {
            try {
              await signOut();
              await queryClient.invalidateQueries({
                queryKey: getListSavedRoutesQueryKey(),
              });
              // Planning/GPS are gated behind auth, so send the signed-out user
              // straight to the sign-in screen instead of leaving them on this
              // modal over a now-inaccessible planner.
              router.replace("/(auth)/sign-in" as Href);
            } catch {
              Alert.alert("Fout", "Afmelden is mislukt.");
            }
          },
        },
      ]
    );
  }, [signOut, queryClient, router]);

  const openServerRoute = useCallback(
    async (id: string) => {
      try {
        setOpening(id);
        const full = await getSavedRoute(id);
        loadPlan(full.nodes, full.plan);
        goHome();
      } catch {
        Alert.alert("Fout", "Kon de route niet openen.");
      } finally {
        setOpening(null);
      }
    },
    [loadPlan, goHome]
  );

  const openLocalRoute = useCallback(
    async (id: string) => {
      try {
        setOpening(id);
        const full = await getLocalRoute(id);
        if (!full) {
          Alert.alert("Fout", "Deze route bestaat niet meer.");
          return;
        }
        loadPlan(full.nodes, full.plan);
        goHome();
      } finally {
        setOpening(null);
      }
    },
    [loadPlan, goHome]
  );

  const confirmDeleteServer = useCallback(
    (route: SavedRouteSummary) => {
      Alert.alert("Route verwijderen", `"${route.name}" verwijderen uit je account?`, [
        { text: "Annuleren", style: "cancel" },
        {
          text: "Verwijderen",
          style: "destructive",
          onPress: async () => {
            try {
              await deleteMutation.mutateAsync({ id: route.id });
              await queryClient.invalidateQueries({
                queryKey: getListSavedRoutesQueryKey(),
              });
            } catch {
              Alert.alert("Fout", "Verwijderen is mislukt.");
            }
          },
        },
      ]);
    },
    [deleteMutation, queryClient]
  );

  const confirmDeleteLocal = useCallback(
    (route: LocalRoute) => {
      Alert.alert("Route verwijderen", `"${route.name}" van dit toestel verwijderen?`, [
        { text: "Annuleren", style: "cancel" },
        {
          text: "Verwijderen",
          style: "destructive",
          onPress: async () => {
            await deleteLocalRoute(route.id);
            refreshLocal();
          },
        },
      ]);
    },
    [refreshLocal]
  );

  const topPad = Platform.OS === "web" ? 24 : insets.top + 8;

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <View style={[styles.header, { paddingTop: topPad, borderBottomColor: colors.border }]}>
        <Text style={[styles.headerTitle, { color: colors.foreground, fontFamily: "Inter_700Bold" }]}>
          Bewaarde routes
        </Text>
        <TouchableOpacity
          onPress={goHome}
          style={[styles.closeBtn, { backgroundColor: colors.muted }]}
          testID="close-saved"
        >
          <Ionicons name="close" size={20} color={colors.foreground} />
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>
        {/* Account section */}
        <Text style={[styles.sectionTitle, { color: colors.mutedForeground, fontFamily: "Inter_600SemiBold" }]}>
          In je account
        </Text>

        <View
          style={[styles.card, styles.accountCard, { backgroundColor: colors.card, borderColor: colors.border }]}
          testID="account-card"
        >
          <View style={[styles.accountAvatar, { backgroundColor: colors.accent }]}>
            <Ionicons
              name={isSignedIn ? "person-circle-outline" : "person-outline"}
              size={24}
              color={colors.primary}
            />
          </View>
          <View style={styles.accountBody}>
            <Text
              numberOfLines={1}
              style={[styles.accountEmail, { color: colors.foreground, fontFamily: "Inter_600SemiBold" }]}
              testID="account-email"
            >
              {isSignedIn ? accountEmail ?? "Aangemeld" : "Niet aangemeld"}
            </Text>
            <Text
              numberOfLines={1}
              style={[styles.accountSub, { color: colors.mutedForeground, fontFamily: "Inter_400Regular" }]}
            >
              {isSignedIn ? "Routes synchroniseren met je account" : "Niet gesynchroniseerd"}
            </Text>
          </View>
          {isSignedIn ? (
            <TouchableOpacity
              onPress={confirmSignOut}
              style={[styles.accountAction, { borderColor: colors.border }]}
              testID="sign-out"
            >
              <Ionicons name="log-out-outline" size={16} color={colors.destructive} />
              <Text style={[styles.accountActionText, { color: colors.destructive, fontFamily: "Inter_600SemiBold" }]}>
                Afmelden
              </Text>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity
              onPress={() => router.push("/(auth)/sign-in" as Href)}
              style={[styles.accountAction, { backgroundColor: colors.primary, borderColor: colors.primary }]}
              testID="saved-sign-in"
            >
              <Text style={[styles.accountActionText, { color: "#ffffff", fontFamily: "Inter_600SemiBold" }]}>
                Aanmelden
              </Text>
            </TouchableOpacity>
          )}
        </View>

        {!isSignedIn ? null : serverLoading ? (
          <ActivityIndicator size="small" color={colors.primary} style={{ marginVertical: 16 }} />
        ) : serverError ? (
          <Text style={[styles.emptyText, { color: colors.destructive, fontFamily: "Inter_400Regular" }]}>
            Kon je opgeslagen routes niet laden.
          </Text>
        ) : !serverRoutes || serverRoutes.length === 0 ? (
          <Text style={[styles.emptyText, { color: colors.mutedForeground, fontFamily: "Inter_400Regular" }]}>
            Nog geen routes in je account.
          </Text>
        ) : (
          serverRoutes.map((route) => (
            <RouteRow
              key={route.id}
              colors={colors}
              name={route.name}
              subtitle={`${formatDistance(route.distanceMeters)} · ${route.nodeRefs.length} knooppunten · ${formatDate(route.createdAt)}`}
              synced
              loading={opening === route.id}
              onOpen={() => openServerRoute(route.id)}
              onDelete={() => confirmDeleteServer(route)}
            />
          ))
        )}

        {/* Local section */}
        <Text
          style={[
            styles.sectionTitle,
            { color: colors.mutedForeground, fontFamily: "Inter_600SemiBold", marginTop: 28 },
          ]}
        >
          Op dit toestel
        </Text>

        {localRoutes.length === 0 ? (
          <Text style={[styles.emptyText, { color: colors.mutedForeground, fontFamily: "Inter_400Regular" }]}>
            Nog geen lokale back-ups.
          </Text>
        ) : (
          localRoutes.map((route) => (
            <RouteRow
              key={route.id}
              colors={colors}
              name={route.name}
              subtitle={`${formatDistance(route.plan.distanceMeters)} · ${route.plan.nodeRefs.length} knooppunten · ${formatDate(route.createdAt)}`}
              synced={false}
              loading={opening === route.id}
              onOpen={() => openLocalRoute(route.id)}
              onDelete={() => confirmDeleteLocal(route)}
            />
          ))
        )}
      </ScrollView>
    </View>
  );
}

interface RouteRowProps {
  colors: ReturnType<typeof useColors>;
  name: string;
  subtitle: string;
  synced: boolean;
  loading: boolean;
  onOpen: () => void;
  onDelete: () => void;
}

function RouteRow({ colors, name, subtitle, synced, loading, onOpen, onDelete }: RouteRowProps) {
  return (
    <TouchableOpacity
      onPress={onOpen}
      disabled={loading}
      style={[styles.card, styles.row, { backgroundColor: colors.card, borderColor: colors.border }]}
      testID={`saved-route-${name}`}
    >
      <View style={[styles.rowIcon, { backgroundColor: colors.accent }]}>
        {loading ? (
          <ActivityIndicator size="small" color={colors.primary} />
        ) : (
          <MaterialCommunityIcons name="map-marker-path" size={20} color={colors.primary} />
        )}
      </View>
      <View style={styles.rowBody}>
        <View style={styles.rowTitleLine}>
          <Text
            numberOfLines={1}
            style={[styles.rowTitle, { color: colors.foreground, fontFamily: "Inter_600SemiBold" }]}
          >
            {name}
          </Text>
          <Ionicons
            name={synced ? "cloud-done-outline" : "phone-portrait-outline"}
            size={14}
            color={colors.mutedForeground}
          />
        </View>
        <Text
          numberOfLines={1}
          style={[styles.rowSubtitle, { color: colors.mutedForeground, fontFamily: "Inter_400Regular" }]}
        >
          {subtitle}
        </Text>
      </View>
      <TouchableOpacity
        onPress={onDelete}
        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        style={styles.deleteBtn}
        testID={`delete-route-${name}`}
      >
        <Ionicons name="trash-outline" size={18} color={colors.destructive} />
      </TouchableOpacity>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingBottom: 14,
    borderBottomWidth: 1,
  },
  headerTitle: {
    fontSize: 20,
  },
  closeBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  scroll: {
    padding: 20,
    paddingBottom: 48,
  },
  sectionTitle: {
    fontSize: 13,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 10,
  },
  card: {
    borderRadius: 14,
    borderWidth: 1,
    padding: 16,
    marginBottom: 10,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 12,
  },
  rowIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  rowBody: {
    flex: 1,
  },
  rowTitleLine: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  rowTitle: {
    fontSize: 15,
    flexShrink: 1,
  },
  rowSubtitle: {
    fontSize: 13,
    marginTop: 2,
  },
  deleteBtn: {
    padding: 4,
  },
  emptyText: {
    fontSize: 14,
    lineHeight: 20,
  },
  accountCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  accountAvatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
  },
  accountBody: {
    flex: 1,
  },
  accountEmail: {
    fontSize: 15,
  },
  accountSub: {
    fontSize: 12,
    marginTop: 2,
  },
  accountAction: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    height: 36,
    paddingHorizontal: 12,
    borderRadius: 10,
    borderWidth: 1,
  },
  accountActionText: {
    fontSize: 14,
  },
});
