import { describe, it, expect } from "vitest";
import {
  visiblePartyBreakdowns,
  buildPartyNames,
  buildPayoutRows,
  buildPayoutParties,
} from "./settlementParties";
import type { Event as AppEvent, Settlement, PartyBreakdown } from "./models";

function makeEvent(overrides: Partial<AppEvent> = {}): AppEvent {
  return {
    id: "evt-1",
    name: "Test Event",
    artist: "The Performers",
    venue: "Sunset Hall",
    operator: "Robin",
    operatorType: "venue",
    ...overrides,
  } as AppEvent;
}

function makeSettlement(overrides: Partial<Settlement> = {}): Settlement {
  return {
    eventId: "evt-1",
    artistPayout: 1000,
    promoterPayout: 200,
    venuePayout: 500,
    commissionPayouts: [],
    status: "open",
    approvals: [],
    comments: [],
    revisions: [],
    ...overrides,
  } as Settlement;
}

const baseBreakdowns: PartyBreakdown[] = [
  { party: "Performer", baseAmount: 1000, adjustments: [], finalPayout: 1000 },
  { party: "Promoter", baseAmount: 200, adjustments: [{ label: "Venue Rental share (50%)", amount: -50 }], finalPayout: 150 },
  { party: "Venue", baseAmount: 500, adjustments: [{ label: "Venue Rental share (50%)", amount: 50 }], finalPayout: 550 },
];

describe("visiblePartyBreakdowns", () => {
  it("returns the input unchanged when the operator is the promoter", () => {
    const event = makeEvent({ operatorType: "promoter" });
    expect(visiblePartyBreakdowns(event, baseBreakdowns)).toEqual(baseBreakdowns);
  });

  it("folds Promoter into Venue when operator is venue", () => {
    const event = makeEvent({ operatorType: "venue" });
    const result = visiblePartyBreakdowns(event, baseBreakdowns);
    expect(result.map((pb) => pb.party)).toEqual(["Performer", "Venue"]);
    const venue = result.find((pb) => pb.party === "Venue")!;
    expect(venue.baseAmount).toBe(700);
    expect(venue.finalPayout).toBe(700);
    expect(venue.adjustments).toHaveLength(2);
  });

  it("folds Promoter into Organizer when operator is organizer and Organizer breakdown exists", () => {
    const event = makeEvent({ operatorType: "organizer", operator: "Org Inc" });
    const withOrganizer: PartyBreakdown[] = [
      ...baseBreakdowns,
      { party: "Organizer", baseAmount: 100, adjustments: [], finalPayout: 100 },
    ];
    const result = visiblePartyBreakdowns(event, withOrganizer);
    expect(result.map((pb) => pb.party)).toEqual(["Performer", "Venue", "Organizer"]);
    const organizer = result.find((pb) => pb.party === "Organizer")!;
    expect(organizer.finalPayout).toBe(250);
  });

  it("synthesizes an Organizer entry when operator is organizer but no Organizer breakdown exists", () => {
    const event = makeEvent({ operatorType: "organizer", operator: "Org Inc" });
    const result = visiblePartyBreakdowns(event, baseBreakdowns);
    expect(result.map((pb) => pb.party)).toEqual(["Performer", "Venue", "Organizer"]);
    const organizer = result.find((pb) => pb.party === "Organizer")!;
    expect(organizer.finalPayout).toBe(150);
  });
});

describe("buildPartyNames", () => {
  it("includes Promoter only when operator is promoter", () => {
    expect(buildPartyNames(makeEvent({ operatorType: "promoter" }))).toEqual({
      Performer: "The Performers",
      Venue: "Sunset Hall",
      Promoter: "Robin",
    });
  });

  it("excludes Promoter when operator is venue", () => {
    expect(buildPartyNames(makeEvent({ operatorType: "venue" }))).toEqual({
      Performer: "The Performers",
      Venue: "Sunset Hall",
    });
  });

  it("includes Organizer name when operator is organizer", () => {
    expect(buildPartyNames(makeEvent({ operatorType: "organizer", operator: "Org Inc" }))).toEqual({
      Performer: "The Performers",
      Venue: "Sunset Hall",
      Organizer: "Org Inc",
    });
  });
});

describe("buildPayoutRows", () => {
  it("excludes the Promoter row when operator is venue", () => {
    const event = makeEvent({ operatorType: "venue" });
    const rows = buildPayoutRows(event, makeSettlement(), baseBreakdowns);
    expect(rows.map((r) => r.role)).toEqual(["artist"]);
    expect(rows.some((r) => r.role === "promoter")).toBe(false);
  });

  it("includes Promoter row but filters it out (operator's retained share) when operator is promoter", () => {
    const event = makeEvent({ operatorType: "promoter" });
    const rows = buildPayoutRows(event, makeSettlement(), baseBreakdowns);
    expect(rows.map((r) => r.role)).toEqual(["artist", "venue"]);
  });

  it("when operator is organizer, drops Promoter and Organizer rows, leaves Performer + Venue", () => {
    const event = makeEvent({ operatorType: "organizer" });
    const rows = buildPayoutRows(
      event,
      makeSettlement(),
      [...baseBreakdowns, { party: "Organizer", baseAmount: 100, adjustments: [], finalPayout: 100 }],
    );
    expect(rows.map((r) => r.role)).toEqual(["artist", "venue"]);
  });
});

describe("buildPayoutParties", () => {
  it("excludes the Promoter party when operator is venue", () => {
    const event = makeEvent({ operatorType: "venue" });
    const parties = buildPayoutParties(event, makeSettlement());
    expect(parties.map((p) => p.key)).toEqual(["artist"]);
  });

  it("includes Promoter then filters as operator-retained when operator is promoter", () => {
    const event = makeEvent({ operatorType: "promoter" });
    const parties = buildPayoutParties(event, makeSettlement());
    expect(parties.map((p) => p.key)).toEqual(["artist", "venue"]);
  });
});
