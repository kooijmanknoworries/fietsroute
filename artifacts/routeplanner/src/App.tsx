import { useEffect, useRef } from "react";
import {
  Switch,
  Route,
  Redirect,
  useLocation,
  Router as WouterRouter,
} from "wouter";
import {
  QueryClientProvider,
  useQueryClient,
} from "@tanstack/react-query";
import {
  ClerkProvider,
  SignIn,
  SignUp,
  Show,
  useAuth,
  useClerk,
} from "@clerk/react";
import { publishableKeyFromHost } from "@clerk/react/internal";
import { shadcn } from "@clerk/themes";
import {
  createUnauthorizedHandler,
  setUnauthorizedHandler,
} from "@workspace/api-client-react";
import { Toaster } from "@/components/ui/toaster";
import { ToastAction } from "@/components/ui/toast";
import { useToast } from "@/hooks/use-toast";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useI18n } from "@/lib/i18n";
import NotFound from "@/pages/not-found";
import Home from "@/pages/Home";
import AdminPage from "@/pages/Admin";
import { queryClient } from "@/lib/queryClient";

// REQUIRED — copy verbatim. Resolves the key from window.location.hostname so the
// same build serves multiple Clerk custom domains.
const clerkPubKey = publishableKeyFromHost(
  window.location.hostname,
  import.meta.env.VITE_CLERK_PUBLISHABLE_KEY,
);

// REQUIRED — copy verbatim. Empty in dev, auto-set in prod.
const clerkProxyUrl = import.meta.env.VITE_CLERK_PROXY_URL;

const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

// Clerk passes full paths to routerPush/routerReplace, but wouter's
// setLocation prepends the base — strip it to avoid doubling.
function stripBase(path: string): string {
  return basePath && path.startsWith(basePath)
    ? path.slice(basePath.length) || "/"
    : path;
}

if (!clerkPubKey) {
  throw new Error("Missing VITE_CLERK_PUBLISHABLE_KEY in .env file");
}

const clerkAppearance = {
  theme: shadcn,
  cssLayerName: "clerk",
  options: {
    logoPlacement: "inside" as const,
    logoLinkUrl: basePath || "/",
    logoImageUrl: `${window.location.origin}${basePath}/logo.svg`,
  },
  variables: {
    colorPrimary: "#347a4f",
    colorForeground: "#21272e",
    colorMutedForeground: "#5b646d",
    colorDanger: "#d92626",
    colorBackground: "#ffffff",
    colorInput: "#ffffff",
    colorInputForeground: "#21272e",
    colorNeutral: "#ddd8cd",
    fontFamily: "'Inter', sans-serif",
    borderRadius: "0.75rem",
  },
  elements: {
    rootBox: "w-full flex justify-center",
    cardBox: "bg-white rounded-2xl w-[440px] max-w-full overflow-hidden shadow-lg",
    card: "!shadow-none !border-0 !bg-transparent !rounded-none",
    footer: "!shadow-none !border-0 !bg-transparent !rounded-none",
    headerTitle: "text-[#21272e]",
    headerSubtitle: "text-[#5b646d]",
    socialButtonsBlockButtonText: "text-[#21272e]",
    formFieldLabel: "text-[#21272e]",
    footerActionLink: "text-[#347a4f]",
    footerActionText: "text-[#5b646d]",
    dividerText: "text-[#5b646d]",
    identityPreviewEditButton: "text-[#347a4f]",
    formFieldSuccessText: "text-[#347a4f]",
    alertText: "text-[#21272e]",
    logoBox: "h-10",
    logoImage: "h-10 w-auto",
    socialButtonsBlockButton: "border-[#ddd8cd]",
    formButtonPrimary: "bg-[#347a4f] hover:bg-[#2c6743] text-white",
    formFieldInput: "border-[#ddd8cd]",
    footerAction: "",
    dividerLine: "bg-[#ddd8cd]",
  },
};

function SignInPage() {
  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-background px-4">
      <SignIn
        routing="path"
        path={`${basePath}/sign-in`}
        signUpUrl={`${basePath}/sign-up`}
      />
    </div>
  );
}

function SignUpPage() {
  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-background px-4">
      <SignUp
        routing="path"
        path={`${basePath}/sign-up`}
        signInUrl={`${basePath}/sign-in`}
      />
    </div>
  );
}

// Clears the query cache whenever the signed-in user changes so one user's
// saved routes never leak into another session.
function ClerkQueryClientCacheInvalidator() {
  const { addListener } = useClerk();
  const cache = useQueryClient();
  const prevUserIdRef = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    const unsubscribe = addListener(({ user }) => {
      const userId = user?.id ?? null;
      if (
        prevUserIdRef.current !== undefined &&
        prevUserIdRef.current !== userId
      ) {
        cache.clear();
      }
      prevUserIdRef.current = userId;
    });
    return unsubscribe;
  }, [addListener, cache]);

  return null;
}

// When an API call returns 401 we might have a genuinely expired/revoked Clerk
// session — but far more often it's a transient blip (a momentarily-stale
// session cookie that ClerkJS refreshes moments later). So before prompting we
// ask Clerk for a fresh token; only when that fails do we show a persistent
// re-auth toast. The "Sign in again" action navigates to the sign-in page; we
// don't force-navigate, so an in-progress route stays intact until the rider
// chooses to re-authenticate.
function SessionExpiredHandler() {
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

// Gate the planner behind an authenticated Clerk session. Signed-out visitors
// are redirected to the sign-in screen (sign-up remains reachable from there);
// the planner only renders once signed in.
function HomeGate() {
  return (
    <>
      <Show when="signed-in">
        <Home />
      </Show>
      <Show when="signed-out">
        <Redirect to="/sign-in" />
      </Show>
    </>
  );
}

function Router() {
  return (
    <Switch>
      <Route path="/" component={HomeGate} />
      <Route path="/admin" component={AdminPage} />
      <Route path="/sign-in/*?" component={SignInPage} />
      <Route path="/sign-up/*?" component={SignUpPage} />
      <Route component={NotFound} />
    </Switch>
  );
}

function ClerkProviderWithRoutes() {
  const [, setLocation] = useLocation();
  const { t } = useI18n();

  return (
    <ClerkProvider
      publishableKey={clerkPubKey}
      proxyUrl={clerkProxyUrl}
      appearance={clerkAppearance}
      signInUrl={`${basePath}/sign-in`}
      signUpUrl={`${basePath}/sign-up`}
      localization={{
        signIn: {
          start: {
            title: t("auth.signInTitle"),
            subtitle: t("auth.signInSubtitle"),
          },
        },
        signUp: {
          start: {
            title: t("auth.signUpTitle"),
            subtitle: t("auth.signUpSubtitle"),
          },
        },
      }}
      routerPush={(to) => setLocation(stripBase(to))}
      routerReplace={(to) => setLocation(stripBase(to), { replace: true })}
    >
      <QueryClientProvider client={queryClient}>
        <ClerkQueryClientCacheInvalidator />
        <TooltipProvider>
          <SessionExpiredHandler />
          <Router />
          <Toaster />
        </TooltipProvider>
      </QueryClientProvider>
    </ClerkProvider>
  );
}

function App() {
  return (
    <WouterRouter base={basePath}>
      <ClerkProviderWithRoutes />
    </WouterRouter>
  );
}

export default App;
