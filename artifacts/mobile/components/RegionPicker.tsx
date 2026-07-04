import React, { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Modal,
  FlatList,
  Platform,
  ActivityIndicator,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useGetRegions } from "@workspace/api-client-react";
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
}

export default function RegionPicker({ onSelectRegion }: RegionPickerProps) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const [visible, setVisible] = useState(false);

  const { data: regions, isLoading } = useGetRegions();

  const topPad = Platform.OS === "web" ? 67 : insets.top;

  const handleSelect = (region: Region) => {
    onSelectRegion(region);
    setVisible(false);
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
        <Ionicons name="map-outline" size={18} color={colors.primary} />
        <Text style={[styles.triggerText, { color: colors.foreground, fontFamily: "Inter_500Medium" }]}>
          Kies regio
        </Text>
        <Ionicons name="chevron-down" size={16} color={colors.mutedForeground} />
      </TouchableOpacity>

      <Modal
        visible={visible}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setVisible(false)}
      >
        <View style={[styles.modal, { backgroundColor: colors.background }]}>
          <View style={[styles.modalHeader, { borderBottomColor: colors.border }]}>
            <Text style={[styles.modalTitle, { color: colors.foreground, fontFamily: "Inter_700Bold" }]}>
              Fietsregio's
            </Text>
            <TouchableOpacity
              onPress={() => setVisible(false)}
              style={[styles.closeBtn, { backgroundColor: colors.muted }]}
              testID="close-region-picker"
            >
              <Ionicons name="close" size={20} color={colors.foreground} />
            </TouchableOpacity>
          </View>

          {isLoading ? (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="large" color={colors.primary} />
            </View>
          ) : (
            <FlatList
              data={regions ?? []}
              keyExtractor={(item) => item.id}
              contentContainerStyle={styles.listContent}
              renderItem={({ item }) => (
                <TouchableOpacity
                  onPress={() => handleSelect(item as Region)}
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
              scrollEnabled={!!regions && regions.length > 5}
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
  loadingContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  listContent: {
    paddingTop: 8,
    paddingBottom: 40,
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
