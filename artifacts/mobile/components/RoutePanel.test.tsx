import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, fireEvent, waitFor } from "@testing-library/react";
import {
  RoutePlannerProvider,
  useRoutePlanner,
  type NetworkNode,
  type RoutePlan,
} from "@/context/RoutePlannerContext";
import RoutePanel from "./RoutePanel";

const apiState = vi.hoisted(() => ({
  planRoute: vi.fn(),
}));

vi.mock("@workspace/api-client-react", () => ({
  planRoute: (...args: unknown[]) => apiState.planRoute(...args),
}));

const NODE_A: NetworkNode = { id: "1", ref: "63", lat: 52.0, lon: 5.0 };
const NODE_B: NetworkNode = { id: "2", ref: "08", lat: 52.01, lon: 5.01 };

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

// Drives the context from within the provider so the panel and the controls
// share the same state.
function Controls() {
  const { addNode } = useRoutePlanner();
  return (
    <button data-testid="add-a" onClick={() => addNode(NODE_A)}>
      add a
    </button>
  );
}

function Harness() {
  return (
    <RoutePlannerProvider>
      <Controls />
      <RoutePanel />
    </RoutePlannerProvider>
  );
}

afterEach(() => {
  apiState.planRoute.mockReset();
  cleanup();
});

describe("RoutePanel", () => {
  it("stays hidden until a node is selected", () => {
    apiState.planRoute.mockResolvedValue(makePlan(4200));
    render(<Harness />);

    // No node chips are rendered while the selection is empty.
    expect(screen.queryByTestId("node-chip-63")).toBeNull();
    expect(screen.queryByTestId("clear-route")).toBeNull();
  });

  it("shows the selected node chip after a tap", () => {
    apiState.planRoute.mockResolvedValue(makePlan(4200));
    render(<Harness />);

    fireEvent.click(screen.getByTestId("add-a"));

    expect(screen.getByTestId("node-chip-63")).toBeTruthy();
    expect(screen.getByTestId("clear-route")).toBeTruthy();
  });

  it("displays the planned route distance once two nodes are chosen", async () => {
    apiState.planRoute.mockResolvedValue(makePlan(4200));
    render(<HarnessWithTwo />);

    fireEvent.click(screen.getByTestId("add-both"));

    // 4200 m -> "4.2 km" via formatDistance.
    await waitFor(() => expect(screen.getByText("4.2 km")).toBeTruthy());
    // Route summary reflects the number of legs.
    expect(screen.getByText(/1 etappe/)).toBeTruthy();
  });

  it("shows the error message when planning fails", async () => {
    apiState.planRoute.mockRejectedValue(new Error("boom"));
    render(<HarnessWithTwo />);

    fireEvent.click(screen.getByTestId("add-both"));

    await waitFor(() =>
      expect(screen.getByText("Kan route niet berekenen")).toBeTruthy(),
    );
  });
});

// A second harness that adds two nodes in one tap so a route gets planned.
function ControlsTwo() {
  const { addNode } = useRoutePlanner();
  return (
    <button
      data-testid="add-both"
      onClick={() => {
        addNode(NODE_A);
        addNode(NODE_B);
      }}
    >
      add both
    </button>
  );
}

function HarnessWithTwo() {
  return (
    <RoutePlannerProvider>
      <ControlsTwo />
      <RoutePanel />
    </RoutePlannerProvider>
  );
}
