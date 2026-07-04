import React, { useState, useCallback, useEffect } from "react";
import {
  Modal,
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  Platform,
  KeyboardAvoidingView,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter, type Href } from "expo-router";
import { useAuth } from "@clerk/expo";
import { useQueryClient } from "@tanstack/react-query";
import {
  useSaveRoute,
  getListSavedRoutesQueryKey,
} from "@workspace/api-client-react";
import { useColors } from "@/hooks/useColors";
import { useRoutePlanner } from "@/context/RoutePlannerContext";
import { saveLocalRoute } from "@/lib/localRoutes";

interface SaveRouteModalProps {
  visible: boolean;
  onClose: () => void;
}

export default function SaveRouteModal({ visible, onClose }: SaveRouteModalProps) {
  const colors = useColors();
  const router = useRouter();
  const { isSignedIn } = useAuth();
  const queryClient = useQueryClient();
  const { selectedNodes, routePlan } = useRoutePlanner();
  const saveMutation = useSaveRoute();

  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<"account" | "local" | null>(null);

  useEffect(() => {
    if (visible) {
      setName("");
      setError(null);
      setDone(null);
      setSaving(false);
    }
  }, [visible]);

  const handleSave = useCallback(async () => {
    const trimmed = name.trim();
    if (!trimmed || !routePlan || selectedNodes.length < 2) return;

    setSaving(true);
    setError(null);

    const payload = {
      name: trimmed,
      nodes: selectedNodes.map((n) => ({
        id: n.id,
        ref: n.ref,
        lat: n.lat,
        lon: n.lon,
      })),
      plan: routePlan,
    };

    try {
      // Always keep an on-device backup so routes survive offline / signed-out.
      await saveLocalRoute(payload);

      if (isSignedIn) {
        await saveMutation.mutateAsync({ data: payload });
        await queryClient.invalidateQueries({
          queryKey: getListSavedRoutesQueryKey(),
        });
        setDone("account");
      } else {
        setDone("local");
      }
    } catch (_err) {
      setError("Opslaan naar je account is mislukt. De route is wel lokaal bewaard.");
      setDone("local");
    } finally {
      setSaving(false);
    }
  }, [name, routePlan, selectedNodes, isSignedIn, saveMutation, queryClient]);

  const goSignIn = useCallback(() => {
    onClose();
    router.push("/(auth)/sign-in" as Href);
  }, [onClose, router]);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={styles.overlay}
      >
        <TouchableOpacity
          style={StyleSheet.absoluteFill}
          activeOpacity={1}
          onPress={onClose}
        />
        <View style={[styles.sheet, { backgroundColor: colors.card, borderColor: colors.border }]}>
          {done ? (
            <View style={styles.doneWrap}>
              <View style={[styles.iconCircle, { backgroundColor: colors.accent }]}>
                <Ionicons name="checkmark" size={30} color={colors.primary} />
              </View>
              <Text style={[styles.title, { color: colors.foreground, fontFamily: "Inter_700Bold" }]}>
                {done === "account" ? "Route opgeslagen" : "Lokaal bewaard"}
              </Text>
              <Text style={[styles.subtitle, { color: colors.mutedForeground, fontFamily: "Inter_400Regular" }]}>
                {done === "account"
                  ? "Je route is bewaard in je account en op dit toestel."
                  : "Je route staat op dit toestel. Meld je aan om hem op al je apparaten te synchroniseren."}
              </Text>
              {error && (
                <Text style={[styles.errorText, { color: colors.destructive, fontFamily: "Inter_400Regular" }]}>
                  {error}
                </Text>
              )}
              {done === "local" && !isSignedIn && (
                <TouchableOpacity
                  onPress={goSignIn}
                  style={[styles.primaryBtn, { backgroundColor: colors.primary }]}
                  testID="save-modal-sign-in"
                >
                  <Text style={[styles.primaryBtnText, { fontFamily: "Inter_600SemiBold" }]}>
                    Aanmelden om te synchroniseren
                  </Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity onPress={onClose} style={styles.secondaryBtn} testID="save-modal-close">
                <Text style={[styles.secondaryBtnText, { color: colors.mutedForeground, fontFamily: "Inter_500Medium" }]}>
                  Sluiten
                </Text>
              </TouchableOpacity>
            </View>
          ) : (
            <>
              <View style={styles.headerRow}>
                <Text style={[styles.title, { color: colors.foreground, fontFamily: "Inter_700Bold" }]}>
                  Route opslaan
                </Text>
                <TouchableOpacity onPress={onClose} testID="save-modal-cancel">
                  <Ionicons name="close" size={22} color={colors.mutedForeground} />
                </TouchableOpacity>
              </View>

              <Text style={[styles.subtitle, { color: colors.mutedForeground, fontFamily: "Inter_400Regular" }]}>
                {isSignedIn
                  ? "Geef je route een naam. Hij wordt bewaard in je account."
                  : "Geef je route een naam. Hij wordt lokaal op dit toestel bewaard."}
              </Text>

              <TextInput
                style={[styles.input, { borderColor: colors.input, color: colors.foreground, backgroundColor: colors.background }]}
                value={name}
                placeholder="Bijv. Rondje Veluwe"
                placeholderTextColor={colors.mutedForeground}
                onChangeText={setName}
                autoFocus
                maxLength={80}
                testID="save-route-name"
                onSubmitEditing={handleSave}
                returnKeyType="done"
              />

              <TouchableOpacity
                onPress={handleSave}
                disabled={!name.trim() || saving}
                style={[
                  styles.primaryBtn,
                  { backgroundColor: colors.primary, opacity: !name.trim() || saving ? 0.5 : 1 },
                ]}
                testID="save-route-confirm"
              >
                {saving ? (
                  <ActivityIndicator size="small" color="#ffffff" />
                ) : (
                  <Text style={[styles.primaryBtnText, { fontFamily: "Inter_600SemiBold" }]}>Opslaan</Text>
                )}
              </TouchableOpacity>
            </>
          )}
        </View>
      </KeyboardAvoidingView>
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
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  title: {
    fontSize: 20,
  },
  subtitle: {
    fontSize: 14,
    marginTop: 8,
    marginBottom: 16,
    lineHeight: 20,
  },
  input: {
    height: 50,
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 14,
    fontSize: 15,
    fontFamily: "Inter_400Regular",
    marginBottom: 16,
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
  secondaryBtn: {
    alignItems: "center",
    marginTop: 14,
    paddingVertical: 6,
  },
  secondaryBtnText: {
    fontSize: 15,
  },
  doneWrap: {
    alignItems: "center",
  },
  iconCircle: {
    width: 60,
    height: 60,
    borderRadius: 30,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 12,
  },
  errorText: {
    fontSize: 13,
    textAlign: "center",
    marginBottom: 12,
  },
});
