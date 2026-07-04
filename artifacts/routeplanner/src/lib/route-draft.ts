import type { NetworkNode, RoutePlan } from "@workspace/api-client-react";

// In-progress route drafts are stored per signed-in user so one rider's work
// never leaks into another account. sessionStorage keeps the draft scoped to
// the current tab session — enough to survive a forced sign-in redirect (and
// even an OAuth round-trip) without turning into an eternal autosave.
const STORAGE_PREFIX = "fietsrouteplanner.routeDraft.";

export interface RouteDraft {
  selectedNodes: NetworkNode[];
  routePlan: RoutePlan | null;
}

function keyFor(userId: string): string {
  return `${STORAGE_PREFIX}${userId}`;
}

function isNetworkNode(value: unknown): value is NetworkNode {
  if (!value || typeof value !== "object") return false;
  const n = value as Record<string, unknown>;
  return (
    typeof n.id === "string" &&
    typeof n.ref === "string" &&
    typeof n.lat === "number" &&
    typeof n.lon === "number"
  );
}

function isRoutePlan(value: unknown): value is RoutePlan {
  if (!value || typeof value !== "object") return false;
  const p = value as Record<string, unknown>;
  return (
    Array.isArray(p.nodeRefs) &&
    Array.isArray(p.coordinates) &&
    typeof p.distanceMeters === "number" &&
    Array.isArray(p.legs)
  );
}

/**
 * Returns the saved in-progress route draft for the given user, or null if
 * none is stored or the stored value is invalid.
 */
export function getRouteDraft(userId: string): RouteDraft | null {
  try {
    const raw = sessionStorage.getItem(keyFor(userId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return null;
    const draft = parsed as Record<string, unknown>;
    if (!Array.isArray(draft.selectedNodes)) return null;
    if (!draft.selectedNodes.every(isNetworkNode)) return null;
    const routePlan = draft.routePlan;
    if (routePlan !== null && !isRoutePlan(routePlan)) return null;
    return {
      selectedNodes: draft.selectedNodes as NetworkNode[],
      routePlan: (routePlan ?? null) as RoutePlan | null,
    };
  } catch {
    return null;
  }
}

export function setRouteDraft(userId: string, draft: RouteDraft): void {
  try {
    // An empty draft carries nothing worth restoring — clear the slot instead
    // so a cleared route doesn't come back on the next mount.
    if (draft.selectedNodes.length === 0 && !draft.routePlan) {
      sessionStorage.removeItem(keyFor(userId));
      return;
    }
    sessionStorage.setItem(keyFor(userId), JSON.stringify(draft));
  } catch {
    // ignore persistence errors (e.g. storage disabled)
  }
}

export function clearRouteDraft(userId: string): void {
  try {
    sessionStorage.removeItem(keyFor(userId));
  } catch {
    // ignore
  }
}
