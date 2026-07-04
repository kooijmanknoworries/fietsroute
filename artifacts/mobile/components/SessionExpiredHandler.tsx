import { router, type Href } from "expo-router";
import { useEffect, useRef } from "react";
import { Alert } from "react-native";
import { useAuth } from "@clerk/expo";
import {
  createUnauthorizedHandler,
  setUnauthorizedHandler,
} from "@workspace/api-client-react";

// A 401 mid-ride might mean a genuinely expired/revoked Clerk session, but far
// more often it's a transient blip (a momentarily-stale token that Clerk
// refreshes moments later). So before prompting we ask Clerk for a fresh token;
// only when that fails do we alert the rider and route them to sign-in instead
// of surfacing a generic "kan niet laden" failure. Because RoutePlannerProvider
// sits above the router, an in-progress route survives the navigation, so the
// rider returns to it after re-authenticating.
export function SessionExpiredHandler() {
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
