import { useEffect, useRef } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@clerk/react";
import {
  createUnauthorizedHandler,
  setUnauthorizedHandler,
} from "@workspace/api-client-react";
import { ToastAction } from "@/components/ui/toast";
import { useToast } from "@/hooks/use-toast";
import { useI18n } from "@/lib/i18n";

// When an API call returns 401 we might have a genuinely expired/revoked Clerk
// session — but far more often it's a transient blip (a momentarily-stale
// session cookie that ClerkJS refreshes moments later). So before prompting we
// ask Clerk for a fresh token; only when that fails do we show a persistent
// re-auth toast. The "Sign in again" action navigates to the sign-in page; we
// don't force-navigate, so an in-progress route stays intact until the rider
// chooses to re-authenticate.
export function SessionExpiredHandler() {
  const { toast } = useToast();
  const { t } = useI18n();
  const [, setLocation] = useLocation();
  const { getToken, isLoaded } = useAuth();

  const toastRef = useRef(toast);
  toastRef.current = toast;
  const tRef = useRef(t);
  tRef.current = t;
  const setLocationRef = useRef(setLocation);
  setLocationRef.current = setLocation;
  const getTokenRef = useRef(getToken);
  getTokenRef.current = getToken;
  const isLoadedRef = useRef(isLoaded);
  isLoadedRef.current = isLoaded;

  useEffect(() => {
    const handler = createUnauthorizedHandler({
      getToken: (opts) => getTokenRef.current(opts),
      isReady: () => isLoadedRef.current,
      onExpired: () => {
        toastRef.current({
          title: tRef.current("auth.sessionExpired.title"),
          description: tRef.current("auth.sessionExpired.desc"),
          variant: "destructive",
          action: (
            <ToastAction
              altText={tRef.current("auth.signInAgain")}
              onClick={() => setLocationRef.current("/sign-in")}
            >
              {tRef.current("auth.signInAgain")}
            </ToastAction>
          ),
        });
      },
    });
    setUnauthorizedHandler(handler);
    return () => setUnauthorizedHandler(null);
  }, []);

  return null;
}
