import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { Alert, Text } from "react-native";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// The re-auth Alert promises "Je route blijft bewaard" while the rider signs in
// again. That promise holds only because RoutePlannerProvider is mounted ABOVE
// the expo-router stack in app/_layout.tsx: navigating to the sign-in screen
// swaps the screen beneath the provider, so the planner state never unmounts.
// This test simulates that exact topology — a planned route is built up, a 401
// fires the wired SessionExpiredHandler, the rider taps "Opnieuw inloggen", the
// screen under the provider swaps to sign-in and back — and asserts the route
// is still there. A refactor that moves the provider below the router (state
// wiped on navigation) or force-remounts it on 401 would fail this test.

const captured = vi.hoisted(() => ({
  handler: null as null | ((ctx: { url: string; method: string }) => void),
}));

const routerPush = vi.hoisted(() => vi.fn());

const apiState = vi.hoisted(() => ({
  planRoute: vi.fn(),
}));

vi.mock("@workspace/api-client-react", () => ({
  planRoute: (...args: unknown[]) => apiState.planRoute(...args),
  setUnauthorizedHandler: vi.fn((h) => {
    captured.handler = h;
  }),
  // Verify-before-prompt (forced token refresh, debounce) is unit-tested in
  // the lib; stub straight through to onExpired so this test exercises the
  // Alert → navigation → state-survival chain.
  createUnauthorizedHandler: (deps: { onExpired: () => void }) => () =>
    deps.onExpired(),
}));

vi.mock("expo-router", () => ({
  router: { push: routerPush },
}));

import {
  RoutePlannerProvider,
  useRoutePlanner,
  type NetworkNode,
  type RoutePlan,
} from "./RoutePlannerContext";
import { SessionExpiredHandler } from "@/components/SessionExpiredHandler";

const NODE_A: NetworkNode = { id: "1", ref: "63", lat: 52.0, lon: 5.0 };
const NODE_B: NetworkNode = { id: "2", ref: "08", lat: 52.01, lon: 5.01 };

const PLAN: RoutePlan = {
  nodeRefs: ["63", "08"],
  coordinates: [
    [5.0, 52.0],
    [5.01, 52.01],
  ],
  distanceMeters: 4200,
  legs: [
    {
      fromRef: "63",
      toRef: "08",
      distanceMeters: 4200,
      coordinates: [
        [5.0, 52.0],
        [5.01, 52.01],
      ],
    },
  ],
};

// The planner screen reads the shared context; its handle is captured so the
// test can drive addNode and inspect state exactly as the map screen would.
let plannerApi: ReturnType<typeof useRoutePlanner> | null = null;

function PlannerScreen() {
  plannerApi = useRoutePlanner();
  return (
    <Text testID="planner-refs">
      {plannerApi.selectedNodes.map((n) => n.ref).join(",")}
    </Text>
  );
}

function SignInScreen() {
  return <Text testID="sign-in-screen">Inloggen</Text>;
}

// Mirrors app/_layout.tsx: SessionExpiredHandler and RoutePlannerProvider stay
// mounted while the "router" swaps screens beneath them.
function AppTree({ screen: current }: { screen: "planner" | "sign-in" }) {
  return (
    <RoutePlannerProvider>
      <SessionExpiredHandler />
      {current === "planner" ? <PlannerScreen /> : <SignInScreen />}
    </RoutePlannerProvider>
  );
}

beforeEach(() => {
  captured.handler = null;
  routerPush.mockReset();
  apiState.planRoute.mockReset();
  plannerApi = null;
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("in-progress route survives re-authentication (mobile)", () => {
  it("keeps the planned route through 401 → Alert → sign-in screen → back", async () => {
    apiState.planRoute.mockResolvedValue(PLAN);
    const alertSpy = vi.spyOn(Alert, "alert");

    const { rerender } = render(<AppTree screen="planner" />);

    // Rider builds up a route mid-ride.
    act(() => plannerApi!.addNode(NODE_A));
    act(() => plannerApi!.addNode(NODE_B));
    await waitFor(() => expect(plannerApi!.routePlan).toEqual(PLAN));
    expect(apiState.planRoute).toHaveBeenCalledTimes(1);

    // A 401 fires through the central handler → re-auth Alert.
    act(() => captured.handler?.({ url: "/api/saved-routes", method: "POST" }));
    expect(alertSpy).toHaveBeenCalledTimes(1);
    const [, message, buttons] = alertSpy.mock.calls[0];
    expect(message).toContain("Je route blijft bewaard");

    // Rider taps "Opnieuw inloggen" → router pushes the sign-in screen.
    const buttonList = buttons as Array<{ text?: string; onPress?: () => void }>;
    const signInButton = buttonList.find((b) => b.text === "Opnieuw inloggen");
    expect(signInButton).toBeTruthy();
    act(() => signInButton?.onPress?.());
    expect(routerPush).toHaveBeenCalledWith("/(auth)/sign-in");

    // The sign-in screen replaces the planner screen BENEATH the provider —
    // exactly what expo-router does because the provider wraps the stack.
    rerender(<AppTree screen="sign-in" />);
    expect(screen.getByTestId("sign-in-screen")).toBeTruthy();

    // After re-authenticating the rider returns to the planner screen.
    rerender(<AppTree screen="planner" />);

    // The route is exactly as they left it — no re-plan, nothing wiped.
    expect(plannerApi!.selectedNodes.map((n) => n.ref)).toEqual(["63", "08"]);
    expect(plannerApi!.routePlan).toEqual(PLAN);
    expect(plannerApi!.planError).toBeNull();
    expect(apiState.planRoute).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("planner-refs").textContent).toBe("63,08");
  });

  it("control: a provider mounted below the router would lose the route", async () => {
    // Demonstrates the failure mode this suite guards against: if navigation
    // remounts the provider (provider below the router), all planner state is
    // gone when the rider returns. This is why _layout keeps it above.
    apiState.planRoute.mockResolvedValue(PLAN);

    function RemountingTree({ screen: current }: { screen: "planner" | "sign-in" }) {
      return current === "planner" ? (
        <RoutePlannerProvider key={current}>
          <PlannerScreen />
        </RoutePlannerProvider>
      ) : (
        <SignInScreen />
      );
    }

    const { rerender } = render(<RemountingTree screen="planner" />);
    act(() => plannerApi!.addNode(NODE_A));
    act(() => plannerApi!.addNode(NODE_B));
    await waitFor(() => expect(plannerApi!.routePlan).toEqual(PLAN));

    rerender(<RemountingTree screen="sign-in" />);
    rerender(<RemountingTree screen="planner" />);

    expect(plannerApi!.selectedNodes).toEqual([]);
    expect(plannerApi!.routePlan).toBeNull();
  });
});

// Static wiring guard: the real _layout.tsx must keep RoutePlannerProvider
// above the router stack. If a refactor moves <RootLayoutNav /> outside the
// provider, the simulation above no longer reflects the app and the "route is
// kept" promise silently breaks.
describe("_layout wiring", () => {
  it("mounts RoutePlannerProvider above the router stack", () => {
    const source = readFileSync(
      resolve(import.meta.dirname, "../app/_layout.tsx"),
      "utf8",
    );

    const providerOpen = source.indexOf("<RoutePlannerProvider>");
    const providerClose = source.indexOf("</RoutePlannerProvider>");
    const routerNav = source.indexOf("<RootLayoutNav />");

    expect(providerOpen).toBeGreaterThan(-1);
    expect(routerNav).toBeGreaterThan(-1);
    expect(providerClose).toBeGreaterThan(-1);
    // Provider opens before the router stack and closes after it.
    expect(providerOpen).toBeLessThan(routerNav);
    expect(routerNav).toBeLessThan(providerClose);
  });
});
