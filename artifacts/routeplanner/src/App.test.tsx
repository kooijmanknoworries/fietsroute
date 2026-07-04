import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { I18nProvider } from "@/lib/i18n";
import App from "./App";

// The login gate is the only thing keeping a signed-out visitor away from the
// planner (and, on the map, GPS ride tracking). These tests lock in the
// redirect so a future routing / Clerk refactor can't silently re-expose Home.

// Mutable auth state backing the Clerk mocks so each test can flip between a
// signed-in and signed-out session before rendering the app.
const authState = vi.hoisted(() => ({
  status: "signed-out" as "signed-in" | "signed-out",
}));

// Minimal @clerk/react stand-in. `Show` renders its children only when the
// requested state matches the current session, mirroring the real component's
// signed-in / signed-out gating that HomeGate relies on.
vi.mock("@clerk/react", () => ({
  ClerkProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
  SignIn: () => <div data-testid="sign-in-page" />,
  SignUp: () => <div data-testid="sign-up-page" />,
  Show: ({ when, children }: { when: string; children: ReactNode }) =>
    when === authState.status ? <>{children}</> : null,
  useClerk: () => ({ addListener: () => () => {} }),
  useAuth: () => ({
    isLoaded: true,
    getToken: async () => (authState.status === "signed-in" ? "token" : null),
  }),
}));

// Capture the bearer-token getter the app registers with the API client. The
// API server gates every endpoint (including /api/network, which feeds the map
// knooppunten) behind Clerk auth, so the web app must attach an
// `Authorization: Bearer` token. Spy on the real registration hook so a test
// can assert the getter is wired up and actually resolves the session token.
const registeredAuthTokenGetter = vi.hoisted(
  () => ({ current: undefined as undefined | (() => unknown) }),
);

vi.mock("@workspace/api-client-react", async (importActual) => {
  const actual =
    await importActual<typeof import("@workspace/api-client-react")>();
  return {
    ...actual,
    setAuthTokenGetter: vi.fn((getter: (() => unknown) | null) => {
      registeredAuthTokenGetter.current = getter ?? undefined;
    }),
  };
});

vi.mock("@clerk/react/internal", () => ({
  publishableKeyFromHost: () => "pk_test_fake",
}));

vi.mock("@clerk/themes", () => ({ shadcn: {} }));

// Home pulls in the whole map stack; stand it in with a sentinel so the tests
// only assert whether the planner is reachable, not how it renders.
vi.mock("@/pages/Home", () => ({
  default: () => <div data-testid="home-planner" />,
}));

function renderApp() {
  return render(
    <I18nProvider>
      <App />
    </I18nProvider>,
  );
}

beforeEach(() => {
  // wouter reads the browser location; reset it so every test starts at "/".
  window.history.replaceState(null, "", "/");
});

afterEach(() => {
  cleanup();
});

describe("App auth gate", () => {
  it("redirects a signed-out visitor to sign-in and never renders the planner", async () => {
    authState.status = "signed-out";

    await renderApp();

    expect(screen.getByTestId("sign-in-page")).toBeTruthy();
    expect(screen.queryByTestId("home-planner")).toBeNull();
  });

  it("renders the planner for a signed-in user", async () => {
    authState.status = "signed-in";

    await renderApp();

    expect(screen.getByTestId("home-planner")).toBeTruthy();
    expect(screen.queryByTestId("sign-in-page")).toBeNull();
  });

  // Regression guard for the blank-map bug: with all API endpoints gated behind
  // Clerk auth, the web app must attach the session token as a bearer or every
  // request (knooppunten included) 401s. Assert the registered getter resolves
  // the signed-in user's token so re-tightening auth can't silently blank the
  // map again.
  it("registers a Clerk bearer-token getter that resolves the session token when signed in", async () => {
    authState.status = "signed-in";
    registeredAuthTokenGetter.current = undefined;

    await renderApp();

    expect(registeredAuthTokenGetter.current).toBeTypeOf("function");
    await expect(registeredAuthTokenGetter.current!()).resolves.toBe("token");
  });
});
