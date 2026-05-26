import { describe, it, expect } from "vitest";

import {
  defaultPlanTypeForProfileRole,
  isArtistPlan,
  isOperatorPlan,
  isPaidPlan,
  planAllows,
  type PlanType,
  type ProfilePlan,
} from "./plans";

function planOf(type: PlanType): ProfilePlan {
  return {
    profileId: "p1",
    type,
    source: "manual",
    status: "active",
    assignedAt: "2026-05-14T00:00:00.000Z",
    assignedBy: "admin",
    history: [],
  };
}

describe("plan classifiers", () => {
  it("flags only paid types as paid", () => {
    expect(isPaidPlan("operator_pro")).toBe(true);
    expect(isPaidPlan("artist_pro")).toBe(true);
    expect(isPaidPlan("free_operator")).toBe(false);
    expect(isPaidPlan("free_artist")).toBe(false);
  });

  it("classifies operator vs artist tracks correctly", () => {
    expect(isOperatorPlan("free_operator")).toBe(true);
    expect(isOperatorPlan("operator_pro")).toBe(true);
    expect(isArtistPlan("free_artist")).toBe(true);
    expect(isArtistPlan("artist_pro")).toBe(true);
    // Cross-track checks must fail — preserves the invariant that a profile
    // can't accidentally land on the wrong tier.
    expect(isOperatorPlan("free_artist")).toBe(false);
    expect(isArtistPlan("operator_pro")).toBe(false);
  });
});

describe("defaultPlanTypeForProfileRole", () => {
  it("maps performer/artist legacy roles to free_artist", () => {
    expect(defaultPlanTypeForProfileRole("performer")).toBe("free_artist");
    expect(defaultPlanTypeForProfileRole("artist")).toBe("free_artist");
    expect(defaultPlanTypeForProfileRole("Performer")).toBe("free_artist");
  });

  it("maps operator-shaped roles to free_operator", () => {
    expect(defaultPlanTypeForProfileRole("venue")).toBe("free_operator");
    expect(defaultPlanTypeForProfileRole("promoter")).toBe("free_operator");
    expect(defaultPlanTypeForProfileRole("organizer")).toBe("free_operator");
    expect(defaultPlanTypeForProfileRole("festival")).toBe("free_operator");
  });

  it("defaults missing/unknown roles to free_operator (safer than free_artist for the gate)", () => {
    expect(defaultPlanTypeForProfileRole(undefined)).toBe("free_operator");
    expect(defaultPlanTypeForProfileRole(null)).toBe("free_operator");
    expect(defaultPlanTypeForProfileRole("")).toBe("free_operator");
  });
});

describe("planAllows", () => {
  it("returns false for missing plans — locked, never accidentally open", () => {
    expect(planAllows(null, ["operator_pro"])).toBe(false);
    expect(planAllows(undefined, ["operator_pro"])).toBe(false);
  });

  it("matches when plan type is in the allowed set", () => {
    expect(planAllows(planOf("operator_pro"), ["operator_pro"])).toBe(true);
    expect(
      planAllows(planOf("operator_pro"), ["operator_pro", "artist_pro"]),
    ).toBe(true);
  });

  it("rejects when plan type is outside the allowed set", () => {
    expect(planAllows(planOf("free_operator"), ["operator_pro"])).toBe(false);
    expect(planAllows(planOf("free_artist"), ["artist_pro"])).toBe(false);
  });
});
