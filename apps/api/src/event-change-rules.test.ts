import { describe, expect, it } from "vitest";
import {
  changeNeedsAgreement,
  describeChange,
  isEmptyChange,
  negotiatedChanges,
  resolveProposal,
} from "./lib/event-change-requests";

/**
 * The rules behind "a change to a booked night is a question" (ClickUp
 * 86cbcftg3), asserted without a database.
 *
 * The expensive mistakes in this feature are not in the SQL. They are: asking
 * for confirmation when nothing actually changed, letting one party's yes move a
 * night two acts are on, and putting a confirm step in front of renaming a show.
 * All three are decidable from pure functions, so all three are pinned here.
 */

const ALL_STATUSES = [
  "draft",
  "suggested",
  "pending",
  "confirmed",
  "on_hold",
  "concluded",
  "cancelled",
] as const;

describe("which statuses turn an edit into a question", () => {
  const EXPECTED: Record<string, boolean> = {
    draft: false, // private; nobody has been asked anything
    suggested: false, // an unanswered offer is still the operator's to revise
    pending: true, // an act has accepted this night
    confirmed: true,
    on_hold: true, // a date held FOR somebody is still held for them
    concluded: false, // nothing left to renegotiate
    cancelled: false,
  };

  for (const status of ALL_STATUSES) {
    it(`${status} → ${EXPECTED[status] ? "must be asked" : "is just an edit"}`, () => {
      expect(changeNeedsAgreement(status)).toBe(EXPECTED[status]);
    });
  }
});

describe("what counts as a change worth asking about", () => {
  const current = { eventDate: "2026-09-12", venueProfileId: "venue-1", stageId: "stage-1" };

  it("ignores fields the patch does not mention", () => {
    const { changes } = negotiatedChanges({ title: "Renamed" }, current);
    expect(isEmptyChange(changes)).toBe(true);
  });

  it("ignores a field re-submitted with the value it already had", () => {
    // The web app saves the whole form, so the date arrives unchanged on every
    // save. Without this, each save would ask an act to confirm a change to
    // nothing — the failure that would make the feature hated.
    const { changes } = negotiatedChanges({ eventDate: "2026-09-12" }, current);
    expect(isEmptyChange(changes)).toBe(true);
  });

  it("never asks about a field outside date, venue and room", () => {
    const { changes } = negotiatedChanges(
      { title: "New name", doorTime: "19:00", notes: "x", capacity: 400, status: "confirmed" },
      current,
    );
    expect(isEmptyChange(changes)).toBe(true);
  });

  it("catches each negotiated field, and remembers what it moved from", () => {
    const { changes, previous } = negotiatedChanges(
      { eventDate: "2026-09-19", stageId: "stage-2", title: "ignored" },
      current,
    );
    expect(changes).toEqual({ eventDate: "2026-09-19", stageId: "stage-2" });
    expect(previous).toEqual({ eventDate: "2026-09-12", stageId: "stage-1" });
    expect("title" in changes).toBe(false);
  });

  it("treats clearing a field as a change, not as an absence", () => {
    const { changes, previous } = negotiatedChanges({ stageId: null }, current);
    expect(changes).toEqual({ stageId: null });
    expect(previous).toEqual({ stageId: "stage-1" });
  });
});

describe("when a proposal is settled", () => {
  it("waits while anybody has not answered", () => {
    expect(resolveProposal({ required: 2, confirmed: 1, declined: 0 })).toBe("pending");
  });

  it("needs EVERY counterpart, not the quickest one", () => {
    // A night two acts are booked on must not move because one answered first.
    expect(resolveProposal({ required: 2, confirmed: 1, declined: 0 })).not.toBe("confirmed");
    expect(resolveProposal({ required: 2, confirmed: 2, declined: 0 })).toBe("confirmed");
  });

  it("is settled by a single refusal, however many have agreed", () => {
    expect(resolveProposal({ required: 3, confirmed: 2, declined: 1 })).toBe("declined");
  });

  it("confirms when there is nobody left to ask", () => {
    // Every counterpart has gone — the operator is back in the position they are
    // in below `pending`, and holding the change open would wait on nobody.
    expect(resolveProposal({ required: 0, confirmed: 0, declined: 0 })).toBe("confirmed");
  });
});

describe("how a change is described to a person", () => {
  it("names one field", () => {
    expect(describeChange({ eventDate: "2026-09-19" })).toBe("the date");
  });

  it("joins two", () => {
    expect(describeChange({ venueProfileId: "v", stageId: "s" })).toBe("the venue and the room");
  });

  it("joins three in the order they are declared, not the order they arrived", () => {
    expect(describeChange({ stageId: "s", eventDate: "d", venueProfileId: "v" })).toBe(
      "the date, the venue and the room",
    );
  });

  it("says something rather than nothing when handed nothing", () => {
    expect(describeChange({})).toBe("this event");
  });
});
