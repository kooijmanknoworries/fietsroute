import { afterEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import {
  RoutePlannerProvider,
  useRoutePlanner,
  type NetworkNode,
  type RoutePlan,
} from "./RoutePlannerContext";

// Backing store for the mocked planRoute call so each test can drive the
// resolved/rejected shape (and inspect the arguments) without a real request.
const apiState = vi.hoisted(() => ({
  planRoute: vi.fn(),
}));

vi.mock("@workspace/api-client-react", () => ({
  planRoute: (...args: unknown[]) => apiState.planRoute(...args),
}));

const NODE_A: NetworkNode = { id: "1", ref: "63", lat: 52.0, lon: 5.0 };
const NODE_B: NetworkNode = { id: "2", ref: "08", lat: 52.01, lon: 5.01 };
const NODE_C: NetworkNode = { id: "3", ref: "12", lat: 52.02, lon: 5.02 };

function makePlan(nodeRefs: string[]): RoutePlan {
  return {
    nodeRefs,
    coordinates: [
      [5.0, 52.0],
      [5.01, 52.01],
    ],
    distanceMeters: 4200,
    legs: nodeRefs.slice(1).map((toRef, i) => ({
      fromRef: nodeRefs[i],
      toRef,
      distanceMeters: 2100,
      coordinates: [
        [5.0, 52.0],
        [5.01, 52.01],
      ],
    })),
  };
}

function wrapper({ children }: { children: ReactNode }) {
  return <RoutePlannerProvider>{children}</RoutePlannerProvider>;
}

afterEach(() => {
  apiState.planRoute.mockReset();
  cleanup();
});

describe("RoutePlannerContext node selection", () => {
  it("adds nodes and ignores duplicates", async () => {
    apiState.planRoute.mockResolvedValue(makePlan(["63", "08"]));
    const { result } = renderHook(() => useRoutePlanner(), { wrapper });

    act(() => result.current.addNode(NODE_A));
    expect(result.current.selectedNodes.map((n) => n.id)).toEqual(["1"]);

    // Re-adding the same node is a no-op.
    act(() => result.current.addNode(NODE_A));
    expect(result.current.selectedNodes).toHaveLength(1);

    act(() => result.current.addNode(NODE_B));
    expect(result.current.selectedNodes.map((n) => n.id)).toEqual(["1", "2"]);
  });

  it("removes a node by id", () => {
    apiState.planRoute.mockResolvedValue(makePlan(["63", "08"]));
    const { result } = renderHook(() => useRoutePlanner(), { wrapper });

    act(() => result.current.addNode(NODE_A));
    act(() => result.current.addNode(NODE_B));
    act(() => result.current.removeNode(NODE_A.id));

    expect(result.current.selectedNodes.map((n) => n.id)).toEqual(["2"]);
  });

  it("undoes the last added node", () => {
    apiState.planRoute.mockResolvedValue(makePlan(["63", "08"]));
    const { result } = renderHook(() => useRoutePlanner(), { wrapper });

    act(() => result.current.addNode(NODE_A));
    act(() => result.current.addNode(NODE_B));
    act(() => result.current.undoLastNode());

    expect(result.current.selectedNodes.map((n) => n.id)).toEqual(["1"]);

    // Undo on an empty selection is safe.
    act(() => result.current.undoLastNode());
    act(() => result.current.undoLastNode());
    expect(result.current.selectedNodes).toEqual([]);
  });

  it("clears the whole route and its plan", async () => {
    apiState.planRoute.mockResolvedValue(makePlan(["63", "08"]));
    const { result } = renderHook(() => useRoutePlanner(), { wrapper });

    act(() => result.current.addNode(NODE_A));
    act(() => result.current.addNode(NODE_B));
    await waitFor(() => expect(result.current.routePlan).not.toBeNull());

    act(() => result.current.clearRoute());

    expect(result.current.selectedNodes).toEqual([]);
    expect(result.current.routePlan).toBeNull();
    expect(result.current.planError).toBeNull();
    expect(result.current.isPlanning).toBe(false);
  });
});

describe("RoutePlannerContext route planning", () => {
  it("does not call planRoute until at least two nodes are selected", () => {
    apiState.planRoute.mockResolvedValue(makePlan(["63", "08"]));
    const { result } = renderHook(() => useRoutePlanner(), { wrapper });

    act(() => result.current.addNode(NODE_A));
    expect(apiState.planRoute).not.toHaveBeenCalled();
    expect(result.current.routePlan).toBeNull();
  });

  it("plans a route once two nodes are selected and stores the plan", async () => {
    const plan = makePlan(["63", "08"]);
    apiState.planRoute.mockResolvedValue(plan);
    const { result } = renderHook(() => useRoutePlanner(), { wrapper });

    act(() => result.current.addNode(NODE_A));
    act(() => result.current.addNode(NODE_B));

    await waitFor(() => expect(result.current.routePlan).toEqual(plan));
    expect(result.current.isPlanning).toBe(false);
    expect(result.current.planError).toBeNull();

    // planRoute receives the selected nodes mapped to the request shape.
    const lastCall = apiState.planRoute.mock.calls.at(-1)?.[0];
    expect(lastCall).toEqual({
      nodes: [
        { id: "1", ref: "63", lat: 52.0, lon: 5.0 },
        { id: "2", ref: "08", lat: 52.01, lon: 5.01 },
      ],
    });
  });

  it("surfaces a friendly error when planning fails", async () => {
    apiState.planRoute.mockRejectedValue(new Error("boom"));
    const { result } = renderHook(() => useRoutePlanner(), { wrapper });

    act(() => result.current.addNode(NODE_A));
    act(() => result.current.addNode(NODE_B));

    await waitFor(() =>
      expect(result.current.planError).toBe("Kan route niet berekenen"),
    );
    expect(result.current.routePlan).toBeNull();
    expect(result.current.isPlanning).toBe(false);
  });

  it("clears the plan when nodes drop back below two", async () => {
    apiState.planRoute.mockResolvedValue(makePlan(["63", "08"]));
    const { result } = renderHook(() => useRoutePlanner(), { wrapper });

    act(() => result.current.addNode(NODE_A));
    act(() => result.current.addNode(NODE_B));
    await waitFor(() => expect(result.current.routePlan).not.toBeNull());

    act(() => result.current.removeNode(NODE_B.id));
    await waitFor(() => expect(result.current.routePlan).toBeNull());
    expect(result.current.planError).toBeNull();
  });

  it("drops a stale in-flight response when the selection changes again", async () => {
    // First plan is slow; a second selection change supersedes it. When the
    // slow response finally resolves it must be ignored (generation guard).
    let resolveSlow: (plan: RoutePlan) => void = () => {};
    const slowPlan = makePlan(["63", "08"]);
    const freshPlan = makePlan(["63", "08", "12"]);

    apiState.planRoute
      .mockImplementationOnce(
        () => new Promise<RoutePlan>((res) => (resolveSlow = res)),
      )
      .mockResolvedValueOnce(freshPlan);

    const { result } = renderHook(() => useRoutePlanner(), { wrapper });

    act(() => result.current.addNode(NODE_A));
    act(() => result.current.addNode(NODE_B)); // kicks off the slow request
    act(() => result.current.addNode(NODE_C)); // supersedes it

    await waitFor(() => expect(result.current.routePlan).toEqual(freshPlan));

    // Now let the stale request resolve — it must not overwrite the fresh plan.
    await act(async () => {
      resolveSlow(slowPlan);
      await Promise.resolve();
    });

    expect(result.current.routePlan).toEqual(freshPlan);
  });
});
