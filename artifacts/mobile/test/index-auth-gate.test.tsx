import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import MapScreen from "@/app/index";

// The auth gate on the map screen is the only thing keeping a signed-out user
// away from the planner and GPS ride tracking. This test locks in the redirect
// so a future routing / Clerk refactor can't silently re-expose the map.

const authState = vi.hoisted(() => ({
  isLoaded: true as boolean,
  isSignedIn: false as boolean,
}));

const redirectHrefs = vi.hoisted(() => ({ calls: [] as string[] }));

vi.mock("@clerk/expo", () => ({
  useAuth: () => ({
    isLoaded: authState.isLoaded,
    isSignedIn: authState.isSignedIn,
  }),
}));

// Capture where Redirect points instead of rendering it, and swap the map
// stack for a sentinel so a signed-in render is observable without pulling in
// react-native-maps / leaflet.
vi.mock("expo-router", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
  Redirect: ({ href }: { href: string }) => {
    redirectHrefs.calls.push(href);
    return null;
  },
}));

// react-native-maps has no jsdom build (Metro aliases it to a web shim); stub
// the pieces index.tsx imports so the module loads under vitest.
vi.mock("react-native-maps", () => ({
  __esModule: true,
  default: () => null,
  Marker: () => null,
  Polyline: () => null,
  UrlTile: () => null,
  PROVIDER_DEFAULT: null,
}));

beforeEach(() => {
  authState.isLoaded = true;
  authState.isSignedIn = false;
  redirectHrefs.calls = [];
});

afterEach(() => {
  cleanup();
});

describe("MapScreen auth gate", () => {
  it("redirects a signed-out user to the sign-in screen", () => {
    authState.isSignedIn = false;

    render(<MapScreen />);

    expect(redirectHrefs.calls).toContain("/(auth)/sign-in");
  });

  it("does not redirect while Clerk is still loading", () => {
    authState.isLoaded = false;
    authState.isSignedIn = false;

    render(<MapScreen />);

    expect(redirectHrefs.calls).toHaveLength(0);
  });
});
