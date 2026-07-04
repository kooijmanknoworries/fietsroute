import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { Router as WouterRouter, useLocation } from "wouter";
import { getRegions, setUnauthorizedHandler } from "@workspace/api-client-react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { SessionExpiredHandler } from "./SessionExpiredHandler";
import { Toaster } from "@/components/ui/toaster";
import { I18nProvider } from "@/lib/i18n";

// This test proves the *wired* UI reacts to a real 401 — not just that the
// central handler fires (that's covered by unauthorized-handler.test.ts). It
// renders the exact SessionExpiredHandler App mounts, alongside the real
// Toaster, drives a genuine API call to a 401, and asserts the rider sees the
// "sign in again" prompt with a working action.
//
// The handler verifies the session is really gone (a forced Clerk token
// refresh) before prompting, so we mock Clerk's getToken: null means the
// session is genuinely expired (prompt), a token means a transient 401 (stay
// silent). The verify/debounce logic itself is unit-tested in the lib.

// Controls what the mocked Clerk getToken resolves to for a given test.
const tokenState = vi.hoisted(() => ({ token: null as string | null }));

vi.mock("@clerk/react", () => ({
  useAuth: () => ({
    getToken: async () => tokenState.token,
    isLoaded: true,
  }),
}));

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

// Surfaces the current wouter location so the test can assert the "Sign in
// again" action actually navigates.
function LocationProbe() {
  const [location] = useLocation();
  return <div data-testid="location">{location}</div>;
}

function renderTree() {
  return render(
    <I18nProvider>
      <WouterRouter>
        <SessionExpiredHandler />
        <LocationProbe />
        <Toaster />
      </WouterRouter>
    </I18nProvider>,
  );
}

// The i18n provider defaults to Dutch; pin the language so assertions are
// stable regardless of any persisted preference in the environment.
function useLang(lang: "nl" | "en") {
  localStorage.setItem("fietsrouteplanner.lang", lang);
}

async function fireUnauthorized(): Promise<void> {
  vi.spyOn(globalThis, "fetch").mockResolvedValue(
    jsonResponse(401, { title: "Unauthorized" }),
  );
  // A real API call routed through the shared client, so the whole 401 path
  // (custom-fetch → registered handler → forced token refresh → toast) runs
  // end to end. The handler verifies asynchronously, so flush microtasks.
  await act(async () => {
    await getRegions().catch(() => {});
    await Promise.resolve();
  });
}

beforeEach(() => {
  useLang("en");
  tokenState.token = null;
});

afterEach(() => {
  cleanup();
  setUnauthorizedHandler(null);
  vi.restoreAllMocks();
  localStorage.clear();
});

describe("SessionExpiredHandler (wired UI)", () => {
  it("shows the re-auth toast when a 401 means the session really expired", async () => {
    renderTree();
    await fireUnauthorized();

    expect(await screen.findByText("Your session expired")).toBeTruthy();
    expect(
      screen.getByText(
        "Please sign in again to keep planning. Your current route is kept.",
      ),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Sign in again" }),
    ).toBeTruthy();
  });

  it("navigates to the sign-in page when the toast action is clicked", async () => {
    renderTree();
    await fireUnauthorized();

    const action = await screen.findByRole("button", { name: "Sign in again" });
    fireEvent.click(action);

    await waitFor(() =>
      expect(screen.getByTestId("location").textContent).toBe("/sign-in"),
    );
  });

  it("renders the Dutch prompt when the language is Dutch", async () => {
    useLang("nl");
    renderTree();
    await fireUnauthorized();

    expect(await screen.findByText("Je sessie is verlopen")).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Opnieuw inloggen" }),
    ).toBeTruthy();
  });

  it("clears the handler on unmount so a later 401 shows nothing", async () => {
    const { unmount } = renderTree();
    unmount();

    const handler = vi.fn();
    // Re-registering proves the component released the slot; if it hadn't, its
    // stale toast callback would still be the active handler.
    setUnauthorizedHandler(handler);
    await fireUnauthorized();

    expect(handler).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("Your session expired")).toBeNull();
  });
});

// Guard the wiring itself: App must mount SessionExpiredHandler, otherwise the
// handler above is never registered in the running app no matter how correct
// the component is.
describe("App wiring", () => {
  it("mounts SessionExpiredHandler in the app tree", () => {
    const source = readFileSync(
      resolve(import.meta.dirname, "../App.tsx"),
      "utf8",
    );
    expect(source).toContain(
      'import { SessionExpiredHandler } from "@/components/SessionExpiredHandler"',
    );
    expect(source).toContain("<SessionExpiredHandler />");
  });
});
