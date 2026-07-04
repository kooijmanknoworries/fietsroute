import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { act, cleanup, renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { I18nProvider } from "@/lib/i18n";
import {
  MAX_PREFETCH_SPAN_DEG,
  neighbourBboxes,
  splitNeighboursByDirection,
  isSlowConnection,
  useRoutePlanner,
  type Neighbour,
} from "./use-route-planner";

// Shared, mutable state backing the mocked network query so individual tests
// can flip `isFetching` / swap the `data` reference to drive the pre-load
// effect's dependencies without re-issuing real requests.
const apiState = vi.hoisted(() => ({
  network: { data: { nodes: [] } as unknown, isFetching: false },
  // Backing store for the mocked usePlanRoute mutation so route-error tests can
  // swap in a `mutate` that synchronously drives onSuccess / onError.
  plan: { mutate: (() => {}) as unknown, isPending: false },
}));

const authState = vi.hoisted(() => ({
  value: { isSignedIn: false, userId: undefined } as {
    isSignedIn: boolean;
    userId: string | undefined;
  },
}));

vi.mock("@clerk/react", () => ({
  useAuth: () => authState.value,
}));

vi.mock("@workspace/api-client-react", () => ({
  useGetNetwork: () => apiState.network,
  usePlanRoute: () => apiState.plan,
  useGetRegions: () => ({ data: undefined }),
  useListSavedRoutes: () => ({ data: undefined, isLoading: false }),
  useSaveRoute: () => ({ mutate: vi.fn(), isPending: false }),
  useDeleteSavedRoute: () => ({ mutate: vi.fn(), isPending: false }),
  useUpdateSavedRoute: () => ({ mutate: vi.fn(), isPending: false }),
  getSavedRoute: vi.fn(),
  getNetwork: vi.fn(() => Promise.resolve({ nodes: [] })),
  getListSavedRoutesQueryKey: () => ["saved-routes"],
  getGetNetworkQueryKey: (params?: { bbox: string }) => ["network", params?.bbox],
  getGetRegionsQueryKey: () => ["regions"],
}));

describe("neighbourBboxes", () => {
  it("returns the eight surrounding tiles for a small view", () => {
    const neighbours = neighbourBboxes("5.0,52.0,5.1,52.1");
    expect(neighbours).toHaveLength(8);

    // Every (dx, dy) offset except (0, 0) should be present exactly once.
    const offsets = neighbours
      .map((n) => `${n.dx},${n.dy}`)
      .sort();
    expect(offsets).toEqual(
      [
        "-1,-1",
        "-1,0",
        "-1,1",
        "0,-1",
        "0,1",
        "1,-1",
        "1,0",
        "1,1",
      ].sort(),
    );
  });

  it("shifts each neighbour by one full view and matches the snapped bbox format", () => {
    const neighbours = neighbourBboxes("5.0,52.0,5.1,52.1");
    const east = neighbours.find((n) => n.dx === 1 && n.dy === 0);
    // Number(v.toFixed(3)) drops trailing zeros: 52.000 -> 52, 5.100 -> 5.1.
    expect(east?.bbox).toBe("5.1,52,5.2,52.1");

    const northEast = neighbours.find((n) => n.dx === 1 && n.dy === 1);
    expect(northEast?.bbox).toBe("5.1,52.1,5.2,52.2");
  });

  it("skips pre-loading when the view is wider than MAX_PREFETCH_SPAN_DEG", () => {
    const tooWide = `5.0,52.0,${5.0 + MAX_PREFETCH_SPAN_DEG + 0.1},52.1`;
    expect(neighbourBboxes(tooWide)).toEqual([]);
  });

  it("skips pre-loading when the view is taller than MAX_PREFETCH_SPAN_DEG", () => {
    const tooTall = `5.0,52.0,5.1,${52.0 + MAX_PREFETCH_SPAN_DEG + 0.1}`;
    expect(neighbourBboxes(tooTall)).toEqual([]);
  });

  it("still pre-loads a view comfortably within the span limit", () => {
    const withinLimit = `5.0,52.0,${5.0 + MAX_PREFETCH_SPAN_DEG - 0.05},${52.0 + MAX_PREFETCH_SPAN_DEG - 0.05}`;
    expect(neighbourBboxes(withinLimit)).toHaveLength(8);
  });

  it("clips tiles that would cross the north pole", () => {
    // height 0.1, north 89.95 -> the dy=1 row would reach 90.05 (> 90).
    const neighbours = neighbourBboxes("5.0,89.85,5.1,89.95");
    expect(neighbours.every((n) => n.dy !== 1)).toBe(true);
    expect(neighbours).toHaveLength(5);
  });

  it("clips tiles that would cross the antimeridian", () => {
    // width 0.1, east 179.95 -> the dx=1 column would reach 180.05 (> 180).
    const neighbours = neighbourBboxes("179.85,52.0,179.95,52.1");
    expect(neighbours.every((n) => n.dx !== 1)).toBe(true);
    expect(neighbours).toHaveLength(5);
  });

  it("returns [] for malformed or degenerate bboxes", () => {
    expect(neighbourBboxes("")).toEqual([]);
    expect(neighbourBboxes("1,2,3")).toEqual([]);
    expect(neighbourBboxes("a,b,c,d")).toEqual([]);
    // Zero / negative width or height.
    expect(neighbourBboxes("5,52,5,52.1")).toEqual([]);
    expect(neighbourBboxes("5.1,52,5.0,52.1")).toEqual([]);
  });
});

describe("splitNeighboursByDirection", () => {
  const neighbours = neighbourBboxes("5.0,52.0,5.1,52.1");

  it("warms all tiles when there is no pan direction", () => {
    const { leading, trailing } = splitNeighboursByDirection(neighbours, null);
    expect(leading).toEqual(neighbours);
    expect(trailing).toEqual([]);
  });

  it("warms all tiles when the pan direction has zero magnitude", () => {
    const { leading, trailing } = splitNeighboursByDirection(neighbours, {
      dx: 0,
      dy: 0,
    });
    expect(leading).toEqual(neighbours);
    expect(trailing).toEqual([]);
  });

  it("puts the tiles in the heading direction in 'leading'", () => {
    // Panning east (dx: 1): only the eastern column leads.
    const { leading, trailing } = splitNeighboursByDirection(neighbours, {
      dx: 1,
      dy: 0,
    });
    expect(leading.length).toBeGreaterThan(0);
    expect(leading.every((n) => n.dx === 1)).toBe(true);
    expect(leading).toHaveLength(3);
    expect(trailing).toHaveLength(neighbours.length - leading.length);
    expect(trailing.every((n) => n.dx !== 1)).toBe(true);
  });

  it("leads in the diagonal direction when panning diagonally", () => {
    const { leading } = splitNeighboursByDirection(neighbours, {
      dx: 1,
      dy: 1,
    });
    // The north-east corner is the most aligned tile and must lead.
    expect(leading).toContainEqual(
      expect.objectContaining({ dx: 1, dy: 1 }),
    );
    // The opposite (south-west) corner must never lead.
    expect(leading).not.toContainEqual(
      expect.objectContaining({ dx: -1, dy: -1 }),
    );
  });

  it("falls back to warming everything when no tile is aligned enough", () => {
    // A direction whose tiles all score at or below the 0.3 threshold would
    // leave 'leading' empty; the helper then warms all tiles instead.
    const sparse: Neighbour[] = [{ bbox: "x", dx: 0, dy: 1 }];
    const { leading, trailing } = splitNeighboursByDirection(sparse, {
      dx: 1,
      dy: 0,
    });
    expect(leading).toEqual(sparse);
    expect(trailing).toEqual([]);
  });
});

describe("isSlowConnection", () => {
  const nav = navigator as Navigator & { connection?: unknown };
  const hadConnection = "connection" in nav;
  const original = (nav as { connection?: unknown }).connection;

  const setConnection = (conn: unknown) => {
    Object.defineProperty(nav, "connection", {
      value: conn,
      configurable: true,
      writable: true,
    });
  };

  afterEach(() => {
    if (hadConnection) {
      setConnection(original);
    } else {
      delete (nav as { connection?: unknown }).connection;
    }
  });

  it("reports a fast connection when the Network Information API is absent", () => {
    delete (nav as { connection?: unknown }).connection;
    expect(isSlowConnection()).toBe(false);
  });

  it("honours the saveData (data-saver) flag", () => {
    setConnection({ saveData: true, effectiveType: "4g" });
    expect(isSlowConnection()).toBe(true);
  });

  it("treats a 2g effectiveType as slow", () => {
    setConnection({ saveData: false, effectiveType: "2g" });
    expect(isSlowConnection()).toBe(true);
  });

  it("treats slow-2g as slow", () => {
    setConnection({ saveData: false, effectiveType: "slow-2g" });
    expect(isSlowConnection()).toBe(true);
  });

  it("treats 3g and 4g as fast", () => {
    setConnection({ saveData: false, effectiveType: "3g" });
    expect(isSlowConnection()).toBe(false);
    setConnection({ saveData: false, effectiveType: "4g" });
    expect(isSlowConnection()).toBe(false);
  });
});

// Orchestration: the pre-load useEffect inside useRoutePlanner that actually
// wires the pure helpers together — fetching the leading edge eagerly,
// deferring (or skipping) the trailing tiles, and pre-loading each settled
// bbox only once. These render the hook with a real QueryClient (whose
// prefetchQuery is spied) and fake timers to step through the adaptive delays.
describe("useRoutePlanner pre-load orchestration", () => {
  const nav = navigator as Navigator & { connection?: unknown };
  const hadConnection = "connection" in nav;
  const originalConnection = (nav as { connection?: unknown }).connection;

  const setConnection = (conn: unknown) => {
    Object.defineProperty(nav, "connection", {
      value: conn,
      configurable: true,
      writable: true,
    });
  };

  const hadIdleCallback = "requestIdleCallback" in window;
  const originalIdleCallback = (window as { requestIdleCallback?: unknown })
    .requestIdleCallback;

  const DEBOUNCE_MS = 500;
  // The leading edge is scheduled via setTimeout(300) when requestIdleCallback
  // is unavailable; the default trailing delay (no Network Info API) is 700ms.
  const LEADING_DELAY_MS = 300;
  const TRAILING_DELAY_MS = 700;

  function renderPlanner() {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const prefetchSpy = vi
      .spyOn(queryClient, "prefetchQuery")
      .mockResolvedValue(undefined);
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>
        <I18nProvider>{children}</I18nProvider>
      </QueryClientProvider>
    );
    const view = renderHook(() => useRoutePlanner(), { wrapper });
    return { ...view, queryClient, prefetchSpy };
  }

  // Pull the prefetched bbox out of each spied prefetchQuery call. The mocked
  // getGetNetworkQueryKey returns ["network", bbox].
  const prefetchedBboxes = (spy: ReturnType<typeof vi.fn>): string[] =>
    spy.mock.calls.map((c) => {
      const arg = c[0] as { queryKey: [string, string] };
      return arg.queryKey[1];
    });

  beforeEach(() => {
    vi.useFakeTimers();
    apiState.network = { data: { nodes: [] }, isFetching: false };
    // Force the deterministic setTimeout scheduling path for the leading edge.
    delete (window as { requestIdleCallback?: unknown }).requestIdleCallback;
    // Default: no Network Information API, i.e. a "normal" connection.
    delete (nav as { connection?: unknown }).connection;
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
    cleanup();
    if (hadConnection) {
      setConnection(originalConnection);
    } else {
      delete (nav as { connection?: unknown }).connection;
    }
    if (hadIdleCallback) {
      (window as { requestIdleCallback?: unknown }).requestIdleCallback =
        originalIdleCallback;
    } else {
      delete (window as { requestIdleCallback?: unknown }).requestIdleCallback;
    }
  });

  it("prefetches the leading edge before the trailing tiles", () => {
    const bbox = "5.0,52.0,5.1,52.1";
    const direction = { dx: 1, dy: 0 };
    const neighbours = neighbourBboxes(bbox);
    const { leading, trailing } = splitNeighboursByDirection(
      neighbours,
      direction,
    );
    expect(leading.length).toBeGreaterThan(0);
    expect(trailing.length).toBeGreaterThan(0);

    const { result, prefetchSpy } = renderPlanner();
    act(() => {
      result.current.handleViewportChange(bbox, direction);
    });
    // Let the viewport debounce settle so the network query "resolves".
    act(() => {
      vi.advanceTimersByTime(DEBOUNCE_MS);
    });

    // After only the leading delay, exactly the leading tiles are warmed.
    act(() => {
      vi.advanceTimersByTime(LEADING_DELAY_MS);
    });
    const afterLeading = prefetchedBboxes(prefetchSpy);
    expect([...afterLeading].sort()).toEqual(
      leading.map((n) => n.bbox).sort(),
    );
    for (const t of trailing) {
      expect(afterLeading).not.toContain(t.bbox);
    }

    // After the trailing delay elapses, the rest are warmed too.
    act(() => {
      vi.advanceTimersByTime(TRAILING_DELAY_MS);
    });
    const afterAll = prefetchedBboxes(prefetchSpy);
    expect([...afterAll].sort()).toEqual(
      [...leading, ...trailing].map((n) => n.bbox).sort(),
    );
  });

  it("skips the trailing tiles entirely on a slow connection", () => {
    setConnection({ saveData: true, effectiveType: "4g" });

    const bbox = "5.0,52.0,5.1,52.1";
    const direction = { dx: 1, dy: 0 };
    const neighbours = neighbourBboxes(bbox);
    const { leading, trailing } = splitNeighboursByDirection(
      neighbours,
      direction,
    );

    const { result, prefetchSpy } = renderPlanner();
    act(() => {
      result.current.handleViewportChange(bbox, direction);
    });
    act(() => {
      vi.advanceTimersByTime(DEBOUNCE_MS + LEADING_DELAY_MS);
    });
    // Advance well past any trailing delay — the trailing tiles must never run.
    act(() => {
      vi.advanceTimersByTime(5000);
    });

    const warmed = prefetchedBboxes(prefetchSpy);
    expect([...warmed].sort()).toEqual(leading.map((n) => n.bbox).sort());
    for (const t of trailing) {
      expect(warmed).not.toContain(t.bbox);
    }
  });

  it("pre-loads each settled bbox only once", () => {
    const bbox = "5.0,52.0,5.1,52.1";
    const { result, prefetchSpy, rerender } = renderPlanner();

    // No pan direction -> every neighbour is part of the leading edge.
    const expected = neighbourBboxes(bbox).map((n) => n.bbox).sort();

    act(() => {
      result.current.handleViewportChange(bbox, null);
    });
    // Settle the debounce first (this registers the leading timer), then let
    // the leading/trailing delays elapse in a separate step.
    act(() => {
      vi.advanceTimersByTime(DEBOUNCE_MS);
    });
    act(() => {
      vi.advanceTimersByTime(LEADING_DELAY_MS + TRAILING_DELAY_MS);
    });

    const firstRound = prefetchedBboxes(prefetchSpy);
    expect([...firstRound].sort()).toEqual(expected);
    const callsAfterFirst = prefetchSpy.mock.calls.length;

    // Swap the network query's data reference (same bbox) so the pre-load
    // effect re-runs. The prefetchedBboxRef guard must stop it warming the
    // same neighbours again.
    apiState.network = { data: { nodes: [] }, isFetching: false };
    act(() => {
      rerender();
    });
    act(() => {
      vi.advanceTimersByTime(LEADING_DELAY_MS + TRAILING_DELAY_MS);
    });

    expect(prefetchSpy.mock.calls.length).toBe(callsAfterFirst);
  });
});

describe("useRoutePlanner route error handling", () => {
  type NetworkNode = { id: string; ref: string; lat: number; lon: number };
  type PlanCallbacks = {
    onSuccess: (plan: unknown) => void;
    onError: (err: unknown) => void;
  };

  const NODE_A: NetworkNode = { id: "1", ref: "63", lat: 52.0, lon: 5.0 };
  const NODE_B: NetworkNode = { id: "2", ref: "08", lat: 52.01, lon: 5.01 };
  const NODE_C: NetworkNode = { id: "3", ref: "12", lat: 52.02, lon: 5.02 };
  const FAKE_PLAN = { legs: [], nodes: [] } as unknown;

  // NL-only i18n strings (I18nProvider defaults to DEFAULT_LANG = "nl").
  const MSG_NO_PATH = "Kon geen verbindende route tussen deze knooppunten vinden.";
  const MSG_COMPUTE_FAILED = "Kon de route niet berekenen.";

  function renderPlanner() {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>
        <I18nProvider>{children}</I18nProvider>
      </QueryClientProvider>
    );
    return renderHook(() => useRoutePlanner(), { wrapper });
  }

  afterEach(() => {
    apiState.plan = { mutate: () => {}, isPending: false };
    cleanup();
  });

  it("shows the friendly no-path message on a 422 and reverts the last node", () => {
    apiState.plan = {
      mutate: (_vars: unknown, cbs: PlanCallbacks) => {
        cbs.onError({ status: 422, message: "HTTP 422: Could not locate node" });
      },
      isPending: false,
    };

    const { result } = renderPlanner();

    act(() => {
      result.current.handleNodeClick(NODE_A);
    });
    act(() => {
      result.current.handleNodeClick(NODE_B);
    });

    expect(result.current.routeError).toBe(MSG_NO_PATH);
    expect(result.current.routePlan).toBeNull();
    // The endpoint that couldn't be routed is rolled back, leaving only NODE_A.
    expect(result.current.selectedNodes).toHaveLength(1);
    expect(result.current.selectedNodes[0].id).toBe(NODE_A.id);
  });

  it("shows the generic compute-failed message for a non-422 error", () => {
    apiState.plan = {
      mutate: (_vars: unknown, cbs: PlanCallbacks) => {
        cbs.onError({ status: 500, message: "boom" });
      },
      isPending: false,
    };

    const { result } = renderPlanner();

    act(() => {
      result.current.handleNodeClick(NODE_A);
    });
    act(() => {
      result.current.handleNodeClick(NODE_B);
    });

    expect(result.current.routeError).toBe(MSG_COMPUTE_FAILED);
  });

  it("keeps the previously computed route when a later re-plan fails", () => {
    // First plan succeeds and populates routePlan.
    apiState.plan = {
      mutate: (_vars: unknown, cbs: PlanCallbacks) => cbs.onSuccess(FAKE_PLAN),
      isPending: false,
    };

    const { result, rerender } = renderPlanner();

    act(() => {
      result.current.handleNodeClick(NODE_A);
    });
    act(() => {
      result.current.handleNodeClick(NODE_B);
    });

    expect(result.current.routePlan).toBe(FAKE_PLAN);

    // A subsequent click fails to route; the prior route must remain intact.
    apiState.plan = {
      mutate: (_vars: unknown, cbs: PlanCallbacks) => {
        cbs.onError({ status: 422, message: "no path" });
      },
      isPending: false,
    };
    // Re-render so the hook's memoized handlers capture the new (failing) mutate.
    act(() => {
      rerender();
    });

    act(() => {
      result.current.handleNodeClick(NODE_C);
    });

    expect(result.current.routeError).toBe(MSG_NO_PATH);
    // The previously computed route must survive the failed re-plan.
    expect(result.current.routePlan).toBe(FAKE_PLAN);
  });
});

describe("useRoutePlanner draft persistence", () => {
  type Node = { id: string; ref: string; lat: number; lon: number };
  type PlanCallbacks = {
    onSuccess: (plan: unknown) => void;
    onError: (err: unknown) => void;
  };

  const NODE_A: Node = { id: "1", ref: "63", lat: 52.0, lon: 5.0 };
  const NODE_B: Node = { id: "2", ref: "08", lat: 52.01, lon: 5.01 };
  const PLAN = {
    nodeRefs: ["63", "08"],
    coordinates: [
      [5.0, 52.0],
      [5.01, 52.01],
    ],
    distanceMeters: 1000,
    legs: [],
  } as unknown;

  function renderPlanner() {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>
        <I18nProvider>{children}</I18nProvider>
      </QueryClientProvider>
    );
    return renderHook(() => useRoutePlanner(), { wrapper });
  }

  beforeEach(() => {
    sessionStorage.clear();
    apiState.plan = {
      mutate: (_vars: unknown, cbs: PlanCallbacks) => cbs.onSuccess(PLAN),
      isPending: false,
    };
  });

  afterEach(() => {
    apiState.plan = { mutate: () => {}, isPending: false };
    authState.value = { isSignedIn: false, userId: undefined };
    sessionStorage.clear();
    cleanup();
  });

  it("persists the in-progress route and restores it on a fresh mount", () => {
    authState.value = { isSignedIn: true, userId: "user_a" };

    const first = renderPlanner();
    act(() => {
      first.result.current.handleNodeClick(NODE_A);
    });
    act(() => {
      first.result.current.handleNodeClick(NODE_B);
    });
    expect(first.result.current.selectedNodes).toHaveLength(2);
    expect(first.result.current.routePlan).toBe(PLAN);

    // Simulate the forced sign-in redirect unmounting Home, then remounting
    // after re-auth as the same user.
    first.unmount();
    const second = renderPlanner();

    expect(second.result.current.selectedNodes.map((n) => n.id)).toEqual([
      NODE_A.id,
      NODE_B.id,
    ]);
    expect(second.result.current.routePlan).toEqual(PLAN);
  });

  it("does not restore one user's route for a different signed-in user", () => {
    authState.value = { isSignedIn: true, userId: "user_a" };
    const first = renderPlanner();
    act(() => {
      first.result.current.handleNodeClick(NODE_A);
    });
    act(() => {
      first.result.current.handleNodeClick(NODE_B);
    });
    first.unmount();

    authState.value = { isSignedIn: true, userId: "user_b" };
    const second = renderPlanner();
    expect(second.result.current.selectedNodes).toHaveLength(0);
    expect(second.result.current.routePlan).toBeNull();
  });

  it("clears the persisted draft when the route is cleared", () => {
    authState.value = { isSignedIn: true, userId: "user_a" };
    const first = renderPlanner();
    act(() => {
      first.result.current.handleNodeClick(NODE_A);
    });
    act(() => {
      first.result.current.handleNodeClick(NODE_B);
    });
    act(() => {
      first.result.current.handleClear();
    });
    first.unmount();

    const second = renderPlanner();
    expect(second.result.current.selectedNodes).toHaveLength(0);
    expect(second.result.current.routePlan).toBeNull();
  });

  it("does not persist for signed-out visitors", () => {
    authState.value = { isSignedIn: false, userId: undefined };
    const { result } = renderPlanner();
    act(() => {
      result.current.handleNodeClick(NODE_A);
    });
    act(() => {
      result.current.handleNodeClick(NODE_B);
    });
    expect(sessionStorage.length).toBe(0);
  });
});
