import { afterEach, describe, expect, it } from "vitest";
import {
  MAX_PREFETCH_SPAN_DEG,
  neighbourBboxes,
  splitNeighboursByDirection,
  isSlowConnection,
  type Neighbour,
} from "./use-route-planner";

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
