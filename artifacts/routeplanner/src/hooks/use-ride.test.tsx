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
let geoSuccess: ((pos: { coords: { longitude: number; latitude: number } }) => void) | null =
  null;

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

// A straight two-leg route along the equator so distances are easy to reason
// about: node A → B → C, one degree of longitude apart.
const routePlan = {
  distanceMeters: 222_000,
  coordinates: [
    [0, 0],
    [1, 0],
    [2, 0],
  ],
  legs: [
    { fromRef: "1", toRef: "2", coordinates: [[0, 0], [1, 0]] },
    { fromRef: "2", toRef: "3", coordinates: [[1, 0], [2, 0]] },
  ],
} as never;

const selectedNodes = [
  { id: "n1" },
  { id: "n2" },
  { id: "n3" },
] as never;

function fix(lon: number, lat: number) {
  act(() => {
    geoSuccess?.({ coords: { longitude: lon, latitude: lat } });
  });
}

beforeEach(() => {
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
    // Drive to the end so both legs latch as completed.
    fix(2, 0);
    act(() => result.current.stopRide());

    const summary = result.current.rideSummary;
    expect(summary).not.toBeNull();
    expect(summary?.isSignedIn).toBe(false);
    expect(summary?.newSegments).toBe(2);
    expect(summary?.distanceMeters).toBeGreaterThan(0);
  });

  it("excludes already-visited segments from the new count when signed in", () => {
    // Seed lifetime history with the first leg (nodes n1→n2) already ridden.
    apiState.history.data = [{ segmentKey: "n1__n2", lon: 0.5, lat: 0 }];

    const { result } = renderHook(
      () => useRide({ routePlan, selectedNodes, isSignedIn: true }),
      { wrapper },
    );

    act(() => result.current.startRide());
    fix(2, 0);
    act(() => result.current.stopRide());

    const summary = result.current.rideSummary;
    expect(summary?.isSignedIn).toBe(true);
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
    fix(2, 0); // completes both legs, persisting them
    // Simulate the query refetch that follows a successful save mid-ride.
    apiState.history.data = [
      { segmentKey: "n1__n2", lon: 0.5, lat: 0 },
      { segmentKey: "n2__n3", lon: 1.5, lat: 0 },
    ];
    rerender();
    act(() => result.current.stopRide());

    const summary = result.current.rideSummary;
    expect(summary?.newSegments).toBe(2);
    expect(summary?.totalSegments).toBe(2);
  });

  it("reports elapsed time and average speed from wall-clock start-to-stop", () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-07-04T10:00:00Z"));

      const { result } = renderHook(
        () => useRide({ routePlan, selectedNodes, isSignedIn: false }),
        { wrapper },
      );

      act(() => result.current.startRide());
      fix(2, 0); // drive to the end so full distance is covered
      // One hour of wall-clock time passes before stopping.
      vi.setSystemTime(new Date("2026-07-04T11:00:00Z"));
      act(() => result.current.stopRide());

      const summary = result.current.rideSummary;
      expect(summary?.durationSeconds).toBeCloseTo(3600, 0);
      // ~222 km over 1 hour → ~222 km/h (route geometry, not realistic speed).
      const expectedKmh = (summary!.distanceMeters / 1000) / 1;
      expect(summary?.avgSpeedKmh).toBeCloseTo(expectedKmh, 1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("leaves average speed null for an instant ride", () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-07-04T10:00:00Z"));

      const { result } = renderHook(
        () => useRide({ routePlan, selectedNodes, isSignedIn: false }),
        { wrapper },
      );

      act(() => result.current.startRide());
      fix(2, 0);
      // Stop with no wall-clock time elapsed.
      act(() => result.current.stopRide());

      const summary = result.current.rideSummary;
      expect(summary?.durationSeconds).toBe(0);
      expect(summary?.avgSpeedKmh).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("clears the summary when a new ride starts", () => {
    const { result } = renderHook(
      () => useRide({ routePlan, selectedNodes, isSignedIn: false }),
      { wrapper },
    );

    act(() => result.current.startRide());
    fix(2, 0);
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
    fix(2, 0);
    act(() => result.current.stopRide());
    expect(result.current.rideSummary).not.toBeNull();

    act(() => result.current.dismissRideSummary());
    expect(result.current.rideSummary).toBeNull();
  });
});
