import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
  useFonts,
} from "@expo-google-fonts/inter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ClerkProvider, ClerkLoaded, useAuth } from "@clerk/expo";
import { tokenCache } from "@clerk/expo/token-cache";
import { Stack, router, type Href } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import React, { useEffect, useRef } from "react";
import { Alert } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { SafeAreaProvider } from "react-native-safe-area-context";
import {
  createUnauthorizedHandler,
  setBaseUrl,
  setAuthTokenGetter,
  setUnauthorizedHandler,
} from "@workspace/api-client-react";

import { ErrorBoundary } from "@/components/ErrorBoundary";
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

// A 401 mid-ride might mean a genuinely expired/revoked Clerk session, but far
// more often it's a transient blip (a momentarily-stale token that Clerk
// refreshes moments later). So before prompting we ask Clerk for a fresh token;
// only when that fails do we alert the rider and route them to sign-in instead
// of surfacing a generic "kan niet laden" failure. Because RoutePlannerProvider
// sits above the router, an in-progress route survives the navigation, so the
// rider returns to it after re-authenticating.
function SessionExpiredHandler() {
  const { getToken, isLoaded } = useAuth();
  // Only one alert on screen at a time.
  const promptOpenRef = useRef(false);
  const getTokenRef = useRef(getToken);
  getTokenRef.current = getToken;
  const isLoadedRef = useRef(isLoaded);
  isLoadedRef.current = isLoaded;

  useEffect(() => {
    const handler = createUnauthorizedHandler({
      getToken: (opts) => getTokenRef.current(opts),
      isReady: () => isLoadedRef.current,
      onExpired: () => {
        if (promptOpenRef.current) return;
        promptOpenRef.current = true;

        Alert.alert(
          "Je sessie is verlopen",
          "Log opnieuw in om verder te gaan. Je route blijft bewaard.",
          [
            {
              text: "Opnieuw inloggen",
              onPress: () => {
                promptOpenRef.current = false;
                router.push("/(auth)/sign-in" as Href);
              },
            },
          ],
          { onDismiss: () => (promptOpenRef.current = false) },
        );
      },
    });
    setUnauthorizedHandler(handler);
    return () => setUnauthorizedHandler(null);
  }, []);

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

  useEffect(() => {
    if (fontsLoaded || fontError) {
      SplashScreen.hideAsync();
    }
  }, [fontsLoaded, fontError]);

  if (!fontsLoaded && !fontError) return null;

  return (
    <ClerkProvider
      publishableKey={publishableKey}
      tokenCache={tokenCache}
      proxyUrl={proxyUrl}
    >
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
