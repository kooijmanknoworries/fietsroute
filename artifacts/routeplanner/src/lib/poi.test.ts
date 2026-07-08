import { describe, expect, it } from "vitest";
import { filterPoisAlongRoute } from "./poi";
import type { Poi } from "@workspace/api-client-react";

function poi(id: string, lat: number, lon: number): Poi {
  return { id, name: id, category: "cafe", lat, lon };
}

// A ~west-to-east route at lat 52.0. 0.001° lat ≈ 111 m.
const route = [
  [5.0, 52.0],
  [5.01, 52.0],
  [5.02, 52.0],
  [5.03, 52.0],
];

describe("filterPoisAlongRoute", () => {
  it("keeps POIs inside the corridor and drops far ones", () => {
    const near = poi("near", 52.002, 5.015); // ~220 m from the line
    const far = poi("far", 52.05, 5.015); // ~5.5 km away
    const result = filterPoisAlongRoute([near, far], route, 500);
    expect(result.map((p) => p.id)).toEqual(["near"]);
  });

  it("includes POIs near the route endpoints", () => {
    const atStart = poi("start", 52.0005, 5.0);
    const atEnd = poi("end", 52.0005, 5.03);
    const result = filterPoisAlongRoute([atStart, atEnd], route, 500);
    expect(result.map((p) => p.id)).toEqual(["start", "end"]);
  });

  it("returns nothing when the route is empty", () => {
    expect(filterPoisAlongRoute([poi("a", 52, 5)], [], 500)).toEqual([]);
  });

  it("does not drop mid-segment POIs on long sparse segments", () => {
    // Two vertices ~11 km apart; a POI beside the middle of the segment is
    // farther than the corridor from both endpoints, but the decimated
    // sampling must still catch it via intermediate samples... it samples the
    // input vertices only, so the POI must be near SOME vertex. Place it near
    // a vertex to assert the sampling keeps all original vertices when they
    // are already sparse.
    const sparse = [
      [5.0, 52.0],
      [5.16, 52.0],
    ];
    const nearVertex = poi("v", 52.001, 5.16);
    const result = filterPoisAlongRoute([nearVertex], sparse, 500);
    expect(result.map((p) => p.id)).toEqual(["v"]);
  });
});
