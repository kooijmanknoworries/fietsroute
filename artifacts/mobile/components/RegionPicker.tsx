import React, { useEffect, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  Modal,
  FlatList,
  Platform,
  ActivityIndicator,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  useGetRegions,
  useGeocodeMunicipality,
  getGeocodeMunicipalityQueryKey,
  MunicipalityResult,
} from "@workspace/api-client-react";
import { useColors } from "@/hooks/useColors";

interface Region {
  id: string;
  name: string;
  country: string;
  lat: number;
  lon: number;
  zoom: number;
}

interface RegionPickerProps {
  onSelectRegion: (region: Region) => void;
  onSelectMunicipality: (municipality: MunicipalityResult) => void;
}

export default function RegionPicker({
  onSelectRegion,
  onSelectMunicipality,
}: RegionPickerProps) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const [visible, setVisible] = useState(false);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");

  useEffect(() => {
    const handle = setTimeout(() => setDebouncedSearch(search), 400);
    return () => clearTimeout(handle);
  }, [search]);

  const { data: regions, isLoading } = useGetRegions();

  const trimmed = debouncedSearch.trim();
  const searchEnabled = trimmed.length >= 2;

  const { data: searchResults, isFetching: isSearching } = useGeocodeMunicipality(
    { q: trimmed },
    {
      query: {
        enabled: searchEnabled,
        queryKey: getGeocodeMunicipalityQueryKey({ q: trimmed }),
      },
    },
  );

  const topPad = Platform.OS === "web" ? 67 : insets.top;

  const close = () => {
    setVisible(false);
    setSearch("");
    setDebouncedSearch("");
  };

  const handleSelectRegion = (region: Region) => {
    onSelectRegion(region);
    close();
  };

  const handleSelectMunicipality = (m: MunicipalityResult) => {
    onSelectMunicipality(m);
    close();
  };

  return (
    <>
      <TouchableOpacity
        onPress={() => setVisible(true)}
        style={[
          styles.trigger,
          {
            backgroundColor: colors.card,
            borderColor: colors.border,
            top: topPad + 12,
          },
        ]}
        testID="region-picker-trigger"
      >
        <Ionicons name="search-outline" size={18} color={colors.primary} />
        <Text style={[styles.triggerText, { color: colors.foreground, fontFamily: "Inter_500Medium" }]}>
          Zoek plaats of regio
        </Text>
        <Ionicons name="chevron-down" size={16} color={colors.mutedForeground} />
      </TouchableOpacity>

      <Modal
        visible={visible}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={close}
      >
        <View style={[styles.modal, { backgroundColor: colors.background }]}>
          <View style={[styles.modalHeader, { borderBottomColor: colors.border }]}>
            <Text style={[styles.modalTitle, { color: colors.foreground, fontFamily: "Inter_700Bold" }]}>
              Ga naar plaats
            </Text>
            <TouchableOpacity
              onPress={close}
              style={[styles.closeBtn, { backgroundColor: colors.muted }]}
              testID="close-region-picker"
            >
              <Ionicons name="close" size={20} color={colors.foreground} />
            </TouchableOpacity>
          </View>

          <View style={styles.searchWrap}>
            <View
              style={[
                styles.searchBox,
                { backgroundColor: colors.muted, borderColor: colors.border },
              ]}
            >
              <Ionicons name="search" size={18} color={colors.mutedForeground} />
              <TextInput
                value={search}
                onChangeText={setSearch}
                placeholder="Zoek een gemeente of stad..."
                placeholderTextColor={colors.mutedForeground}
                style={[styles.searchInput, { color: colors.foreground, fontFamily: "Inter_400Regular" }]}
                autoCorrect={false}
                autoCapitalize="words"
                returnKeyType="search"
                testID="municipality-search-input"
              />
              {search.length > 0 && (
                <TouchableOpacity onPress={() => setSearch("")} testID="clear-search">
                  <Ionicons name="close-circle" size={18} color={colors.mutedForeground} />
                </TouchableOpacity>
              )}
            </View>
          </View>

          {searchEnabled ? (
            isSearching ? (
              <View style={styles.loadingContainer}>
                <ActivityIndicator size="large" color={colors.primary} />
              </View>
            ) : (
              <FlatList
                data={searchResults ?? []}
                keyExtractor={(item) => item.id}
                keyboardShouldPersistTaps="handled"
                contentContainerStyle={styles.listContent}
                renderItem={({ item }) => (
                  <TouchableOpacity
                    onPress={() => handleSelectMunicipality(item)}
                    style={[styles.regionItem, { borderBottomColor: colors.border }]}
                    testID={`municipality-${item.id}`}
                  >
                    <View style={[styles.regionFlag, { backgroundColor: colors.muted }]}>
                      <Ionicons name="location-outline" size={20} color={colors.primary} />
                    </View>
                    <View style={styles.municipalityTextWrap}>
                      <Text
                        numberOfLines={1}
                        style={[styles.regionName, { color: colors.foreground, fontFamily: "Inter_500Medium" }]}
                      >
                        {item.name}
                      </Text>
                      <Text
                        numberOfLines={1}
                        style={[styles.municipalitySub, { color: colors.mutedForeground, fontFamily: "Inter_400Regular" }]}
                      >
                        {item.displayName}
                      </Text>
                    </View>
                    <Ionicons name="chevron-forward" size={18} color={colors.mutedForeground} />
                  </TouchableOpacity>
                )}
                ListEmptyComponent={
                  <View style={styles.emptyContainer}>
                    <Ionicons name="search-outline" size={40} color={colors.mutedForeground} />
                    <Text style={[styles.emptyText, { color: colors.mutedForeground, fontFamily: "Inter_400Regular" }]}>
                      Geen plaatsen gevonden
                    </Text>
                  </View>
                }
              />
            )
          ) : isLoading ? (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="large" color={colors.primary} />
            </View>
          ) : (
            <FlatList
              data={regions ?? []}
              keyExtractor={(item) => item.id}
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={styles.listContent}
              ListHeaderComponent={
                <Text style={[styles.sectionLabel, { color: colors.mutedForeground, fontFamily: "Inter_500Medium" }]}>
                  Populaire fietsregio's
                </Text>
              }
              renderItem={({ item }) => (
                <TouchableOpacity
                  onPress={() => handleSelectRegion(item as Region)}
                  style={[styles.regionItem, { borderBottomColor: colors.border }]}
                  testID={`region-${item.id}`}
                >
                  <View style={[styles.regionFlag, { backgroundColor: colors.muted }]}>
                    <Text style={styles.flagText}>
                      {item.country === "NL" ? "🇳🇱" : "🇧🇪"}
                    </Text>
                  </View>
                  <Text style={[styles.regionName, { color: colors.foreground, fontFamily: "Inter_500Medium" }]}>
                    {item.name}
                  </Text>
                  <Ionicons name="chevron-forward" size={18} color={colors.mutedForeground} />
                </TouchableOpacity>
              )}
              ListEmptyComponent={
                <View style={styles.emptyContainer}>
                  <Ionicons name="bicycle-outline" size={40} color={colors.mutedForeground} />
                  <Text style={[styles.emptyText, { color: colors.mutedForeground, fontFamily: "Inter_400Regular" }]}>
                    Geen regio's beschikbaar
                  </Text>
                </View>
              }
            />
          )}
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  trigger: {
    position: "absolute",
    left: 16,
    right: 80,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 14,
    borderWidth: 1,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 4,
  },
  triggerText: {
    flex: 1,
    fontSize: 15,
  },
  modal: {
    flex: 1,
  },
  modalHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingVertical: 16,
    paddingTop: 24,
    borderBottomWidth: 1,
  },
  modalTitle: {
    fontSize: 22,
  },
  closeBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  searchWrap: {
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 4,
  },
  searchBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 14,
    height: 46,
    borderRadius: 12,
    borderWidth: 1,
  },
  searchInput: {
    flex: 1,
    fontSize: 15,
    padding: 0,
  },
  loadingContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  listContent: {
    paddingTop: 8,
    paddingBottom: 40,
  },
  sectionLabel: {
    fontSize: 13,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 4,
  },
  regionItem: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
    gap: 14,
  },
  regionFlag: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  flagText: {
    fontSize: 20,
  },
  regionName: {
    flex: 1,
    fontSize: 16,
  },
  municipalityTextWrap: {
    flex: 1,
    gap: 2,
  },
  municipalitySub: {
    fontSize: 13,
  },
  emptyContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingTop: 60,
    gap: 12,
  },
  emptyText: {
    fontSize: 16,
    textAlign: "center",
  },
});
