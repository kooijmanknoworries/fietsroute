import { describe, it, expect } from "vitest";
import {
  bearing,
  turnAngle,
  classifyTurn,
  buildManeuvers,
  spokenDistance,
  phraseFor,
  type Maneuver,
} from "./voice-instructions";
import type { RouteLegInput } from "./ride-geo";

// A degree of longitude near the equator is large; use a helper that builds
// coordinates from an origin with small metre-scale offsets so geometry tests
// read clearly. At lat ~52 (NL), 1e-4 deg lon ~= 6.8m, 1e-4 deg lat ~= 11.1m.
const NL_LAT = 52.0;

describe("bearing", () => {
  it("points north, east, south, west", () => {
    expect(bearing([5, NL_LAT], [5, NL_LAT + 0.01])).toBeCloseTo(0, 0);
    expect(bearing([5, NL_LAT], [5.01, NL_LAT])).toBeCloseTo(90, 0);
    expect(bearing([5, NL_LAT], [5, NL_LAT - 0.01])).toBeCloseTo(180, 0);
    expect(bearing([5, NL_LAT], [4.99, NL_LAT])).toBeCloseTo(270, 0);
  });
});

describe("turnAngle", () => {
  it("is positive for a right turn and negative for a left turn", () => {
    expect(turnAngle(0, 90)).toBe(90); // north -> east = right
    expect(turnAngle(0, 270)).toBe(-90); // north -> west = left
    expect(turnAngle(350, 10)).toBe(20); // wrap-around, slight right
    expect(turnAngle(10, 350)).toBe(-20); // wrap-around, slight left
  });

  it("treats a U-turn as +180", () => {
    expect(turnAngle(0, 180)).toBe(180);
  });
});

describe("classifyTurn", () => {
  it("classifies by magnitude and sign", () => {
    expect(classifyTurn(0)).toBe("straight");
    expect(classifyTurn(15)).toBe("straight");
    expect(classifyTurn(30)).toBe("slight-right");
    expect(classifyTurn(-30)).toBe("slight-left");
    expect(classifyTurn(90)).toBe("right");
    expect(classifyTurn(-90)).toBe("left");
    expect(classifyTurn(150)).toBe("sharp-right");
    expect(classifyTurn(-150)).toBe("sharp-left");
  });
});

// Build a leg whose polyline goes straight north then turns. Offsets are in
// approximate degrees chosen to exceed the MIN_SEGMENT_M (12 m) gate.
function leg(coords: [number, number][]): RouteLegInput {
  return { fromRef: "1", toRef: "2", coordinates: coords };
}

describe("buildManeuvers", () => {
  it("returns nothing for an empty route", () => {
    expect(buildManeuvers([], [])).toEqual([]);
  });

  it("always starts with a start maneuver naming the first knooppunt", () => {
    const m = buildManeuvers(
      [leg([[5, NL_LAT], [5, NL_LAT + 0.01]])],
      ["71", "72"],
    );
    expect(m[0].type).toBe("start");
    expect(m[0].distanceAlong).toBe(0);
    expect(m[0].text).toContain("knooppunt 71");
  });

  it("emits a left turn maneuver at an interior vertex", () => {
    // North for ~111 m, then west for ~68 m => a left turn at the vertex.
    const m = buildManeuvers(
      [
        leg([
          [5, NL_LAT],
          [5, NL_LAT + 0.001],
          [5 - 0.001, NL_LAT + 0.001],
        ]),
      ],
      ["1", "2"],
    );
    const turn = m.find((x) => x.type === "turn");
    expect(turn).toBeDefined();
    expect(turn!.direction).toBe("left");
    expect(turn!.text).toBe("Sla linksaf.");
    // The turn happens after the first (~111 m) segment.
    expect(turn!.distanceAlong).toBeGreaterThan(100);
    expect(turn!.distanceAlong).toBeLessThan(125);
  });

  it("ignores micro jitter below the straight threshold", () => {
    // A nearly-straight three-point line -> no turn.
    const m = buildManeuvers(
      [
        leg([
          [5, NL_LAT],
          [5, NL_LAT + 0.001],
          [5 + 0.00001, NL_LAT + 0.002],
        ]),
      ],
      ["1", "2"],
    );
    expect(m.some((x) => x.type === "turn")).toBe(false);
  });

  it("announces intermediate knooppunten and a final arrival", () => {
    const m = buildManeuvers(
      [
        leg([[5, NL_LAT], [5, NL_LAT + 0.01]]),
        leg([[5, NL_LAT + 0.01], [5, NL_LAT + 0.02]]),
      ],
      ["10", "20", "30"],
    );
    const node = m.find((x) => x.type === "node");
    expect(node?.nodeRef).toBe("20");
    expect(node?.text).toContain("knooppunt 20");

    const arrive = m.find((x) => x.type === "arrive");
    expect(arrive?.nodeRef).toBe("30");
    expect(arrive?.text).toContain("bestemming");
    // Arrival is the last maneuver, at the full route distance.
    expect(m[m.length - 1]).toBe(arrive);
    expect(arrive!.distanceAlong).toBeGreaterThan(2000);
  });

  it("keeps maneuvers ordered by distance", () => {
    const m = buildManeuvers(
      [
        leg([
          [5, NL_LAT],
          [5, NL_LAT + 0.001],
          [5 - 0.001, NL_LAT + 0.001],
        ]),
        leg([[5 - 0.001, NL_LAT + 0.001], [5 - 0.001, NL_LAT + 0.01]]),
      ],
      ["1", "2", "3"],
    );
    const distances = m.map((x) => x.distanceAlong);
    const sorted = [...distances].sort((a, b) => a - b);
    expect(distances).toEqual(sorted);
  });
});

describe("spokenDistance", () => {
  it("rounds metres to natural values", () => {
    expect(spokenDistance(12)).toBe("10 meter");
    expect(spokenDistance(47)).toBe("50 meter");
    expect(spokenDistance(140)).toBe("150 meter");
    expect(spokenDistance(175)).toBe("200 meter");
  });

  it("switches to kilometres above 1000 m", () => {
    expect(spokenDistance(1500)).toBe("1,5 kilometer");
    expect(spokenDistance(12000)).toBe("12 kilometer");
  });
});

describe("phraseFor", () => {
  const turn: Maneuver = {
    distanceAlong: 500,
    type: "turn",
    direction: "left",
    text: "Sla linksaf.",
  };
  const node: Maneuver = {
    distanceAlong: 800,
    type: "node",
    direction: "straight",
    nodeRef: "42",
    text: "Je nadert knooppunt 42.",
  };
  const arrive: Maneuver = {
    distanceAlong: 900,
    type: "arrive",
    direction: "straight",
    nodeRef: "42",
    text: "Je hebt knooppunt 42 bereikt. Je bent op je bestemming.",
  };

  it("prefixes the lead distance on approach", () => {
    expect(phraseFor(turn, "approach")).toBe("Over 150 meter sla linksaf.");
    expect(phraseFor(node, "approach")).toBe(
      "Over 150 meter bereik je knooppunt 42.",
    );
  });

  it("is terse at the immediate phase", () => {
    expect(phraseFor(turn, "immediate")).toBe("Sla linksaf.");
  });

  it("always speaks arrival text regardless of phase", () => {
    expect(phraseFor(arrive, "approach")).toBe(arrive.text);
    expect(phraseFor(arrive, "immediate")).toBe(arrive.text);
  });
});
