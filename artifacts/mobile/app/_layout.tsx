import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
  useFonts,
} from "@expo-google-fonts/inter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ClerkProvider, ClerkLoaded, ClerkLoading, useAuth } from "@clerk/expo";
import { tokenCache } from "@clerk/expo/token-cache";
import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import React, { useEffect, useState } from "react";
import { ActivityIndicator, Text, View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { setBaseUrl, setAuthTokenGetter } from "@workspace/api-client-react";

import { ErrorBoundary } from "@/components/ErrorBoundary";
import { SessionExpiredHandler } from "@/components/SessionExpiredHandler";
import { RoutePlannerProvider } from "@/context/RoutePlannerContext";
import { RideProvider } from "@/context/RideContext";

const domain = process.env.EXPO_PUBLIC_DOMAIN;
if (domain) setBaseUrl(`https://${domain}`);

const publishableKey = process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY!;
const proxyUrl = process.env.EXPO_PUBLIC_CLERK_PROXY_URL || undefined;

SplashScreen.preventAutoHideAsync();

const queryClient = new QueryClient();

// Bridges Clerk's session token into the shared API client. On mobile there is
// no browser cookie jar, so the generated client attaches a Bearer token via
// this getter. When signed out, getToken() resolves null and no header is sent.
function AuthTokenBridge() {
  const { getToken, isSignedIn } = useAuth();

  useEffect(() => {
    setAuthTokenGetter(() => getToken());
    return () => setAuthTokenGetter(null);
  }, [getToken]);

  // Clear cached saved-routes queries whenever the signed-in user changes so
  // one account's routes never leak into another session.
  useEffect(() => {
    queryClient.invalidateQueries();
  }, [isSignedIn]);

  return null;
}

function RootLayoutNav() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" options={{ headerShown: false }} />
      <Stack.Screen name="saved" options={{ presentation: "modal" }} />
      <Stack.Screen name="(auth)/sign-in" options={{ presentation: "modal" }} />
      <Stack.Screen name="(auth)/sign-up" options={{ presentation: "modal" }} />
    </Stack>
  );
}

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
  });

  // Never hang on the splash screen forever: fonts load from the deployment
  // server, and if that download stalls (flaky mobile network, proxy hiccup)
  // useFonts may neither resolve nor error. After this timeout we render with
  // system fonts instead of showing a dead splash/blank screen.
  const [fontTimeoutElapsed, setFontTimeoutElapsed] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setFontTimeoutElapsed(true), 5000);
    return () => clearTimeout(timer);
  }, []);

  const fontsReady = fontsLoaded || !!fontError || fontTimeoutElapsed;

  useEffect(() => {
    if (fontsReady) {
      SplashScreen.hideAsync();
    }
  }, [fontsReady]);

  if (!fontsReady) return null;

  return (
    <ClerkProvider
      publishableKey={publishableKey}
      tokenCache={tokenCache}
      proxyUrl={proxyUrl}
    >
      {/* Visible progress while the Clerk client boots. Without this the app
          shows a plain blank screen if Clerk's first request is slow, which
          is indistinguishable from a crash for the rider. */}
      <ClerkLoading>
        <View
          style={{ flex: 1, alignItems: "center", justifyContent: "center" }}
        >
          <ActivityIndicator size="large" />
          <Text style={{ marginTop: 12, color: "#666" }}>Verbinden…</Text>
        </View>
      </ClerkLoading>
      <ClerkLoaded>
        <SafeAreaProvider>
          <ErrorBoundary>
            <QueryClientProvider client={queryClient}>
              <AuthTokenBridge />
              <SessionExpiredHandler />
              <GestureHandlerRootView style={{ flex: 1 }}>
                <KeyboardProvider>
                  <RoutePlannerProvider>
                    <RideProvider>
                      <RootLayoutNav />
                    </RideProvider>
                  </RoutePlannerProvider>
                </KeyboardProvider>
              </GestureHandlerRootView>
            </QueryClientProvider>
          </ErrorBoundary>
        </SafeAreaProvider>
      </ClerkLoaded>
    </ClerkProvider>
  );
}
