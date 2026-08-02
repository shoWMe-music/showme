import { describe, expect, it } from "vitest";
import { HttpError } from "./errors";
import {
  type RegionScope,
  applyCounter,
  assertDisjoint,
  regionsOverlap,
} from "./lib/representation-rules";

describe("regionsOverlap", () => {
  it("treats worldwide as overlapping any region", () => {
    const worldwide: RegionScope = { region: null, isWorldwide: true };
    expect(regionsOverlap(worldwide, { region: ["SE"], isWorldwide: false })).toBe(true);
    expect(regionsOverlap({ region: ["SE"], isWorldwide: false }, worldwide)).toBe(true);
    expect(regionsOverlap(worldwide, worldwide)).toBe(true);
  });

  it("overlaps when country lists intersect", () => {
    expect(
      regionsOverlap(
        { region: ["SE", "NO"], isWorldwide: false },
        { region: ["NO", "DK"], isWorldwide: false },
      ),
    ).toBe(true);
  });

  it("is disjoint when country lists do not intersect", () => {
    expect(
      regionsOverlap(
        { region: ["SE", "NO"], isWorldwide: false },
        { region: ["DK", "FI"], isWorldwide: false },
      ),
    ).toBe(false);
  });

  it("treats empty/null regions as covering nothing", () => {
    expect(
      regionsOverlap({ region: [], isWorldwide: false }, { region: [], isWorldwide: false }),
    ).toBe(false);
    expect(
      regionsOverlap({ region: null, isWorldwide: false }, { region: ["SE"], isWorldwide: false }),
    ).toBe(false);
  });
});

describe("assertDisjoint", () => {
  it("passes when the proposed region is disjoint from all active ones", () => {
    expect(() =>
      assertDisjoint([{ region: ["SE"], isWorldwide: false }], {
        region: ["DK"],
        isWorldwide: false,
      }),
    ).not.toThrow();
  });

  it("throws a 409 conflict on an overlapping active region", () => {
    try {
      assertDisjoint([{ region: ["SE", "NO"], isWorldwide: false }], {
        region: ["NO"],
        isWorldwide: false,
      });
      throw new Error("expected assertDisjoint to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(HttpError);
      expect((error as HttpError).statusCode).toBe(409);
    }
  });

  it("throws when either side is worldwide", () => {
    expect(() =>
      assertDisjoint([{ region: null, isWorldwide: true }], { region: ["SE"], isWorldwide: false }),
    ).toThrow();
    expect(() =>
      assertDisjoint([{ region: ["SE"], isWorldwide: false }], { region: null, isWorldwide: true }),
    ).toThrow();
  });

  it("passes against an empty set of active representations", () => {
    expect(() => assertDisjoint([], { region: ["SE"], isWorldwide: false })).not.toThrow();
  });
});

describe("applyCounter", () => {
  const base = {
    proposedBy: "agent" as const,
    confirmedByAgent: true,
    confirmedByPerformer: false,
    commissionRate: 1000,
  };

  it("confirms the new proposer's side and clears the counterparty's", () => {
    const countered = applyCounter(base, "performer");
    expect(countered.proposedBy).toBe("performer");
    expect(countered.confirmedByPerformer).toBe(true);
    expect(countered.confirmedByAgent).toBe(false);
  });

  it("works symmetrically when the agent counters back", () => {
    const performerProposed = { ...base, proposedBy: "performer" as const };
    const countered = applyCounter(performerProposed, "agent");
    expect(countered.proposedBy).toBe("agent");
    expect(countered.confirmedByAgent).toBe(true);
    expect(countered.confirmedByPerformer).toBe(false);
  });

  it("preserves the other (term) fields it does not touch", () => {
    const countered = applyCounter(base, "performer");
    expect(countered.commissionRate).toBe(1000);
  });
});
