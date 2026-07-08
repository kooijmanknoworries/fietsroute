import { describe, expect, it } from "vitest";
import {
  createVoiceGuide,
  phraseFor,
  voiceNodesFromLegs,
  NODE_ANNOUNCE_M,
  OFF_ROUTE_FIX_COUNT,
  BACK_ON_ROUTE_FIX_COUNT,
  type VoiceEvent,
  type VoiceNode,
} from "./ride-voice";

// Route: node 34 at 0 m, node 35 at 1000 m, node 36 at 2500 m.
const NODES: VoiceNode[] = [
  { ref: "34", distanceAlong: 0 },
  { ref: "35", distanceAlong: 1000 },
  { ref: "36", distanceAlong: 2500 },
];

function nodeEvents(events: VoiceEvent[]) {
  return events.filter((e) => e.type === "node");
}

describe("createVoiceGuide", () => {
  it("announces the start node on the first fix and each node once when approached", () => {
    const guide = createVoiceGuide(NODES);

    // First fix at the start: node 34 is within range.
    let events = guide.update(0, false);
    expect(events).toEqual([{ type: "node", nodeRef: "34", nextRef: "35" }]);

    // Riding along, still far from node 35: silence.
    expect(guide.update(500, false)).toEqual([]);
    expect(guide.update(900, false)).toEqual([]);

    // Within announce range of node 35.
    events = guide.update(1000 - NODE_ANNOUNCE_M + 1, false);
    expect(events).toEqual([{ type: "node", nodeRef: "35", nextRef: "36" }]);

    // Passing node 35 again never re-announces it.
    expect(guide.update(1005, false)).toEqual([]);

    // Final node: destination phrasing (nextRef null).
    events = guide.update(2450, false);
    expect(events).toEqual([{ type: "node", nodeRef: "36", nextRef: null }]);
    expect(guide.update(2600, false)).toEqual([]);
  });

  it("catches up when sparse fixes skip past a node between updates", () => {
    const guide = createVoiceGuide(NODES);
    guide.update(0, false);

    // One fix jumps from 500 m to 2450 m: both remaining nodes announce, in order.
    const events = nodeEvents(guide.update(2450, false));
    expect(events.map((e) => e.nodeRef)).toEqual(["35", "36"]);
  });

  it("skips nodes already behind the rider when starting mid-route", () => {
    const guide = createVoiceGuide(NODES);

    // First fix at 1200 m: nodes 34 and 35 are behind, stay silent about them.
    const events = guide.update(1200, false);
    expect(events).toEqual([]);

    // Node 36 still announces normally.
    const later = guide.update(2460, false);
    expect(later).toEqual([{ type: "node", nodeRef: "36", nextRef: null }]);
  });

  it("warns once after consecutive off-route fixes and confirms the return", () => {
    const guide = createVoiceGuide(NODES);
    guide.update(0, false);

    // A single stray fix is jitter: no warning.
    expect(guide.update(100, true)).toEqual([]);
    expect(guide.update(150, false)).toEqual([]);

    // Sustained off-route: warn exactly once.
    const all: VoiceEvent[] = [];
    for (let i = 0; i < OFF_ROUTE_FIX_COUNT + 2; i++) {
      all.push(...guide.update(150, true));
    }
    expect(all).toEqual([{ type: "off-route" }]);

    // Back on route: confirm once after the streak threshold.
    const back: VoiceEvent[] = [];
    for (let i = 0; i < BACK_ON_ROUTE_FIX_COUNT; i++) {
      back.push(...guide.update(160, false));
    }
    expect(back).toEqual([{ type: "back-on-route" }]);

    // No repeated confirmation.
    expect(guide.update(170, false)).toEqual([]);
  });

  it("does not advance node announcements while off route", () => {
    const guide = createVoiceGuide(NODES);
    guide.update(0, false);

    for (let i = 0; i < OFF_ROUTE_FIX_COUNT; i++) guide.update(950, true);

    // Returning on-route near node 35 announces it then.
    const events = guide.update(960, false);
    expect(nodeEvents(events).map((e) => e.nodeRef)).toEqual(["35"]);
  });
});

describe("phraseFor", () => {
  it("phrases prompts in Dutch", () => {
    expect(phraseFor({ type: "node", nodeRef: "34", nextRef: "35" })).toBe(
      "Bij knooppunt 34, ga verder naar knooppunt 35",
    );
    expect(phraseFor({ type: "node", nodeRef: "36", nextRef: null })).toBe(
      "Bij knooppunt 36. Je hebt je bestemming bereikt",
    );
    expect(phraseFor({ type: "off-route" })).toContain("van de route af");
    expect(phraseFor({ type: "back-on-route" })).toBe(
      "Je bent weer op de route",
    );
  });
});

describe("voiceNodesFromLegs", () => {
  it("builds cumulative node distances from legs", () => {
    const legs = [
      { fromRef: "34", toRef: "35", coordinates: [[0], [1]] },
      { fromRef: "35", toRef: "36", coordinates: [[1], [2]] },
    ];
    const lengths = new Map<number[][], number>([
      [legs[0].coordinates, 1000],
      [legs[1].coordinates, 1500],
    ]);
    const nodes = voiceNodesFromLegs(legs, (c) => lengths.get(c) ?? 0);
    expect(nodes).toEqual([
      { ref: "34", distanceAlong: 0 },
      { ref: "35", distanceAlong: 1000 },
      { ref: "36", distanceAlong: 2500 },
    ]);
  });

  it("returns empty for no legs", () => {
    expect(voiceNodesFromLegs([], () => 0)).toEqual([]);
  });
});
