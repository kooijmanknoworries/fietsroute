import React, { useCallback, useEffect, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  Platform,
  ScrollView,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter, Link, type Href } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import * as AuthSession from "expo-auth-session";
import { useSignIn, useSSO, useAuth } from "@clerk/expo";
import { useColors } from "@/hooks/useColors";

WebBrowser.maybeCompleteAuthSession();

export default function SignInScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { signIn, errors, fetchStatus } = useSignIn();
  const { isSignedIn } = useAuth();
  const { startSSOFlow } = useSSO();

  const [emailAddress, setEmailAddress] = useState("");
  const [password, setPassword] = useState("");
  const [ssoLoading, setSsoLoading] = useState(false);

  useEffect(() => {
    if (Platform.OS === "android") {
      void WebBrowser.warmUpAsync();
      return () => {
        void WebBrowser.coolDownAsync();
      };
    }
  }, []);

  const goHome = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace("/" as Href);
  }, [router]);

  useEffect(() => {
    if (isSignedIn) goHome();
  }, [isSignedIn, goHome]);

  const handleSubmit = useCallback(async () => {
    const { error } = await signIn.password({ emailAddress, password });
    if (error) return;
    if (signIn.status === "complete") {
      await signIn.finalize({ navigate: goHome });
    }
  }, [signIn, emailAddress, password, goHome]);

  const handleGoogle = useCallback(async () => {
    try {
      setSsoLoading(true);
      const { createdSessionId, setActive } = await startSSOFlow({
        strategy: "oauth_google",
        redirectUrl: AuthSession.makeRedirectUri(),
      });
      if (createdSessionId && setActive) {
        await setActive({ session: createdSessionId, navigate: goHome });
      }
    } catch {
      // Errors surfaced via the errors object / user retry.
    } finally {
      setSsoLoading(false);
    }
  }, [startSSOFlow, goHome]);

  const busy = fetchStatus === "fetching" || ssoLoading;
  const topPad = Platform.OS === "web" ? 24 : insets.top + 8;

  return (
    <ScrollView
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={[styles.container, { paddingTop: topPad }]}
      keyboardShouldPersistTaps="handled"
    >
      <View style={styles.header}>
        <TouchableOpacity
          onPress={goHome}
          style={[styles.closeBtn, { backgroundColor: colors.muted }]}
          testID="close-auth"
        >
          <Ionicons name="close" size={20} color={colors.foreground} />
        </TouchableOpacity>
      </View>

      <View style={[styles.iconCircle, { backgroundColor: colors.accent }]}>
        <Ionicons name="bicycle" size={32} color={colors.primary} />
      </View>

      <Text style={[styles.title, { color: colors.foreground, fontFamily: "Inter_700Bold" }]}>
        Welkom terug
      </Text>
      <Text style={[styles.subtitle, { color: colors.mutedForeground, fontFamily: "Inter_400Regular" }]}>
        Meld je aan om je routes te bewaren en te synchroniseren
      </Text>

      <TouchableOpacity
        onPress={handleGoogle}
        disabled={busy}
        style={[styles.oauthBtn, { borderColor: colors.border, backgroundColor: colors.card }]}
        testID="google-sign-in"
      >
        {ssoLoading ? (
          <ActivityIndicator size="small" color={colors.primary} />
        ) : (
          <>
            <Ionicons name="logo-google" size={18} color={colors.foreground} />
            <Text style={[styles.oauthText, { color: colors.foreground, fontFamily: "Inter_600SemiBold" }]}>
              Doorgaan met Google
            </Text>
          </>
        )}
      </TouchableOpacity>

      <View style={styles.dividerRow}>
        <View style={[styles.dividerLine, { backgroundColor: colors.border }]} />
        <Text style={[styles.dividerText, { color: colors.mutedForeground, fontFamily: "Inter_400Regular" }]}>
          of
        </Text>
        <View style={[styles.dividerLine, { backgroundColor: colors.border }]} />
      </View>

      <Text style={[styles.label, { color: colors.foreground, fontFamily: "Inter_500Medium" }]}>
        E-mailadres
      </Text>
      <TextInput
        style={[styles.input, { borderColor: colors.input, color: colors.foreground, backgroundColor: colors.card }]}
        autoCapitalize="none"
        value={emailAddress}
        placeholder="jij@voorbeeld.nl"
        placeholderTextColor={colors.mutedForeground}
        onChangeText={setEmailAddress}
        keyboardType="email-address"
        testID="email-input"
      />
      {errors.fields.identifier && (
        <Text style={[styles.error, { color: colors.destructive }]}>
          {errors.fields.identifier.message}
        </Text>
      )}

      <Text style={[styles.label, { color: colors.foreground, fontFamily: "Inter_500Medium" }]}>
        Wachtwoord
      </Text>
      <TextInput
        style={[styles.input, { borderColor: colors.input, color: colors.foreground, backgroundColor: colors.card }]}
        value={password}
        placeholder="••••••••"
        placeholderTextColor={colors.mutedForeground}
        secureTextEntry
        onChangeText={setPassword}
        testID="password-input"
      />
      {errors.fields.password && (
        <Text style={[styles.error, { color: colors.destructive }]}>
          {errors.fields.password.message}
        </Text>
      )}

      <TouchableOpacity
        onPress={handleSubmit}
        disabled={!emailAddress || !password || busy}
        style={[
          styles.primaryBtn,
          { backgroundColor: colors.primary, opacity: !emailAddress || !password || busy ? 0.5 : 1 },
        ]}
        testID="submit-sign-in"
      >
        {fetchStatus === "fetching" ? (
          <ActivityIndicator size="small" color="#ffffff" />
        ) : (
          <Text style={[styles.primaryBtnText, { fontFamily: "Inter_600SemiBold" }]}>Aanmelden</Text>
        )}
      </TouchableOpacity>

      <View style={styles.footerRow}>
        <Text style={[styles.footerText, { color: colors.mutedForeground, fontFamily: "Inter_400Regular" }]}>
          Nog geen account?{" "}
        </Text>
        <Link href={"/(auth)/sign-up" as Href} replace>
          <Text style={[styles.footerLink, { color: colors.primary, fontFamily: "Inter_600SemiBold" }]}>
            Registreren
          </Text>
        </Link>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 24,
    paddingBottom: 48,
  },
  header: {
    flexDirection: "row",
    justifyContent: "flex-end",
  },
  closeBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  iconCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: "center",
    justifyContent: "center",
    alignSelf: "center",
    marginTop: 8,
    marginBottom: 16,
  },
  title: {
    fontSize: 26,
    textAlign: "center",
  },
  subtitle: {
    fontSize: 14,
    textAlign: "center",
    marginTop: 6,
    marginBottom: 24,
    paddingHorizontal: 12,
  },
  oauthBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    height: 50,
    borderRadius: 12,
    borderWidth: 1,
  },
  oauthText: {
    fontSize: 15,
  },
  dividerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginVertical: 20,
  },
  dividerLine: {
    flex: 1,
    height: 1,
  },
  dividerText: {
    fontSize: 13,
  },
  label: {
    fontSize: 14,
    marginBottom: 6,
    marginTop: 4,
  },
  input: {
    height: 50,
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 14,
    fontSize: 15,
    fontFamily: "Inter_400Regular",
    marginBottom: 12,
  },
  error: {
    fontSize: 13,
    marginTop: -6,
    marginBottom: 10,
    fontFamily: "Inter_400Regular",
  },
  primaryBtn: {
    height: 52,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 8,
  },
  primaryBtnText: {
    color: "#ffffff",
    fontSize: 16,
  },
  footerRow: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    marginTop: 24,
  },
  footerText: {
    fontSize: 14,
  },
  footerLink: {
    fontSize: 14,
  },
});
