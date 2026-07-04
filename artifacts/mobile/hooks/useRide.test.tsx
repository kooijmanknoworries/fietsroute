import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";
import type { RenderHookResult } from "@testing-library/react";
import * as Location from "expo-location";
import { useRide, type RideState } from "./useRide";
import type { NetworkNode, RoutePlan } from "@/context/RoutePlannerContext";

// --- Mocks -----------------------------------------------------------------

const apiState = vi.hoisted(() => ({
  history: [] as Array<{ segmentKey: string; lon: number; lat: number }>,
  mutate: vi.fn(),
}));

vi.mock("@workspace/api-client-react", () => ({
  useSaveVisitedSegments: () => ({ mutate: apiState.mutate }),
  useListVisitedSegments: () => ({ data: apiState.history }),
  getListVisitedSegmentsQueryKey: () => ["listVisitedSegments"],
}));

vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));

// --- Fixtures --------------------------------------------------------------

const NODE_A: NetworkNode = { id: "1", ref: "63", lat: 52.0, lon: 5.0 };
const NODE_B: NetworkNode = { id: "2", ref: "08", lat: 52.01, lon: 5.01 };

function makePlan(): RoutePlan {
  return {
    nodeRefs: ["63", "08"],
    coordinates: [
      [5.0, 52.0],
      [5.01, 52.01],
    ],
    distanceMeters: 1300,
    legs: [
      {
        fromRef: "63",
        toRef: "08",
        distanceMeters: 1300,
        coordinates: [
          [5.0, 52.0],
          [5.01, 52.01],
        ],
      },
    ],
  };
}

// --- Helpers ---------------------------------------------------------------

type Result = RenderHookResult<RideState, unknown>["result"];

// Start the ride and let the async permission + watch chain settle so the
// expo-location watch subscription is registered before we drive fixes.
async function startRide(result: Result) {
  await act(async () => {
    result.current.startRide();
    await new Promise((r) => setTimeout(r, 30));
  });
}

// Grabs the callback passed to watchPositionAsync so tests can push GPS fixes.
function lastFixHandler() {
  const calls = vi.mocked(Location.watchPositionAsync).mock.calls;
  const handler = calls[calls.length - 1]?.[1];
  if (!handler) throw new Error("watchPositionAsync was not called");
  return handler as (pos: {
    coords: { latitude: number; longitude: number };
  }) => void;
}

async function pushFix(result: Result, lat: number, lon: number) {
  const handler = lastFixHandler();
  await act(async () => {
    handler({ coords: { latitude: lat, longitude: lon } });
    await Promise.resolve();
  });
  return result;
}

async function stopRide(result: Result) {
  await act(async () => {
    result.current.stopRide();
    await Promise.resolve();
  });
}

beforeEach(() => {
  apiState.history = [];
  apiState.mutate.mockReset();
  vi.mocked(Location.requestForegroundPermissionsAsync).mockResolvedValue({
    status: Location.PermissionStatus.GRANTED,
  } as never);
  vi.mocked(Location.watchPositionAsync).mockResolvedValue({
    remove: vi.fn(),
  } as never);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function mount(isSignedIn: boolean) {
  return renderHook(() =>
    useRide({
      routePlan: makePlan(),
      selectedNodes: [NODE_A, NODE_B],
      isSignedIn,
    }),
  );
}

describe("useRide", () => {
  it("cannot ride without a plan and two nodes", () => {
    const { result } = renderHook(() =>
      useRide({ routePlan: null, selectedNodes: [], isSignedIn: false }),
    );
    expect(result.current.canRide).toBe(false);
  });

  it("can ride with a plan and two selected nodes", () => {
    const { result } = mount(false);
    expect(result.current.canRide).toBe(true);
  });

  it("summarises distance and newly unlocked segments when signed in", async () => {
    const { result } = mount(true);

    await startRide(result);
    expect(result.current.gpsError).toBeNull();
    expect(Location.watchPositionAsync).toHaveBeenCalled();

    // A fix at the end node completes the single leg.
    await pushFix(result, 52.01, 5.01);
    expect(result.current.progressMeters).toBeGreaterThan(0);

    await stopRide(result);

    const summary = result.current.rideSummary;
    expect(summary).not.toBeNull();
    expect(summary!.isSignedIn).toBe(true);
    expect(summary!.newSegments).toBe(1);
    expect(summary!.totalSegments).toBe(1);
    expect(summary!.distanceMeters).toBeGreaterThan(0);
    // Signed-in rides persist completed segments to the server.
    expect(apiState.mutate).toHaveBeenCalled();
  });

  it("does not count already-visited segments as newly unlocked", async () => {
    apiState.history = [{ segmentKey: "1__2", lon: 5.005, lat: 52.005 }];

    const { result } = mount(true);
    await startRide(result);
    await pushFix(result, 52.01, 5.01);
    await stopRide(result);

    const summary = result.current.rideSummary;
    expect(summary!.newSegments).toBe(0);
    expect(summary!.totalSegments).toBe(1);
  });

  it("marks the summary as signed-out and skips persistence when not signed in", async () => {
    const { result } = mount(false);
    await startRide(result);
    await pushFix(result, 52.01, 5.01);
    await stopRide(result);

    expect(result.current.rideSummary!.isSignedIn).toBe(false);
    expect(apiState.mutate).not.toHaveBeenCalled();
  });

  it("reports a GPS error when permission is denied", async () => {
    vi.mocked(Location.requestForegroundPermissionsAsync).mockResolvedValue({
      status: Location.PermissionStatus.DENIED,
    } as never);

    const { result } = mount(false);
    await startRide(result);

    expect(result.current.gpsError).toBe("denied");
    expect(Location.watchPositionAsync).not.toHaveBeenCalled();
  });

  it("dismisses the summary", async () => {
    const { result } = mount(false);
    await startRide(result);
    await stopRide(result);
    expect(result.current.rideSummary).not.toBeNull();

    act(() => result.current.dismissRideSummary());
    expect(result.current.rideSummary).toBeNull();
  });
});
