import { describe, expect, it } from "vitest";
import {
  isPlanningTapAllowed,
  shouldRenderPlanningMarkers,
} from "./planning-guard";

describe("isPlanningTapAllowed", () => {
  it("allows planning taps while not riding", () => {
    expect(isPlanningTapAllowed({ isRiding: false })).toBe(true);
  });

  it("blocks planning taps while riding so an accidental tap can't abort the ride", () => {
    expect(isPlanningTapAllowed({ isRiding: true })).toBe(false);
  });
});

describe("shouldRenderPlanningMarkers", () => {
  it("renders clickable knooppunt markers while not riding", () => {
    expect(shouldRenderPlanningMarkers({ isRiding: false })).toBe(true);
  });

  it("hides clickable knooppunt markers while riding", () => {
    expect(shouldRenderPlanningMarkers({ isRiding: true })).toBe(false);
  });
});
