import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { Alert } from "react-native";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// This test proves the *wired* mobile UI reacts to a real 401: the exact
// SessionExpiredHandler that _layout mounts registers the central handler, and
// firing it pops the "sign in again" Alert and routes to the sign-in screen.
// The custom-fetch → handler plumbing itself is unit-tested elsewhere; here we
// lock in that the app actually responds.

// Capture the handler _layout registers via setUnauthorizedHandler so the test
// can fire a 401 exactly the way custom-fetch does.
const captured = vi.hoisted(() => ({
  handler: null as null | ((ctx: { url: string; method: string }) => void),
}));

const routerPush = vi.hoisted(() => vi.fn());

vi.mock("@workspace/api-client-react", () => ({
  setUnauthorizedHandler: vi.fn((h) => {
    captured.handler = h;
  }),
  // The verify-before-prompt logic (forced token refresh, debounce) is unit
  // tested in the lib. Here we stub it to a handler that fires onExpired
  // directly so this test stays focused on the wired Alert + navigation.
  createUnauthorizedHandler: (deps: { onExpired: () => void }) => () =>
    deps.onExpired(),
}));

vi.mock("expo-router", () => ({
  router: { push: routerPush },
}));

import { SessionExpiredHandler } from "./SessionExpiredHandler";

beforeEach(() => {
  captured.handler = null;
  routerPush.mockReset();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("SessionExpiredHandler (wired mobile UI)", () => {
  it("registers a central 401 handler on mount", () => {
    render(<SessionExpiredHandler />);
    expect(typeof captured.handler).toBe("function");
  });

  it("shows the re-auth Alert and routes to sign-in when a 401 fires", () => {
    const alertSpy = vi.spyOn(Alert, "alert");
    render(<SessionExpiredHandler />);

    captured.handler?.({ url: "/api/saved-routes", method: "GET" });

    expect(alertSpy).toHaveBeenCalledTimes(1);
    const [title, message, buttons] = alertSpy.mock.calls[0];
    expect(title).toBe("Je sessie is verlopen");
    expect(message).toContain("Log opnieuw in");

    // Tapping "Opnieuw inloggen" must navigate to the sign-in modal.
    const buttonList = buttons as Array<{ text?: string; onPress?: () => void }>;
    const signInButton = buttonList.find((b) => b.text === "Opnieuw inloggen");
    expect(signInButton).toBeTruthy();
    signInButton?.onPress?.();

    expect(routerPush).toHaveBeenCalledWith("/(auth)/sign-in");
  });

  it("collapses a burst of 401s into a single Alert", () => {
    const alertSpy = vi.spyOn(Alert, "alert");
    render(<SessionExpiredHandler />);

    captured.handler?.({ url: "/api/a", method: "GET" });
    captured.handler?.({ url: "/api/b", method: "GET" });
    captured.handler?.({ url: "/api/c", method: "GET" });

    expect(alertSpy).toHaveBeenCalledTimes(1);
  });

  it("clears the handler on unmount", () => {
    const { unmount } = render(<SessionExpiredHandler />);
    expect(captured.handler).toBeTypeOf("function");

    unmount();
    // _layout clears the slot on unmount by re-registering null.
    expect(captured.handler).toBeNull();
  });
});

// Guard the wiring itself: _layout must mount SessionExpiredHandler, otherwise
// no 401 handler is ever registered in the running app.
describe("_layout wiring", () => {
  it("mounts SessionExpiredHandler in the root layout", () => {
    const source = readFileSync(
      resolve(import.meta.dirname, "../app/_layout.tsx"),
      "utf8",
    );
    expect(source).toContain(
      'import { SessionExpiredHandler } from "@/components/SessionExpiredHandler"',
    );
    expect(source).toContain("<SessionExpiredHandler />");
  });
});
