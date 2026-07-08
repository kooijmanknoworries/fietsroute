import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";
import type { RenderHookResult } from "@testing-library/react";
import * as Location from "expo-location";
import * as Speech from "expo-speech";
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
    coords: { latitude: number; longitude: number; accuracy?: number };
  }) => void;
}

async function pushFix(result: Result, lat: number, lon: number) {
  const handler = lastFixHandler();
  await act(async () => {
    handler({ coords: { latitude: lat, longitude: lon, accuracy: 5 } });
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

// Controllable wall clock for the plausible-speed gate: real timers keep
// running (startRide awaits a real setTimeout), but Date.now is ours.
let nowMs = 0;
function advanceClock(seconds: number) {
  nowMs += seconds * 1000;
}

// Drive continuously from NODE_A towards NODE_B in ~65 m steps (t += 0.05)
// with 10 s between fixes (~6.5 m/s): plausible speed AND contiguous coverage.
async function driveLeg(result: Result, fromT: number, toT: number) {
  for (let t = fromT + 0.05; t <= toT + 1e-9; t += 0.05) {
    advanceClock(10);
    await pushFix(result, 52.0 + 0.01 * t, 5.0 + 0.01 * t);
  }
}

// Full ride: baseline at the start node, then contiguous fixes to the end.
async function driveToEnd(result: Result) {
  await pushFix(result, 52.0, 5.0);
  await driveLeg(result, 0, 1);
}

beforeEach(() => {
  apiState.history = [];
  apiState.mutate.mockReset();
  nowMs = 1_751_900_000_000;
  vi.spyOn(Date, "now").mockImplementation(() => nowMs);
  vi.mocked(Location.requestForegroundPermissionsAsync).mockResolvedValue({
    status: Location.PermissionStatus.GRANTED,
  } as never);
  vi.mocked(Location.watchPositionAsync).mockResolvedValue({
    remove: vi.fn(),
  } as never);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks(); // un-spy Date.now
  vi.clearAllMocks(); // clear module-mock call history
});

function mount(isSignedIn: boolean) {
  // The plan must be referentially stable across re-renders, like the real
  // context value: a new object per render would trip the hook's
  // plan-changed effect and end the ride mid-test.
  const plan = makePlan();
  return renderHook(() =>
    useRide({
      routePlan: plan,
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

    // Riding the leg continuously from start to end completes it.
    await driveToEnd(result);
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
    await driveToEnd(result);
    await stopRide(result);

    const summary = result.current.rideSummary;
    expect(summary!.newSegments).toBe(0);
    expect(summary!.totalSegments).toBe(1);
  });

  it("does not unlock a leg when the ride starts mid-leg", async () => {
    const { result } = mount(true);
    await startRide(result);

    // Baseline lands halfway along the leg; ride continuously to the end.
    await pushFix(result, 52.005, 5.005);
    await driveLeg(result, 0.5, 1);
    await stopRide(result);

    expect(result.current.rideSummary!.newSegments).toBe(0);
    expect(apiState.mutate).not.toHaveBeenCalled();
  });

  it("does not unlock a leg skipped by a speed-plausible snap-ahead", async () => {
    const { result } = mount(true);
    await startRide(result);

    // Baseline at the start, then a long pause and a fix near the end:
    // plausible speed-wise, but the stretch in between was never ridden.
    await pushFix(result, 52.0, 5.0);
    advanceClock(1800);
    await pushFix(result, 52.0095, 5.0095);
    await driveLeg(result, 0.95, 1);
    await stopRide(result);

    expect(result.current.rideSummary!.newSegments).toBe(0);
    expect(apiState.mutate).not.toHaveBeenCalled();
  });

  it("rejects an implausible teleport along the route", async () => {
    const { result } = mount(true);
    await startRide(result);

    await pushFix(result, 52.0, 5.0); // baseline
    advanceClock(5);
    await pushFix(result, 52.01, 5.01); // ~1.3 km in 5 s: impossible
    await stopRide(result);

    expect(result.current.rideSummary!.newSegments).toBe(0);
    expect(result.current.rideSummary!.distanceMeters).toBe(0);
    expect(apiState.mutate).not.toHaveBeenCalled();
  });

  it("marks the summary as signed-out and skips persistence when not signed in", async () => {
    const { result } = mount(false);
    await startRide(result);
    await driveToEnd(result);
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

  describe("voice prompts", () => {
    function spokenTexts(): string[] {
      return vi.mocked(Speech.speak).mock.calls.map((c) => String(c[0]));
    }

    it("speaks the start node prompt on the first on-route fix", async () => {
      const { result } = mount(false);
      await startRide(result);
      await pushFix(result, 52.0, 5.0);

      expect(spokenTexts()).toEqual([
        "Bij knooppunt 63, ga verder naar knooppunt 08",
      ]);
    });

    it("speaks the destination prompt when reaching the final node, once", async () => {
      const { result } = mount(false);
      await startRide(result);
      await driveToEnd(result);
      // Extra fix at the destination must not repeat the prompt.
      advanceClock(10);
      await pushFix(result, 52.01, 5.01);

      const texts = spokenTexts();
      expect(texts[texts.length - 1]).toBe(
        "Bij knooppunt 08. Je hebt je bestemming bereikt",
      );
      expect(
        texts.filter((t) => t.includes("bestemming")).length,
      ).toBe(1);
    });

    it("warns after sustained off-route fixes and confirms the return", async () => {
      const { result } = mount(false);
      await startRide(result);
      await pushFix(result, 52.0, 5.0);
      vi.mocked(Speech.speak).mockClear();

      // ~290 m from the planned line: off route. One stray fix is jitter.
      await pushFix(result, 52.0, 5.005);
      expect(spokenTexts()).toEqual([]);

      // Sustained: warn exactly once.
      await pushFix(result, 52.0, 5.005);
      await pushFix(result, 52.0, 5.005);
      await pushFix(result, 52.0, 5.005);
      expect(spokenTexts()).toEqual([
        "Let op: je bent van de route af. Keer terug naar de route",
      ]);

      // Two on-route fixes confirm the return.
      advanceClock(30);
      await pushFix(result, 52.0, 5.0);
      await pushFix(result, 52.0, 5.0);
      expect(spokenTexts()).toEqual([
        "Let op: je bent van de route af. Keer terug naar de route",
        "Je bent weer op de route",
      ]);
    });

    it("stays silent while muted and silences the current prompt", async () => {
      const { result } = mount(false);
      await startRide(result);

      expect(result.current.isMuted).toBe(false);
      act(() => result.current.toggleMute());
      expect(result.current.isMuted).toBe(true);
      expect(Speech.stop).toHaveBeenCalled();

      await pushFix(result, 52.0, 5.0);
      expect(Speech.speak).not.toHaveBeenCalled();

      // Unmuting resumes prompts for later events.
      act(() => result.current.toggleMute());
      advanceClock(240);
      await pushFix(result, 52.01, 5.01);
      expect(spokenTexts()).toEqual([
        "Bij knooppunt 08. Je hebt je bestemming bereikt",
      ]);
    });

    it("stops speaking when the ride stops", async () => {
      const { result } = mount(false);
      await startRide(result);
      await pushFix(result, 52.0, 5.0);
      vi.mocked(Speech.stop).mockClear();

      await stopRide(result);
      expect(Speech.stop).toHaveBeenCalled();
    });
  });
});
