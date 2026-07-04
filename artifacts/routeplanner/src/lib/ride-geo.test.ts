import { describe, expect, it } from "vitest";
import {
  haversine,
  polylineLength,
  snapToRoute,
  sliceRoute,
  midpointOf,
  segmentKeyFor,
  legSegments,
  type LngLat,
} from "./ride-geo";

// A roughly east-west line near Utrecht. One degree of longitude here is ~68 km.
const ROUTE: LngLat[] = [
  [5.0, 52.0],
  [5.01, 52.0],
  [5.02, 52.0],
];

describe("haversine", () => {
  it("is zero for identical points", () => {
    expect(haversine([5, 52], [5, 52])).toBe(0);
  });

  it("measures ~111 km per degree of latitude", () => {
    const d = haversine([5, 52], [5, 53]);
    expect(d).toBeGreaterThan(111_000);
    expect(d).toBeLessThan(112_000);
  });
});

describe("polylineLength", () => {
  it("sums segment lengths", () => {
    const len = polylineLength(ROUTE);
    const manual =
      haversine(ROUTE[0], ROUTE[1]) + haversine(ROUTE[1], ROUTE[2]);
    expect(len).toBeCloseTo(manual, 6);
  });
});

describe("snapToRoute", () => {
  it("snaps a point beside the line onto it and reports the offset", () => {
    // A point just north of the midpoint of the first segment.
    const snap = snapToRoute(ROUTE, [5.005, 52.0009]);
    expect(snap).not.toBeNull();
    expect(snap!.distanceToRoute).toBeGreaterThan(50);
    expect(snap!.distanceToRoute).toBeLessThan(150);
    // ~half of the first segment along the route.
    expect(snap!.snapped[0]).toBeCloseTo(5.005, 3);
    expect(snap!.distanceAlong).toBeGreaterThan(0);
  });

  it("clamps to the start before the route begins", () => {
    const snap = snapToRoute(ROUTE, [4.9, 52.0]);
    expect(snap!.distanceAlong).toBe(0);
    expect(snap!.snapped).toEqual([5.0, 52.0]);
  });

  it("clamps to the end past the route", () => {
    const snap = snapToRoute(ROUTE, [5.1, 52.0]);
    expect(snap!.snapped[0]).toBeCloseTo(5.02, 6);
    expect(snap!.distanceAlong).toBeCloseTo(polylineLength(ROUTE), 3);
  });

  it("returns null for an empty route", () => {
    expect(snapToRoute([], [5, 52])).toBeNull();
  });
});

describe("sliceRoute", () => {
  it("returns only the start for zero distance", () => {
    const { traveled, remaining } = sliceRoute(ROUTE, 0);
    expect(traveled).toEqual([ROUTE[0]]);
    expect(remaining).toEqual(ROUTE);
  });

  it("splits at an interpolated midpoint", () => {
    const half = polylineLength(ROUTE) / 2;
    const { traveled, remaining } = sliceRoute(ROUTE, half);
    const split = traveled[traveled.length - 1];
    // The split point starts the remaining half, keeping the halves joined.
    expect(remaining[0]).toEqual(split);
    expect(polylineLength(traveled)).toBeCloseTo(half, 3);
  });

  it("returns the whole route when distance exceeds its length", () => {
    const { traveled, remaining } = sliceRoute(ROUTE, 1_000_000);
    expect(traveled).toEqual(ROUTE);
    expect(remaining).toEqual([ROUTE[ROUTE.length - 1]]);
  });
});

describe("midpointOf", () => {
  it("finds the centre of a straight line", () => {
    expect(midpointOf(ROUTE)[0]).toBeCloseTo(5.01, 4);
  });
});

describe("segmentKeyFor", () => {
  it("is order-independent", () => {
    expect(segmentKeyFor("200", "100")).toBe(segmentKeyFor("100", "200"));
    expect(segmentKeyFor("100", "200")).toBe("100__200");
  });
});

describe("legSegments", () => {
  it("keys each leg by its endpoint node ids and finds cumulative distance", () => {
    const legs = [
      { fromRef: "34", toRef: "35", coordinates: [ROUTE[0], ROUTE[1]] },
      { fromRef: "35", toRef: "36", coordinates: [ROUTE[1], ROUTE[2]] },
    ];
    const nodes = [
      { id: "n1", ref: "34" },
      { id: "n2", ref: "35" },
      { id: "n3", ref: "36" },
    ];
    const segs = legSegments(legs, nodes);
    expect(segs).toHaveLength(2);
    expect(segs[0].segmentKey).toBe(segmentKeyFor("n1", "n2"));
    expect(segs[1].segmentKey).toBe(segmentKeyFor("n2", "n3"));
    expect(segs[1].endDistance).toBeCloseTo(polylineLength(ROUTE), 3);
    expect(segs[0].endDistance).toBeLessThan(segs[1].endDistance);
  });

  it("falls back to refs when node ids are missing", () => {
    const legs = [{ fromRef: "34", toRef: "35", coordinates: [ROUTE[0], ROUTE[1]] }];
    const segs = legSegments(legs, []);
    expect(segs[0].segmentKey).toBe(segmentKeyFor("34", "35"));
  });
});
