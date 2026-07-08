import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { act, cleanup, renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useRide } from "./use-ride";

// Backing store for the mocked visited-segments query so tests can seed the
// lifetime history that the end-of-ride summary compares against.
const apiState = vi.hoisted(() => ({
  history: { data: [] as Array<{ segmentKey: string; lon: number; lat: number }> },
  save: { mutate: vi.fn() },
}));

vi.mock("@workspace/api-client-react", () => ({
  useListVisitedSegments: () => apiState.history,
  useSaveVisitedSegments: () => apiState.save,
  getListVisitedSegmentsQueryKey: () => ["visited-segments"],
}));

// Capture the geolocation success callback so tests can drive GPS fixes.
let geoSuccess:
  | ((pos: {
      coords: { longitude: number; latitude: number; accuracy?: number };
    }) => void)
  | null = null;

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

// A straight two-leg route along the equator so distances are easy to reason
// about: node A → B → C, 0.1 degree of longitude (~11.1 km) apart.
const routePlan = {
  distanceMeters: 22_264,
  coordinates: [
    [0, 0],
    [0.1, 0],
    [0.2, 0],
  ],
  legs: [
    { fromRef: "1", toRef: "2", coordinates: [[0, 0], [0.1, 0]] },
    { fromRef: "2", toRef: "3", coordinates: [[0.1, 0], [0.2, 0]] },
  ],
} as never;

const selectedNodes = [
  { id: "n1" },
  { id: "n2" },
  { id: "n3" },
] as never;

function fix(lon: number, lat: number, accuracy = 5) {
  act(() => {
    geoSuccess?.({ coords: { longitude: lon, latitude: lat, accuracy } });
  });
}

// Advance the (fake) clock so the plausible-speed gate accepts the next fix.
function advanceClock(seconds: number) {
  vi.setSystemTime(new Date(Date.now() + seconds * 1000));
}

// Drive the whole route with plausible fixes: baseline at the start, then
// enough wall-clock time between fixes for the covered distance.
function driveToEnd() {
  fix(0, 0); // baseline: progress starts at zero here
  advanceClock(1800); // 30 min for ~11.1 km — a plausible cycling pace
  fix(0.1, 0);
  advanceClock(1800);
  fix(0.2, 0);
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-07-04T10:00:00Z"));
  apiState.history.data = [];
  apiState.save.mutate = vi.fn();
  geoSuccess = null;
  vi.stubGlobal("navigator", {
    geolocation: {
      watchPosition: (success: typeof geoSuccess) => {
        geoSuccess = success;
        return 1;
      },
      clearWatch: vi.fn(),
    },
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("useRide GPS gating", () => {
  it("ignores fixes with poor accuracy entirely", () => {
    const { result } = renderHook(
      () => useRide({ routePlan, selectedNodes, isSignedIn: false }),
      { wrapper },
    );

    act(() => result.current.startRide());
    fix(0, 0, 500); // coarse IP-style fix: rejected outright
    expect(result.current.ridePosition).toBeNull();
    expect(result.current.progressMeters).toBe(0);
  });

  it("starts progress at zero on the first accepted fix", () => {
    const { result } = renderHook(
      () => useRide({ routePlan, selectedNodes, isSignedIn: false }),
      { wrapper },
    );

    act(() => result.current.startRide());
    // First fix lands mid-route: no instant kilometres.
    fix(0.1, 0);
    expect(result.current.progressMeters).toBe(0);
    expect(result.current.ridePosition).not.toBeNull();
  });

  it("shows an off-route position without crediting distance", () => {
    const { result } = renderHook(
      () => useRide({ routePlan, selectedNodes, isSignedIn: false }),
      { wrapper },
    );

    act(() => result.current.startRide());
    fix(0, 0); // baseline on route
    advanceClock(60);
    fix(0.05, 0.01); // ~1.1 km north of the route: off-route
    expect(result.current.progressMeters).toBe(0);
    // The rider's raw position is still shown.
    expect(result.current.ridePosition?.[1]).toBeCloseTo(0.01, 5);
  });

  it("rejects an implausible teleport along the route", () => {
    const { result } = renderHook(
      () => useRide({ routePlan, selectedNodes, isSignedIn: false }),
      { wrapper },
    );

    act(() => result.current.startRide());
    fix(0, 0); // baseline
    advanceClock(10);
    fix(0.2, 0); // ~22 km in 10 s: impossible — no distance credited
    expect(result.current.progressMeters).toBe(0);
    expect(apiState.save.mutate).not.toHaveBeenCalled();
  });

  it("credits distance for plausible movement", () => {
    const { result } = renderHook(
      () => useRide({ routePlan, selectedNodes, isSignedIn: false }),
      { wrapper },
    );

    act(() => result.current.startRide());
    fix(0, 0);
    advanceClock(120);
    fix(0.01, 0); // ~1.1 km in 2 min ≈ 33 km/h: plausible
    expect(result.current.progressMeters).toBeGreaterThan(1000);
    expect(result.current.progressMeters).toBeLessThan(1300);
  });

  it("never decreases progress on a backwards fix", () => {
    const { result } = renderHook(
      () => useRide({ routePlan, selectedNodes, isSignedIn: false }),
      { wrapper },
    );

    act(() => result.current.startRide());
    fix(0, 0);
    advanceClock(120);
    fix(0.01, 0);
    const progress = result.current.progressMeters;
    advanceClock(60);
    fix(0.005, 0); // GPS wobbles backwards
    expect(result.current.progressMeters).toBe(progress);
  });
});

describe("useRide end-of-ride summary", () => {
  it("has no summary before a ride is stopped", () => {
    const { result } = renderHook(
      () => useRide({ routePlan, selectedNodes, isSignedIn: false }),
      { wrapper },
    );
    expect(result.current.rideSummary).toBeNull();
  });

  it("reports distance and new segments for a signed-out rider", () => {
    const { result } = renderHook(
      () => useRide({ routePlan, selectedNodes, isSignedIn: false }),
      { wrapper },
    );

    act(() => result.current.startRide());
    driveToEnd();
    act(() => result.current.stopRide());

    const summary = result.current.rideSummary;
    expect(summary).not.toBeNull();
    expect(summary?.newSegments).toBe(2);
    expect(summary?.distanceMeters).toBeGreaterThan(0);
  });

  it("excludes already-visited segments from the new count when signed in", () => {
    // Seed lifetime history with the first leg (nodes n1→n2) already ridden.
    apiState.history.data = [{ segmentKey: "n1__n2", lon: 0.05, lat: 0 }];

    const { result } = renderHook(
      () => useRide({ routePlan, selectedNodes, isSignedIn: true }),
      { wrapper },
    );

    act(() => result.current.startRide());
    driveToEnd();
    act(() => result.current.stopRide());

    const summary = result.current.rideSummary;
    // Only the second leg is newly unlocked; the first was already in history.
    expect(summary?.newSegments).toBe(1);
    // Lifetime total counts both legs, de-duplicated with history.
    expect(summary?.totalSegments).toBe(2);
  });

  it("counts new segments against pre-ride history, not the mid-ride refresh", () => {
    // Signed-in rider starting with no history. Segments completed during a ride
    // are persisted immediately and refetch the visited-segments query, so by
    // stop time `history` already contains this ride's own segments. The summary
    // must still count them as newly unlocked (diffed against the frozen start
    // baseline), not undercount to zero.
    apiState.history.data = [];

    const { result, rerender } = renderHook(
      () => useRide({ routePlan, selectedNodes, isSignedIn: true }),
      { wrapper },
    );

    act(() => result.current.startRide());
    driveToEnd(); // completes both legs, persisting them
    // Simulate the query refetch that follows a successful save mid-ride.
    apiState.history.data = [
      { segmentKey: "n1__n2", lon: 0.05, lat: 0 },
      { segmentKey: "n2__n3", lon: 0.15, lat: 0 },
    ];
    rerender();
    act(() => result.current.stopRide());

    const summary = result.current.rideSummary;
    expect(summary?.newSegments).toBe(2);
    expect(summary?.totalSegments).toBe(2);
  });

  it("reports elapsed time and average speed from wall-clock start-to-stop", () => {
    const { result } = renderHook(
      () => useRide({ routePlan, selectedNodes, isSignedIn: false }),
      { wrapper },
    );

    act(() => result.current.startRide());
    driveToEnd(); // advances the clock exactly 3600 s
    act(() => result.current.stopRide());

    const summary = result.current.rideSummary;
    expect(summary?.durationSeconds).toBeCloseTo(3600, 0);
    // ~22.3 km over 1 hour → ~22.3 km/h.
    const expectedKmh = summary!.distanceMeters / 1000 / 1;
    expect(summary?.avgSpeedKmh).toBeCloseTo(expectedKmh, 1);
  });

  it("leaves average speed null for an instant ride", () => {
    const { result } = renderHook(
      () => useRide({ routePlan, selectedNodes, isSignedIn: false }),
      { wrapper },
    );

    act(() => result.current.startRide());
    fix(0, 0);
    // Stop with no wall-clock time elapsed.
    act(() => result.current.stopRide());

    const summary = result.current.rideSummary;
    expect(summary?.durationSeconds).toBe(0);
    expect(summary?.avgSpeedKmh).toBeNull();
  });

  it("clears the summary when a new ride starts", () => {
    const { result } = renderHook(
      () => useRide({ routePlan, selectedNodes, isSignedIn: false }),
      { wrapper },
    );

    act(() => result.current.startRide());
    driveToEnd();
    act(() => result.current.stopRide());
    expect(result.current.rideSummary).not.toBeNull();

    act(() => result.current.startRide());
    expect(result.current.rideSummary).toBeNull();
  });

  it("dismisses the summary on request", () => {
    const { result } = renderHook(
      () => useRide({ routePlan, selectedNodes, isSignedIn: false }),
      { wrapper },
    );

    act(() => result.current.startRide());
    driveToEnd();
    act(() => result.current.stopRide());
    expect(result.current.rideSummary).not.toBeNull();

    act(() => result.current.dismissRideSummary());
    expect(result.current.rideSummary).toBeNull();
  });
});
