// Pure event derivation for voice navigation during a ride. Given the planned
// route's node positions (as cumulative distances along the route) and a
// stream of snapped GPS fixes, this produces speech events exactly once per
// occurrence: approaching/passing a node, straying off route, and returning
// to the route. Keeping this pure makes it testable without GPS mocks.

// A node counts as "reached" once along-route progress is within this distance
// of it. Matches the leg-completion tolerance order of magnitude but slightly
// wider so the prompt fires as the rider approaches the knooppunt sign.
export const NODE_ANNOUNCE_M = 60;

// This many consecutive off-route fixes trigger the warning. A single stray
// fix is usually GPS jitter (tree cover, tunnels) and shouldn't nag the rider.
export const OFF_ROUTE_FIX_COUNT = 3;

// This many consecutive on-route fixes after a warning confirm the return.
export const BACK_ON_ROUTE_FIX_COUNT = 2;

export interface VoiceNode {
  /** Knooppunt number as shown on signs, e.g. "34". */
  ref: string;
  /** Cumulative distance (metres) along the planned route at this node. */
  distanceAlong: number;
}

export type VoiceEvent =
  | { type: "node"; nodeRef: string; nextRef: string | null }
  | { type: "off-route" }
  | { type: "back-on-route" };

export interface VoiceGuide {
  /**
   * Feed one accepted GPS fix. `distanceAlong` is the monotonic along-route
   * progress (metres); `offRoute` is whether this fix was beyond the
   * off-route threshold. Returns the events this fix triggered (usually none).
   */
  update(distanceAlong: number, offRoute: boolean): VoiceEvent[];
}

/**
 * Create a guide for one ride. `nodes` must be ordered along the route.
 * The starting node is announced only if the rider actually passes it; nodes
 * already behind the rider's first fix are skipped silently (starting
 * mid-route must not replay earlier prompts).
 */
export function createVoiceGuide(nodes: VoiceNode[]): VoiceGuide {
  let nextIndex = 0;
  let initialized = false;
  let offRouteStreak = 0;
  let onRouteStreak = 0;
  let warnedOffRoute = false;

  return {
    update(distanceAlong: number, offRoute: boolean): VoiceEvent[] {
      const events: VoiceEvent[] = [];

      // Skip nodes behind the very first fix — the rider started past them.
      if (!initialized) {
        initialized = true;
        while (
          nextIndex < nodes.length &&
          nodes[nextIndex].distanceAlong < distanceAlong - NODE_ANNOUNCE_M
        ) {
          nextIndex++;
        }
      }

      // Off-route / back-on-route state machine.
      if (offRoute) {
        onRouteStreak = 0;
        offRouteStreak++;
        if (!warnedOffRoute && offRouteStreak >= OFF_ROUTE_FIX_COUNT) {
          warnedOffRoute = true;
          events.push({ type: "off-route" });
        }
        // Off-route fixes never advance node announcements.
        return events;
      }

      offRouteStreak = 0;
      if (warnedOffRoute) {
        onRouteStreak++;
        if (onRouteStreak >= BACK_ON_ROUTE_FIX_COUNT) {
          warnedOffRoute = false;
          onRouteStreak = 0;
          events.push({ type: "back-on-route" });
        }
      }

      // Node announcements: fire each node at most once, in order, as the
      // rider comes within range (or passes it between sparse fixes).
      while (
        nextIndex < nodes.length &&
        distanceAlong >= nodes[nextIndex].distanceAlong - NODE_ANNOUNCE_M
      ) {
        const node = nodes[nextIndex];
        const next = nodes[nextIndex + 1] ?? null;
        events.push({
          type: "node",
          nodeRef: node.ref,
          nextRef: next ? next.ref : null,
        });
        nextIndex++;
      }

      return events;
    },
  };
}

/** Dutch phrasing for each voice event. */
export function phraseFor(event: VoiceEvent): string {
  switch (event.type) {
    case "node":
      return event.nextRef
        ? `Bij knooppunt ${event.nodeRef}, ga verder naar knooppunt ${event.nextRef}`
        : `Bij knooppunt ${event.nodeRef}. Je hebt je bestemming bereikt`;
    case "off-route":
      return "Let op: je bent van de route af. Keer terug naar de route";
    case "back-on-route":
      return "Je bent weer op de route";
  }
}

/**
 * Build the ordered node list (with cumulative distances) from the planned
 * legs. Node i sits at the start of leg i; the final node at the route end.
 */
export function voiceNodesFromLegs(
  legs: Array<{ fromRef: string; toRef: string; coordinates: number[][] }>,
  legLength: (coordinates: number[][]) => number,
): VoiceNode[] {
  const nodes: VoiceNode[] = [];
  let cumulative = 0;
  for (let i = 0; i < legs.length; i++) {
    nodes.push({ ref: legs[i].fromRef, distanceAlong: cumulative });
    cumulative += legLength(legs[i].coordinates);
  }
  if (legs.length > 0) {
    nodes.push({
      ref: legs[legs.length - 1].toRef,
      distanceAlong: cumulative,
    });
  }
  return nodes;
}
