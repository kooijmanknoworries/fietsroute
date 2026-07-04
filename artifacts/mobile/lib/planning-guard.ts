// Pure decision helpers for route-planning interactions on the map.
//
// While a ride is active the map is fullscreen and a stray tap on a knooppunt
// marker would add a node, re-plan the route, and — because the ride ends on
// any route change (see hooks/useRide.ts [routePlan] effect) — silently abort
// the ride. Centralising the "is a planning tap allowed right now?" decision
// here keeps that guard testable without rendering the native MapView.

export interface PlanningTapContext {
  /** Whether a ride is currently in progress. */
  isRiding: boolean;
}

/**
 * Whether a knooppunt tap should be treated as a planning action (adding the
 * node to the route). Returns false while riding so an accidental marker tap
 * can never mutate the route and abort the active ride.
 */
export function isPlanningTapAllowed(ctx: PlanningTapContext): boolean {
  return !ctx.isRiding;
}

/**
 * Whether the clickable knooppunt markers should be rendered. Mirrors
 * {@link isPlanningTapAllowed}: hidden while riding so there is nothing to tap.
 */
export function shouldRenderPlanningMarkers(ctx: PlanningTapContext): boolean {
  return !ctx.isRiding;
}
