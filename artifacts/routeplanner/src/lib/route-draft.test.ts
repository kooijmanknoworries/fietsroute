import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { NetworkNode, RoutePlan } from "@workspace/api-client-react";
import {
  clearRouteDraft,
  getRouteDraft,
  setRouteDraft,
  type RouteDraft,
} from "./route-draft";

const USER_A = "user_aaa";
const USER_B = "user_bbb";

const NODES: NetworkNode[] = [
  { id: "n1", ref: "63", lat: 52.0, lon: 5.0 },
  { id: "n2", ref: "08", lat: 52.01, lon: 5.01 },
];

const PLAN: RoutePlan = {
  nodeRefs: ["63", "08"],
  coordinates: [
    [5.0, 52.0],
    [5.01, 52.01],
  ],
  distanceMeters: 1234,
  legs: [],
};

const DRAFT: RouteDraft = { selectedNodes: NODES, routePlan: PLAN };

describe("route-draft persistence", () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  afterEach(() => {
    sessionStorage.clear();
  });

  it("returns null when no draft has been saved", () => {
    expect(getRouteDraft(USER_A)).toBeNull();
  });

  it("persists a draft so it survives a forced sign-in redirect", () => {
    setRouteDraft(USER_A, DRAFT);
    const restored = getRouteDraft(USER_A);
    expect(restored).toEqual(DRAFT);
  });

  it("scopes drafts per user so they don't leak between accounts", () => {
    setRouteDraft(USER_A, DRAFT);
    expect(getRouteDraft(USER_B)).toBeNull();
  });

  it("clears the slot when an empty draft is saved (cleared route)", () => {
    setRouteDraft(USER_A, DRAFT);
    setRouteDraft(USER_A, { selectedNodes: [], routePlan: null });
    expect(getRouteDraft(USER_A)).toBeNull();
  });

  it("clears a saved draft explicitly", () => {
    setRouteDraft(USER_A, DRAFT);
    clearRouteDraft(USER_A);
    expect(getRouteDraft(USER_A)).toBeNull();
  });

  it("returns null for corrupt stored data", () => {
    sessionStorage.setItem("fietsrouteplanner.routeDraft." + USER_A, "nope");
    expect(getRouteDraft(USER_A)).toBeNull();
  });

  it("returns null for a structurally invalid stored value", () => {
    sessionStorage.setItem(
      "fietsrouteplanner.routeDraft." + USER_A,
      JSON.stringify({ selectedNodes: [{ id: "x" }], routePlan: null }),
    );
    expect(getRouteDraft(USER_A)).toBeNull();
  });

  it("accepts a draft with selected nodes but no computed plan yet", () => {
    const partial: RouteDraft = { selectedNodes: [NODES[0]], routePlan: null };
    setRouteDraft(USER_A, partial);
    expect(getRouteDraft(USER_A)).toEqual(partial);
  });
});
