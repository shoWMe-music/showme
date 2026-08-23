import { describe, expect, it } from "vitest";
import { HttpError } from "./errors";
import {
  COMMISSIONABLE_BASES,
  DEFAULT_COMMISSIONABLE_BASIS,
  MAXIMUM_COMMISSION_BASIS_POINTS,
  type RegionScope,
  applyCounter,
  assertCoherentTerritory,
  assertDisjoint,
  assertRepresentationPartyKinds,
  isCommissionRateInRange,
  isCommissionableBasis,
  isPendingTermination,
  isRepresentationActiveAt,
  overlappingRegions,
  regionsOverlap,
  terminationTakesEffectNow,
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
      assertDisjoint([{ region: ["SE"], isWorldwide: false, agentProfileId: "agent-a" }], {
        region: ["DK"],
        isWorldwide: false,
      }),
    ).not.toThrow();
  });

  it("throws a 409 conflict on an overlapping active region", () => {
    try {
      assertDisjoint([{ region: ["SE", "NO"], isWorldwide: false, agentProfileId: "agent-a" }], {
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
      assertDisjoint([{ region: null, isWorldwide: true, agentProfileId: "agent-a" }], {
        region: ["SE"],
        isWorldwide: false,
      }),
    ).toThrow();
    expect(() =>
      assertDisjoint([{ region: ["SE"], isWorldwide: false, agentProfileId: "agent-a" }], {
        region: null,
        isWorldwide: true,
      }),
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

describe("assertDisjoint — the conflict names what collided (A-17)", () => {
  it("names the overlapping countries and the agent already holding them", () => {
    try {
      assertDisjoint(
        [{ region: ["SE", "DE", "NO"], isWorldwide: false, agentProfileId: "agent-incumbent" }],
        { region: ["DE", "NO", "DK"], isWorldwide: false },
      );
      throw new Error("expected assertDisjoint to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(HttpError);
      const message = (error as HttpError).message;
      expect(message).toContain("DE, NO");
      expect(message).not.toContain("DK"); // DK is free — only the collision is named
      expect(message).toContain("agent-incumbent");
    }
  });

  it("describes a worldwide collision as worldwide", () => {
    try {
      assertDisjoint([{ region: null, isWorldwide: true, agentProfileId: "agent-global" }], {
        region: null,
        isWorldwide: true,
      });
      throw new Error("expected assertDisjoint to throw");
    } catch (error) {
      expect((error as HttpError).message).toContain("worldwide");
    }
  });
});

describe("overlappingRegions", () => {
  it("returns only the shared codes", () => {
    expect(
      overlappingRegions(
        { region: ["SE", "NO"], isWorldwide: false },
        { region: ["NO", "DK"], isWorldwide: false },
      ),
    ).toEqual(["NO"]);
  });

  it("a worldwide side swallows the other side's whole list", () => {
    expect(
      overlappingRegions(
        { region: null, isWorldwide: true },
        { region: ["SE"], isWorldwide: false },
      ),
    ).toEqual(["SE"]);
  });
});

describe("assertRepresentationPartyKinds (A-16)", () => {
  it("accepts agent → performer", () => {
    expect(() => assertRepresentationPartyKinds("agent", "performer")).not.toThrow();
  });

  it("rejects crew on the represented side — crew are paid a fixed fee, not a percentage", () => {
    try {
      assertRepresentationPartyKinds("agent", "team_and_crew");
      throw new Error("expected assertRepresentationPartyKinds to throw");
    } catch (error) {
      expect((error as HttpError).statusCode).toBe(400);
      expect((error as HttpError).message).toContain("performer");
      expect((error as HttpError).message).toContain("team_and_crew");
    }
  });

  it("rejects an operator standing as the agent", () => {
    try {
      assertRepresentationPartyKinds("operator", "performer");
      throw new Error("expected assertRepresentationPartyKinds to throw");
    } catch (error) {
      expect((error as HttpError).statusCode).toBe(400);
      expect((error as HttpError).message).toContain('kind "agent"');
    }
  });

  it("rejects a missing profile on either side", () => {
    expect(() => assertRepresentationPartyKinds(undefined, "performer")).toThrow();
    expect(() => assertRepresentationPartyKinds("agent", null)).toThrow();
  });
});

describe("commission terms (A-18)", () => {
  it("offers exactly the bases the engine can compute, and defaults to one of them", () => {
    expect([...COMMISSIONABLE_BASES]).toEqual(["deal_income"]);
    expect(isCommissionableBasis(DEFAULT_COMMISSIONABLE_BASIS)).toBe(true);
  });

  it("rejects merch/publishing — excluded by definition, not by omission (story.md:69)", () => {
    expect(isCommissionableBasis("merchandise_and_publishing")).toBe(false);
    expect(isCommissionableBasis("merch")).toBe(false);
    expect(isCommissionableBasis("")).toBe(false);
  });

  it("bounds the rate above 0% and at 50%", () => {
    expect(isCommissionRateInRange(1)).toBe(true);
    expect(isCommissionRateInRange(1000)).toBe(true);
    expect(isCommissionRateInRange(MAXIMUM_COMMISSION_BASIS_POINTS)).toBe(true);
    expect(isCommissionRateInRange(0)).toBe(false);
    expect(isCommissionRateInRange(-1000)).toBe(false);
    expect(isCommissionRateInRange(9900)).toBe(false); // A-18's 99%
    expect(isCommissionRateInRange(1000.5)).toBe(false);
  });
});

describe("assertCoherentTerritory (A-18)", () => {
  it("accepts a country list, or worldwide with no list", () => {
    expect(() => assertCoherentTerritory({ region: ["SE"], isWorldwide: false })).not.toThrow();
    expect(() => assertCoherentTerritory({ region: [], isWorldwide: true })).not.toThrow();
    expect(() => assertCoherentTerritory({ region: null, isWorldwide: true })).not.toThrow();
  });

  it("rejects worldwide WITH a country list — two contradictory territories", () => {
    expect(() => assertCoherentTerritory({ region: ["SE"], isWorldwide: true })).toThrow(HttpError);
  });

  it("rejects a territory that covers nothing at all", () => {
    expect(() => assertCoherentTerritory({ region: [], isWorldwide: false })).toThrow(HttpError);
    expect(() => assertCoherentTerritory({ region: null, isWorldwide: false })).toThrow(HttpError);
  });
});

describe("isRepresentationActiveAt (A-19)", () => {
  const NOW = new Date("2026-08-23T12:00:00.000Z");
  const FUTURE = new Date("2027-06-01T00:00:00.000Z");
  const PAST = new Date("2026-01-01T00:00:00.000Z");

  it("an active row with no termination is live", () => {
    expect(isRepresentationActiveAt({ status: "active", terminatedEffectiveAt: null }, NOW)).toBe(
      true,
    );
  });

  it("a future-dated termination is STILL LIVE — the notice period is worked", () => {
    expect(isRepresentationActiveAt({ status: "active", terminatedEffectiveAt: FUTURE }, NOW)).toBe(
      true,
    );
  });

  it("a due termination is dead the instant it is due, before any sweep runs", () => {
    expect(isRepresentationActiveAt({ status: "active", terminatedEffectiveAt: PAST }, NOW)).toBe(
      false,
    );
    // …and exactly at the moment itself.
    expect(isRepresentationActiveAt({ status: "active", terminatedEffectiveAt: NOW }, NOW)).toBe(
      false,
    );
  });

  it("a proposed or already-terminated row is never live", () => {
    expect(isRepresentationActiveAt({ status: "proposed", terminatedEffectiveAt: null }, NOW)).toBe(
      false,
    );
    expect(
      isRepresentationActiveAt({ status: "terminated", terminatedEffectiveAt: PAST }, NOW),
    ).toBe(false);
  });

  it("isPendingTermination marks only the notice period", () => {
    expect(isPendingTermination({ status: "active", terminatedEffectiveAt: FUTURE }, NOW)).toBe(
      true,
    );
    expect(isPendingTermination({ status: "active", terminatedEffectiveAt: null }, NOW)).toBe(
      false,
    );
    expect(isPendingTermination({ status: "active", terminatedEffectiveAt: PAST }, NOW)).toBe(
      false,
    );
  });
});

describe("terminationTakesEffectNow (A-19)", () => {
  const NOW = new Date("2026-08-23T12:00:00.000Z");

  it("a future date on an ACTIVE agreement is a notice period, not an ending", () => {
    expect(terminationTakesEffectNow("active", new Date("2027-06-01T00:00:00.000Z"), NOW)).toBe(
      false,
    );
  });

  it("now, or a past date, bites immediately", () => {
    expect(terminationTakesEffectNow("active", NOW, NOW)).toBe(true);
    expect(terminationTakesEffectNow("active", new Date("2026-01-01T00:00:00.000Z"), NOW)).toBe(
      true,
    );
  });

  it("withdrawing a merely PROPOSED offer is always immediate — there is no work to finish", () => {
    expect(terminationTakesEffectNow("proposed", new Date("2027-06-01T00:00:00.000Z"), NOW)).toBe(
      true,
    );
  });
});
