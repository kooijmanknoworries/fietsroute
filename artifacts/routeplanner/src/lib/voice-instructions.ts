// Derives Dutch turn-by-turn voice instructions from a planned route.
//
// The route API returns geometry (a polyline) and legs between knooppunten,
// but no navigation instructions. We reconstruct maneuvers purely from the
// geometry: bearing changes between consecutive polyline segments become
// turns, and the end of each leg becomes a knooppunt announcement. All phrasing
// is Dutch, matching the app's cycling-in-NL/BE audience.

import { haversine, polylineLength, type LngLat } from "./ride-geo";
import type { RouteLegInput, RouteNodeInput } from "./ride-geo";

/** Initial bearing from `a` to `b` in degrees (0 = north, clockwise). */
export function bearing(a: LngLat, b: LngLat): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const toDeg = (r: number) => (r * 180) / Math.PI;
  const lat1 = toRad(a[1]);
  const lat2 = toRad(b[1]);
  const dLon = toRad(b[0] - a[0]);
  const y = Math.sin(dLon) * Math.cos(lat2);
  const x =
    Math.cos(lat1) * Math.sin(lat2) -
    Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

/**
 * Signed turn angle (degrees) going from heading `from` to heading `to`.
 * Positive = right turn, negative = left turn, range (-180, 180].
 */
export function turnAngle(from: number, to: number): number {
  let diff = ((to - from + 540) % 360) - 180;
  // Normalise -180 to +180 so a U-turn reads as a right turn deterministically.
  if (diff === -180) diff = 180;
  return diff;
}

export type Direction =
  | "left"
  | "right"
  | "slight-left"
  | "slight-right"
  | "sharp-left"
  | "sharp-right"
  | "straight";

// Angle thresholds (degrees) for classifying a bearing change into a turn.
// Below SLIGHT the road is effectively straight (ignored). Cycle node-network
// geometry is noisy, so the "straight" band is generous to avoid chatter.
const SLIGHT = 20;
const TURN = 45;
const SHARP = 115;

export function classifyTurn(angle: number): Direction {
  const mag = Math.abs(angle);
  if (mag < SLIGHT) return "straight";
  const right = angle > 0;
  if (mag >= SHARP) return right ? "sharp-right" : "sharp-left";
  if (mag >= TURN) return right ? "right" : "left";
  return right ? "slight-right" : "slight-left";
}

const DIRECTION_NL: Record<Exclude<Direction, "straight">, string> = {
  left: "sla linksaf",
  right: "sla rechtsaf",
  "slight-left": "houd links aan",
  "slight-right": "houd rechts aan",
  "sharp-left": "sla scherp linksaf",
  "sharp-right": "sla scherp rechtsaf",
};

export type ManeuverType = "start" | "turn" | "node" | "arrive";

export interface Maneuver {
  /** Distance (metres) from the route start at which the maneuver occurs. */
  distanceAlong: number;
  type: ManeuverType;
  /** Turn direction, when the maneuver involves a heading change. */
  direction: Direction;
  /** Knooppunt number this maneuver is tied to, when applicable. */
  nodeRef?: string;
  /** Ready-to-speak Dutch sentence for arriving at the maneuver. */
  text: string;
}

// A turn is only emitted when the polyline vertices immediately before and
// after it are at least this far apart, so GPS/geometry micro-jitter between
// near-coincident vertices can't manufacture phantom turns.
const MIN_SEGMENT_M = 12;

/** Capitalise the first letter of a spoken sentence. */
function sentence(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * Build the ordered list of maneuvers for a route. Turns are derived from
 * bearing changes along each leg's polyline; a knooppunt announcement is added
 * at the end of every leg, and an arrival maneuver closes the route.
 *
 * `nodeRefs` are the knooppunt numbers in route order (length = legs + 1).
 */
export function buildManeuvers(
  legs: RouteLegInput[],
  nodeRefs: string[],
): Maneuver[] {
  const maneuvers: Maneuver[] = [];
  if (legs.length === 0) return maneuvers;

  const firstRef = nodeRefs[0];
  maneuvers.push({
    distanceAlong: 0,
    type: "start",
    direction: "straight",
    nodeRef: firstRef,
    text: firstRef
      ? `Start bij knooppunt ${firstRef}. Volg de route.`
      : "Start. Volg de route.",
  });

  let cumulative = 0;

  for (let legIndex = 0; legIndex < legs.length; legIndex++) {
    const coords = legs[legIndex].coordinates as LngLat[];
    const legStart = cumulative;

    // Emit turns at interior vertices of this leg.
    let vertexDistance = legStart;
    for (let i = 1; i < coords.length - 1; i++) {
      const prev = coords[i - 1];
      const here = coords[i];
      const next = coords[i + 1];
      const inLen = haversine(prev, here);
      const outLen = haversine(here, next);
      vertexDistance += inLen;
      if (inLen < MIN_SEGMENT_M || outLen < MIN_SEGMENT_M) continue;
      const dir = classifyTurn(turnAngle(bearing(prev, here), bearing(here, next)));
      if (dir === "straight") continue;
      maneuvers.push({
        distanceAlong: vertexDistance,
        type: "turn",
        direction: dir,
        text: sentence(`${DIRECTION_NL[dir]}.`),
      });
    }

    cumulative += polylineLength(coords);

    // Knooppunt announcement at the end of the leg. The final leg ends at the
    // destination, handled as an arrival below instead.
    const endRef = nodeRefs[legIndex + 1];
    const isLast = legIndex === legs.length - 1;
    if (isLast) {
      maneuvers.push({
        distanceAlong: cumulative,
        type: "arrive",
        direction: "straight",
        nodeRef: endRef,
        text: endRef
          ? `Je hebt knooppunt ${endRef} bereikt. Je bent op je bestemming.`
          : "Je bent op je bestemming.",
      });
    } else {
      maneuvers.push({
        distanceAlong: cumulative,
        type: "node",
        direction: "straight",
        nodeRef: endRef,
        text: endRef
          ? `Je nadert knooppunt ${endRef}.`
          : "Je nadert het volgende knooppunt.",
      });
    }
  }

  return maneuvers;
}

/** Round a distance to a natural spoken value ("honderd meter", "1 kilometer"). */
export function spokenDistance(meters: number): string {
  if (meters >= 1000) {
    const km = meters / 1000;
    const rounded = km >= 10 ? Math.round(km) : Math.round(km * 10) / 10;
    const text = rounded.toLocaleString("nl-NL");
    return `${text} kilometer`;
  }
  let rounded: number;
  if (meters >= 100) rounded = Math.round(meters / 50) * 50;
  else if (meters >= 30) rounded = Math.round(meters / 10) * 10;
  else rounded = Math.round(meters / 5) * 5;
  return `${rounded} meter`;
}

// Announce an upcoming maneuver this far ahead ("over 150 meter ..."), then
// again right at it. Tuned for cycling speeds on the node network.
export const APPROACH_LEAD_M = 150;
export const IMMEDIATE_LEAD_M = 25;

/**
 * The spoken sentence for a maneuver at a given remaining distance. The
 * "approach" phase prefixes the distance; the "immediate" phase is terse.
 * Start and arrival maneuvers ignore the phase and always speak their text.
 */
export function phraseFor(
  maneuver: Maneuver,
  phase: "approach" | "immediate",
): string {
  if (maneuver.type === "start" || maneuver.type === "arrive") {
    return maneuver.text;
  }
  if (phase === "immediate") return maneuver.text;

  const dist = spokenDistance(APPROACH_LEAD_M);
  if (maneuver.type === "node") {
    return maneuver.nodeRef
      ? `Over ${dist} bereik je knooppunt ${maneuver.nodeRef}.`
      : `Over ${dist} bereik je het volgende knooppunt.`;
  }
  // A turn: "Over 150 meter sla linksaf."
  const body = maneuver.text.replace(/\.$/, "").toLowerCase();
  return `Over ${dist} ${body}.`;
}
