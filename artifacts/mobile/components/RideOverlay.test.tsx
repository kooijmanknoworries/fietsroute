import { afterEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { act, cleanup, render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  RoutePlannerProvider,
  useRoutePlanner,
  type NetworkNode,
  type RoutePlan,
} from "@/context/RoutePlannerContext";
import { RideProvider, useRideContext } from "@/context/RideContext";
import RoutePanel from "./RoutePanel";
import RideOverlay from "./RideOverlay";
import RideSummaryModal from "./RideSummaryModal";
import { isPlanningTapAllowed } from "@/lib/planning-guard";

const apiState = vi.hoisted(() => ({
  planRoute: vi.fn(),
}));

vi.mock("@workspace/api-client-react", () => ({
  planRoute: (...args: unknown[]) => apiState.planRoute(...args),
  useSaveRoute: () => ({ mutateAsync: vi.fn() }),
  getListSavedRoutesQueryKey: () => ["listSavedRoutes"],
  useSaveVisitedSegments: () => ({ mutate: vi.fn() }),
  useListVisitedSegments: () => ({ data: [] }),
  getListVisitedSegmentsQueryKey: () => ["listVisitedSegments"],
}));

vi.mock("@/lib/localRoutes", () => ({
  saveLocalRoute: vi.fn(),
}));

const NODE_A: NetworkNode = { id: "1", ref: "63", lat: 52.0, lon: 5.0 };
const NODE_B: NetworkNode = { id: "2", ref: "08", lat: 52.01, lon: 5.01 };
const NODE_C: NetworkNode = { id: "3", ref: "12", lat: 52.02, lon: 5.02 };

function makePlan(distanceMeters: number): RoutePlan {
  return {
    nodeRefs: ["63", "08"],
    coordinates: [
      [5.0, 52.0],
      [5.01, 52.01],
    ],
    distanceMeters,
    legs: [
      {
        fromRef: "63",
        toRef: "08",
        distanceMeters,
        coordinates: [
          [5.0, 52.0],
          [5.01, 52.01],
        ],
      },
    ],
  };
}

// Drives the shared context: add a planned route, then start the ride.
function Controls() {
  const { addNode, selectedNodes } = useRoutePlanner();
  const { isRiding, startRide, stopRide, rideSummary, dismissRideSummary } =
    useRideContext();
  // Mirrors app/index.tsx handleNodePress: a knooppunt marker tap that is
  // guarded by the same pure decision helper used on the real map.
  const handleNodePress = (node: NetworkNode) => {
    if (!isPlanningTapAllowed({ isRiding })) return;
    addNode(node);
  };
  return (
    <>
      <button
        data-testid="add-both"
        onClick={() => {
          addNode(NODE_A);
          addNode(NODE_B);
        }}
      >
        add both
      </button>
      <button data-testid="tap-node-c" onClick={() => handleNodePress(NODE_C)}>
        tap node c
      </button>
      <button data-testid="do-start" onClick={() => startRide()}>
        start
      </button>
      <button data-testid="do-stop" onClick={() => stopRide()}>
        stop
      </button>
      <span data-testid="node-count">{selectedNodes.length}</span>
      <RideSummaryModal summary={rideSummary} onClose={dismissRideSummary} />
    </>
  );
}

function withQuery(children: ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

function Harness() {
  return withQuery(
    <RoutePlannerProvider>
      <RideProvider>
        <Controls />
        <RoutePanel />
        <RideOverlay />
      </RideProvider>
    </RoutePlannerProvider>,
  );
}

afterEach(() => {
  apiState.planRoute.mockReset();
  cleanup();
});

describe("ride vs planning UI split", () => {
  it("hides the planning panel and shows the compact ride bar when riding", async () => {
    apiState.planRoute.mockResolvedValue(makePlan(1300));
    render(<Harness />);

    // Plan a route: the planning panel with its Start button appears.
    fireEvent.click(screen.getByTestId("add-both"));
    await waitFor(() => expect(screen.getByTestId("start-ride")).toBeTruthy());
    expect(screen.getByTestId("clear-route")).toBeTruthy();
    expect(screen.queryByTestId("ride-overlay")).toBeNull();

    // Flush the plan-resolution effect (which ends any active ride when the
    // route changes) before starting, so its pending pass can't fire *after*
    // the ride starts and abort it — a passive-effect ordering artifact of the
    // test harness, not real user behaviour.
    await act(async () => {
      await Promise.resolve();
    });

    // Start the ride; let the async permission + watch chain settle.
    await act(async () => {
      fireEvent.click(screen.getByTestId("do-start"));
      await new Promise((r) => setTimeout(r, 30));
    });

    // Planning chrome is gone; only the ride overlay with Stop remains.
    await waitFor(() => expect(screen.getByTestId("ride-overlay")).toBeTruthy());
    expect(screen.getByTestId("stop-ride")).toBeTruthy();
    expect(screen.queryByTestId("clear-route")).toBeNull();
    expect(screen.queryByTestId("start-ride")).toBeNull();

    // Stop the ride: overlay disappears, planning panel returns with the same
    // route intact, and the end-of-ride summary is shown.
    await act(async () => {
      fireEvent.click(screen.getByTestId("do-stop"));
      await Promise.resolve();
    });

    await waitFor(() => expect(screen.queryByTestId("ride-overlay")).toBeNull());
    expect(screen.getByTestId("start-ride")).toBeTruthy();
    expect(screen.getByTestId("clear-route")).toBeTruthy();
    expect(screen.getByTestId("node-chip-63")).toBeTruthy();
    expect(screen.getByTestId("ride-summary-title")).toBeTruthy();
  });

  it("ignores a knooppunt tap while riding so it can't mutate the route or abort the ride", async () => {
    apiState.planRoute.mockResolvedValue(makePlan(1300));
    render(<Harness />);

    // Plan a two-node route.
    fireEvent.click(screen.getByTestId("add-both"));
    await waitFor(() => expect(screen.getByTestId("start-ride")).toBeTruthy());
    expect(screen.getByTestId("node-count").textContent).toBe("2");

    // Flush the plan-resolution effect before starting (see the test above).
    await act(async () => {
      await Promise.resolve();
    });

    // Start the ride; let the async permission + watch chain settle.
    await act(async () => {
      fireEvent.click(screen.getByTestId("do-start"));
      await new Promise((r) => setTimeout(r, 30));
    });
    await waitFor(() => expect(screen.getByTestId("ride-overlay")).toBeTruthy());

    apiState.planRoute.mockClear();

    // Simulate an accidental knooppunt marker tap while riding.
    await act(async () => {
      fireEvent.click(screen.getByTestId("tap-node-c"));
      await new Promise((r) => setTimeout(r, 30));
    });

    // The tap was ignored: no node added, no re-plan, and the ride is intact.
    expect(screen.getByTestId("node-count").textContent).toBe("2");
    expect(apiState.planRoute).not.toHaveBeenCalled();
    expect(screen.getByTestId("ride-overlay")).toBeTruthy();
    expect(screen.getByTestId("stop-ride")).toBeTruthy();
    expect(screen.queryByTestId("start-ride")).toBeNull();
    expect(screen.queryByTestId("ride-summary-title")).toBeNull();
  });
});
